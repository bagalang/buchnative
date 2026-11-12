"use client";

// Таб „Склад“: правила за изписване — коя складова сметка към коя насрещна
// се изписва, по вид (стоки/продукция/материали). Продукцията носи и
// междинна сметка. Порт на ytbuch SettingsStockTab.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ACTIVE_COMPANY_EVENT, api, ListResponse } from "../lib/api";
import { useI18n } from "./I18nProvider";
import { AccountPicker } from "./AccountPicker";

interface Account {
  id: number;
  number: string;
  name: string;
}

interface Rule {
  id: number;
  kind: string;
  inventory_account_id: number;
  offset_account_id: number;
  clearing_account_id: number;
}

const KINDS = ["goods", "production", "material"] as const;

function label(accounts: Account[], id: number): string {
  const a = accounts.find((x) => x.id === id);
  return a ? `${a.number} ${a.name}` : "";
}

export function SettingsStockTab() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("material");
  const [inventory, setInventory] = useState(0);
  const [offset, setOffset] = useState(0);
  const [clearing, setClearing] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const [acc, pack] = await Promise.all([
        api.get<ListResponse<Account>>("/v1/accounts?limit=1000"),
        api.get<ListResponse<Rule>>("/v1/stock/rules"),
      ]);
      setAccounts(acc.items ?? []);
      setRules(pack.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(ACTIVE_COMPANY_EVENT, onChange);
    return () => window.removeEventListener(ACTIVE_COMPANY_EVENT, onChange);
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/v1/stock/rules", {
        kind,
        inventory_account_id: inventory,
        offset_account_id: offset,
        clearing_account_id: kind === "production" ? clearing : 0,
      });
      setInventory(0);
      setOffset(0);
      setClearing(0);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t("stock.rules.delete_confirm"))) return;
    setError("");
    try {
      await api.del(`/v1/stock/rules/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const canAdd =
    inventory > 0 && offset > 0 && (kind !== "production" || clearing > 0);

  return (
    <div className="card" style={{ maxWidth: 880 }}>
      <h2 style={{ marginTop: 0 }}>{t("stock.rules.title")}</h2>
      <p className="muted">{t("stock.rules.hint")}</p>
      {error && <div className="error-text">{error}</div>}
      <form onSubmit={(e) => void add(e)}>
        <div className="form-grid">
          <div className="field">
            <label className="label">{t("stock.rules.kind")}</label>
            <select
              className="select"
              value={kind}
              onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`stock.rules.kind.${k}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">{t("stock.rules.inventory")}</label>
            <AccountPicker
              accounts={accounts}
              value={inventory}
              onChange={setInventory}
              placeholder={t("stock.rules.pick")}
            />
          </div>
          <div className="field">
            <label className="label">{t("stock.rules.offset")}</label>
            <AccountPicker
              accounts={accounts}
              value={offset}
              onChange={setOffset}
              placeholder={t("stock.rules.pick")}
            />
          </div>
          {kind === "production" && (
            <div className="field">
              <label className="label">{t("stock.rules.clearing")}</label>
              <AccountPicker
                accounts={accounts}
                value={clearing}
                onChange={setClearing}
                placeholder={t("stock.rules.pick")}
              />
            </div>
          )}
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving || !canAdd}>
            {t("stock.rules.add")}
          </button>
        </div>
      </form>
      {rules.length === 0 ? (
        <div className="muted">{t("stock.rules.empty")}</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("stock.rules.kind")}</th>
              <th>{t("stock.rules.inventory")}</th>
              <th>{t("stock.rules.offset")}</th>
              <th>{t("stock.rules.clearing")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{t(`stock.rules.kind.${r.kind}`)}</td>
                <td>{label(accounts, r.inventory_account_id)}</td>
                <td>{label(accounts, r.offset_account_id)}</td>
                <td>
                  {r.clearing_account_id > 0
                    ? label(accounts, r.clearing_account_id)
                    : ""}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => void remove(r.id)}
                  >
                    {t("common.delete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}