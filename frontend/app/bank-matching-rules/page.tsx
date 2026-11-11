"use client";

// Банкови правила за разпознаване на транзакции по ключови думи (порт на
// secret/baraba BankMatchingRule). Ключовите думи се търсят в описанието и
// името на контрагента; кирилица и латиница се свеждат; по-висок приоритет
// печели. Без AI ключ.

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { useI18n } from "../../components/I18nProvider";
import { api, ListResponse } from "../../lib/api";
import { AccountPicker } from "../../components/AccountPicker";

interface BankRule {
  id: number;
  name: string;
  keywords: string;
  direction: string;
  priority: number;
  is_active: number;
  account_id: number;
  counterpart_id: number;
}

interface Account {
  id: number;
  number: string;
  name: string;
}

interface Counterpart {
  id: number;
  name: string;
}

const emptyForm = {
  name: "",
  keywords: "",
  direction: "any",
  priority: 0,
  is_active: 1,
  account_id: 0,
  counterpart_id: 0,
};

function BankRulesInner() {
  const { t } = useI18n();
  const [rules, setRules] = useState<BankRule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [counterparts, setCounterparts] = useState<Counterpart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankRule | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cpQ, setCpQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [r, a, c] = await Promise.all([
        api.get<ListResponse<BankRule>>("/v1/bank-matching-rules"),
        api.get<ListResponse<Account>>("/v1/accounts?limit=1000"),
        api.get<ListResponse<Counterpart>>("/v1/counterparts?limit=1000"),
      ]);
      setRules(
        [...(r.items ?? [])].sort((a, b) => b.priority - a.priority)
      );
      setAccounts(a.items ?? []);
      setCounterparts(c.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const cpFiltered = useMemo(() => {
    const s = cpQ.trim().toLowerCase();
    if (!s) return counterparts.slice(0, 100);
    return counterparts
      .filter((c) => c.name.toLowerCase().includes(s))
      .slice(0, 100);
  }, [counterparts, cpQ]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setCpQ("");
    setModalOpen(true);
  };

  const openEdit = (r: BankRule) => {
    setEditing(r);
    setForm({ ...r });
    setCpQ("");
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        keywords: form.keywords,
        direction: form.direction,
        priority: Number(form.priority),
        is_active: Number(form.is_active),
        account_id: Number(form.account_id),
        counterpart_id: Number(form.counterpart_id),
      };
      if (editing) await api.patch(`/v1/bank-matching-rules/${editing.id}`, payload);
      else await api.post("/v1/bank-matching-rules", payload);
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: BankRule) => {
    if (!window.confirm(t("common.confirmDelete"))) return;
    try {
      await api.del(`/v1/bank-matching-rules/${r.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDefaults = async () => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const d = await api.post<{ created: number; count: number }>(
        "/v1/bank-matching-rules/defaults"
      );
      setSuccess(
        t("bank_rules.created_defaults").replace("{n}", String(d.created))
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleAuto = async () => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const r = await api.post<{
        matched: number;
        unmatched: number;
        errors: number;
        counterpart_hits: number;
      }>("/v1/bank-transactions/auto-allocate");
      setSuccess(
        t("bank_rules.auto_done")
          .replace("{m}", String(r.matched))
          .replace("{u}", String(r.unmatched))
          .replace("{e}", String(r.errors))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const accountLabel = (id: number) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.number} — ${a.name}` : "-";
  };

  const cpLabel = (id: number) => {
    const c = counterparts.find((x) => x.id === id);
    return c ? c.name : "-";
  };

  const dirLabel = (d: string) =>
    d === "debit" ? t("bank_rules.direction.debit")
      : d === "credit" ? t("bank_rules.direction.credit")
      : t("bank_rules.direction.any");

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("bank_rules.title")}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={handleDefaults}
            disabled={busy}
            type="button"
          >
            {t("bank_rules.defaults")}
          </button>
          <button
            className="btn"
            onClick={handleAuto}
            disabled={busy}
            type="button"
          >
            {t("bank_rules.auto")}
          </button>
          <button className="btn btn-primary" onClick={openCreate} type="button">
            {t("common.create")}
          </button>
        </div>
      </div>
      {error && <div className="error-text">{error}</div>}
      {success && <div className="success-text">{success}</div>}
      <p className="muted" style={{ margin: "8px 0 12px" }}>
        {t("bank_rules.hint")}
      </p>
      <div className="card">
        {loading ? (
          <div className="muted">{t("common.loading")}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("bank_rules.name")}</th>
                <th>{t("bank_rules.keywords")}</th>
                <th>{t("bank_rules.direction.label")}</th>
                <th style={{ textAlign: "right" }}>{t("bank_rules.priority")}</th>
                <th>{t("bank_rules.account")}</th>
                <th>{t("bank_rules.counterpart")}</th>
                <th>{t("bank_rules.active")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td style={{ maxWidth: 320 }} title={r.keywords}>
                    {r.keywords}
                  </td>
                  <td>{dirLabel(r.direction)}</td>
                  <td style={{ textAlign: "right" }}>{r.priority}</td>
                  <td>{accountLabel(r.account_id)}</td>
                  <td>{cpLabel(r.counterpart_id)}</td>
                  <td>{r.is_active ? t("common.yes") : t("common.no")}</td>
                  <td>
                    <button className="btn" onClick={() => openEdit(r)} type="button">
                      {t("common.edit")}
                    </button>{" "}
                    <button className="btn btn-danger" onClick={() => handleDelete(r)} type="button">
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
              {rules.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {t("bank_rules.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div
            className="card modal"
            style={{ maxWidth: 680 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">
              {editing ? t("common.edit") : t("common.create")}
            </h2>
            <form onSubmit={handleSave}>
              <div className="form-grid">
                <div className="field">
                  <label className="label">{t("bank_rules.name")} *</label>
                  <input
                    className="input"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.keywords")} *</label>
                  <textarea
                    className="textarea"
                    rows={3}
                    required
                    value={form.keywords}
                    onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                    placeholder="POS, ПОС, теглене, ATM, withdrawal"
                  />
                  <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                    {t("bank_rules.keywords_hint")}
                  </p>
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.direction.label")}</label>
                  <select
                    className="select"
                    value={form.direction}
                    onChange={(e) => setForm({ ...form, direction: e.target.value })}
                  >
                    <option value="any">{t("bank_rules.direction.any")}</option>
                    <option value="debit">{t("bank_rules.direction.debit")}</option>
                    <option value="credit">{t("bank_rules.direction.credit")}</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.priority")}</label>
                  <input
                    className="input"
                    type="number"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                  />
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.account")}</label>
                  <AccountPicker
                    value={Number(form.account_id)}
                    accounts={accounts}
                    onChange={(id) => setForm({ ...form, account_id: id })}
                  />
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.counterpart")}</label>
                  <input
                    className="input"
                    value={cpQ}
                    onChange={(e) => setCpQ(e.target.value)}
                    placeholder={t("bank_rules.counterpart_search")}
                  />
                  <select
                    className="select"
                    value={Number(form.counterpart_id)}
                    onChange={(e) => setForm({ ...form, counterpart_id: Number(e.target.value) })}
                    size={5}
                    style={{ marginTop: 6 }}
                  >
                    <option value={0}>{t("bank_rules.counterpart_none")}</option>
                    {cpFiltered.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label">{t("bank_rules.active")}</label>
                  <input
                    type="checkbox"
                    checked={form.is_active === 1}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked ? 1 : 0 })}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setModalOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button className="btn btn-primary" disabled={saving}>
                  {t("common.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BankMatchingRulesPage() {
  return (
    <RequireAuth>
      <BankRulesInner />
    </RequireAuth>
  );
}
