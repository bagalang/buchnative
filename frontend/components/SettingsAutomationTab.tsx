"use client";

// Таб «Автоматизация»: default сметки на фирмата (settings.default_accounts,
// роля → id на сметка). Осчетоводяването и банковите шаблони ги ползват за
// клиент/доставчик, ДДС, каса, приход, разход и запаси. Празно поле пада на
// стандартния номер от сметкоплана.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AccountPicker, AccountOption } from "./AccountPicker";
import { useI18n } from "./I18nProvider";
import { ACTIVE_COMPANY_EVENT, api, getActiveCompany } from "../lib/api";
import { settingsObject, settingsRaw } from "../lib/settings";

const ROLES = [
  "customers",
  "suppliers",
  "vat_purchase",
  "vat_sale",
  "cash",
  "card_purchase",
  "card_sale",
  "revenues",
  "expenses",
  "inventory",
] as const;

type Role = (typeof ROLES)[number];

function parseDefaults(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const m = settingsObject(raw).default_accounts;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k.trim()] = n;
    }
  }
  return out;
}

export function SettingsAutomationTab() {
  const { t } = useI18n();
  const [companyId, setCompanyId] = useState(0);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
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
      const [company, list] = await Promise.all([
        api.get<{ settings?: string }>(`/v1/companies/${id}`),
        api.get<{ items?: AccountOption[] }>(`/v1/accounts?limit=2000`),
      ]);
      const raw = settingsRaw(company.settings);
      setRawSettings(raw);
      setValues(parseDefaults(company.settings));
      setAccounts(list.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(ACTIVE_COMPANY_EVENT, onChange);
    return () => window.removeEventListener(ACTIVE_COMPANY_EVENT, onChange);
  }, [load]);

  const setRole = (role: Role, id: number) =>
    setValues((prev) => {
      const next = { ...prev };
      if (id > 0) next[role] = id;
      else delete next[role];
      return next;
    });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (companyId <= 0) return;
    setSaving(true);
    setError("");
    setMsg("");
    try {
      const base: Record<string, unknown> = settingsObject(rawSettings);
      const map: Record<string, string> = {};
      for (const role of ROLES) {
        const v = values[role];
        if (v && v > 0) map[role] = String(v);
      }
      if (Object.keys(map).length > 0) base.default_accounts = map;
      else delete base.default_accounts;
      await api.patch(`/v1/companies/${companyId}`, {
        settings: JSON.stringify(base),
      });
      setRawSettings(JSON.stringify(base));
      setMsg(t("automation.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">{t("common.loading")}</p>;
  if (companyId <= 0) return <div className="muted">{t("settings.no_company")}</div>;

  return (
    <div className="card card-pad" style={{ maxWidth: 880 }}>
      <h2 style={{ marginTop: 0 }}>{t("automation.title")}</h2>
      <p className="muted">{t("automation.hint")}</p>
      {error && <div className="error-text">{error}</div>}
      {msg && <div className="flash-ok">{msg}</div>}
      <form onSubmit={save}>
        <div className="form-grid">
          {ROLES.map((role) => (
            <div className="field" key={role}>
              <label className="label">{t(`automation.${role}`)}</label>
              <AccountPicker
                value={values[role] ?? 0}
                accounts={accounts}
                onChange={(id) => setRole(role, id)}
                placeholder={t("automation.pick")}
                allowClear
              />
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" disabled={saving}>
            {t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
