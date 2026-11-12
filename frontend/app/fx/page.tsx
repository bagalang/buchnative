"use client";

// Валутни позиции — отворени позиции по (сметка, контрагент, валута) към дата,
// преоценка към ЕЦБ курс (запис тип fx_revalue, разлики по 624/724).

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { todayIso } from "../../lib/dates";
import { useI18n } from "../../components/I18nProvider";
import { RequireAuth } from "../../components/RequireAuth";

interface FxItem {
  account_id: number;
  account_number: string;
  account_name: string;
  counterpart_id?: number;
  counterpart_name?: string;
  currency: string;
  fx_quantity: string;
  base_amount: string;
  rate: string;
  rate_date: string;
  revalued: string;
  diff: string;
  base_currency: string;
}

interface FxList {
  date: string;
  base_currency: string;
  items: FxItem[];
  count: number;
}

interface RevalueResult {
  date: string;
  revalued: number;
  diff_total: string;
  base_currency: string;
}

const fmt = (v: string) => {
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return n.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};

function FxInner() {
  const { t } = useI18n();
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<FxList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");

  const load = useCallback(async (d: string) => {
    if (!d) return;
    setLoading(true);
    setError("");
    try {
      setData(await api.get<FxList>(`/v1/fx/open-items?date=${encodeURIComponent(d)}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const revalue = async () => {
    if (!window.confirm(t("fx.revalue_confirm"))) return;
    setBusy(true);
    setError("");
    setSummary("");
    try {
      const r = await api.post<RevalueResult>("/v1/fx/revalue", { date });
      setSummary(
        `${t("fx.revalued")}: ${r.revalued}, ${t("fx.diff_total")}: ${fmt(r.diff_total)} ${r.base_currency}`
      );
      await load(date);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("fx.title")}</h1>
        <button className="btn btn-primary" onClick={() => void revalue()} disabled={busy || !date}>
          {t("fx.revalue")}
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {summary && <div className="card content" style={{ marginBottom: 12 }}>{summary}</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field" style={{ maxWidth: 240 }}>
          <label className="label">{t("fx.asof_date")}</label>
          <input
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="content muted">{t("common.loading")}</div>
        ) : !data || data.items.length === 0 ? (
          <div className="content muted">{t("common.empty")}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("fx.account")}</th>
                  <th>{t("fx.counterpart")}</th>
                  <th>{t("fx.currency")}</th>
                  <th style={{ textAlign: "right" }}>{t("fx.quantity")}</th>
                  <th style={{ textAlign: "right" }}>{t("fx.base_amount")}</th>
                  <th style={{ textAlign: "right" }}>{t("fx.rate")}</th>
                  <th style={{ textAlign: "right" }}>{t("fx.revalued_col")}</th>
                  <th style={{ textAlign: "right" }}>{t("fx.diff")}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.account_number} {it.account_name}
                    </td>
                    <td>{it.counterpart_name ?? ""}</td>
                    <td>{it.currency}</td>
                    <td style={{ textAlign: "right" }}>{fmt(it.fx_quantity)}</td>
                    <td style={{ textAlign: "right" }}>
                      {fmt(it.base_amount)} {data.base_currency}
                    </td>
                    <td style={{ textAlign: "right" }} title={it.rate_date}>
                      {it.rate}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {fmt(it.revalued)} {data.base_currency}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        color: Number(it.diff) > 0 ? "var(--success)" : Number(it.diff) < 0 ? "var(--danger)" : undefined,
                      }}
                    >
                      {fmt(it.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FxPage() {
  return (
    <RequireAuth>
      <FxInner />
    </RequireAuth>
  );
}
