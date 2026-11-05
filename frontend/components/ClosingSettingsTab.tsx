"use client";

// Таб «Приключване»: карта closing_map в настройките на фирмата —
// коя сметка/подсметка (префикс на номера) към коя сметка се приключва
// в края на месеца (напр. 60 → 611, 602 → 612). Печели най-дългият префикс.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, getActiveCompany } from "../lib/api";
import { useI18n } from "./I18nProvider";

interface Account {
  id: number;
  number: string;
  name: string;
}

interface RuleRow {
  source: string;
  target: string;
}

function parseRules(raw: unknown): RuleRow[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const m = o.closing_map;
    if (Array.isArray(m)) {
      return m
        .map((x) => {
          const r = x as Record<string, unknown>;
          return {
            source: String(r.source ?? "").trim(),
            target: String(r.target ?? "").trim(),
          };
        })
        .filter((r) => r.source && r.target);
    }
    if (m && typeof m === "object") {
      return Object.entries(m as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v)
        .map(([source, target]) => ({
          source: source.trim(),
          target: String(target).trim(),
        }));
    }
  } catch {
    // невалиден JSON — празна карта
  }
  return [];
}

function accountLabel(accounts: Account[], number: string): string {
  const a = accounts.find((x) => x.number === number);
  return a ? `${a.number} ${a.name}` : number;
}

export function ClosingSettingsTab() {
  const { t } = useI18n();
  const [companyId, setCompanyId] = useState(0);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [rawSettings, setRawSettings] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const ac = await getActiveCompany();
      const id = ac && typeof ac.id === "number" ? ac.id : 0;
      setCompanyId(id);
      if (id <= 0) {
        setLoading(false);
        return;
      }
      const company = await api.get<{ settings?: string }>(`/v1/companies/${id}`);
      const raw = typeof company.settings === "string" ? company.settings : "{}";
      setRawSettings(raw);
      setRows(parseRules(raw));
      // За етикети и за подсказки при въвеждане.
      const list = await api.get<{ items?: Account[] }>(`/v1/accounts?limit=2000`);
      setAccounts(list.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (companyId <= 0) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const valid = rows.filter((r) => r.source.trim() && r.target.trim());
      // Съществуващи настройки + closing_map (масивова форма).
      let base: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(rawSettings) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) base = parsed;
      } catch {
        // невалиден JSON — започваме празни
      }
      if (valid.length > 0) {
        base.closing_map = valid.map((r) => ({
          source: r.source.trim(),
          target: r.target.trim(),
        }));
      } else {
        delete base.closing_map;
      }
      await api.patch(`/v1/companies/${companyId}`, {
        settings: JSON.stringify(base),
      });
      setRawSettings(JSON.stringify(base));
      setMsg(t("closing.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">{t("common.loading")}</p>;
  if (companyId <= 0) return <div className="muted">{t("settings.no_company")}</div>;

  return (
    <form onSubmit={save}>
      <p className="muted">{t("closing.hint")}</p>
      {error && <div className="error-text">{error}</div>}
      {msg && <div className="success-text">{msg}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>{t("closing.source")}</th>
            <th>{t("closing.target")}</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  className="input"
                  value={r.source}
                  list="closing-accounts"
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))
                  }
                />
              </td>
              <td>
                <input
                  className="input"
                  value={r.target}
                  list="closing-accounts"
                  onChange={(e) =>
                    setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  {t("common.delete")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <datalist id="closing-accounts">
        {accounts.map((a) => (
          <option key={a.id} value={a.number}>
            {a.name}
          </option>
        ))}
      </datalist>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          onClick={() => setRows([...rows, { source: "", target: "" }])}
        >
          {t("closing.add_rule")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}
