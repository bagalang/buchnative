"use client";

// Одитна следа: кой, кога и какво е променил по документи и счетоводни статии.
// Само четене — записите се правят от backend-а при всяка значима промяна.

import { useCallback, useEffect, useState } from "react";
import { api, ListResponse } from "../../lib/api";
import { useI18n } from "../../components/I18nProvider";
import { RequireAuth } from "../../components/RequireAuth";

interface AuditRow {
  id: number;
  company_id: number;
  user_login: string;
  user_name: string;
  entity_type: string;
  entity_id: number;
  entity_number: string;
  action: string;
  summary: string;
  old_amount: string;
  new_amount: string;
  created_at: string;
}

const ENTITIES = ["journal", "invoice", "bank", "period", "closing", "internal_doc", "production", "fixed_asset", "dividend"];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}

function AuditInner() {
  const { t } = useI18n();
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(todayIso());
  const [entity, setEntity] = useState("");
  const [items, setItems] = useState<AuditRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(
    async (off: number) => {
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ from, to, limit: String(limit), offset: String(off) });
        if (entity) q.set("entity", entity);
        const data = await api.get<ListResponse<AuditRow>>(`/v1/audit?${q.toString()}`);
        setItems(data.items ?? []);
        setOffset(off);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [from, to, entity, limit]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("audit.title")}</h1>
      </div>
      <p className="muted">{t("audit.hint")}</p>
      {error && <div className="error-text">{error}</div>}
      <div className="form-grid" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="label">{t("audit.from")}</label>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">{t("audit.to")}</label>
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">{t("audit.entity")}</label>
          <select
            className="input"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          >
            <option value="">{t("audit.all_entities")}</option>
            {ENTITIES.map((x) => (
              <option key={x} value={x}>
                {t(`audit.entity.${x}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label">&nbsp;</label>
          <button className="btn btn-primary" type="button" onClick={() => load(0)}>
            {t("audit.apply")}
          </button>
        </div>
      </div>
      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted">{t("audit.empty")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("audit.when")}</th>
              <th>{t("audit.user")}</th>
              <th>{t("audit.entity")}</th>
              <th>{t("audit.number")}</th>
              <th>{t("audit.action")}</th>
              <th>{t("audit.summary")}</th>
              <th style={{ textAlign: "right" }}>{t("audit.old_amount")}</th>
              <th style={{ textAlign: "right" }}>{t("audit.new_amount")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td>{r.created_at}</td>
                <td>
                  {r.user_name}
                  {r.user_name !== r.user_login ? (
                    <span className="muted"> ({r.user_login})</span>
                  ) : null}
                </td>
                <td>{t(`audit.entity.${r.entity_type}`)}</td>
                <td>{r.entity_number}</td>
                <td>
                  <span className="badge">{r.action}</span>
                </td>
                <td>{r.summary}</td>
                <td style={{ textAlign: "right" }}>{r.old_amount}</td>
                <td style={{ textAlign: "right" }}>{r.new_amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button
          className="btn"
          type="button"
          disabled={offset === 0 || loading}
          onClick={() => load(Math.max(0, offset - limit))}
        >
          {t("audit.prev")}
        </button>
        <button
          className="btn"
          type="button"
          disabled={items.length < limit || loading}
          onClick={() => load(offset + limit)}
        >
          {t("audit.next")}
        </button>
      </div>
    </div>
  );
}

export default function AuditPage() {
  return (
    <RequireAuth>
      <AuditInner />
    </RequireAuth>
  );
}
