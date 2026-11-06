"use client";

// Складова справка: приход, разход и наличности за период и обект.
// Справката е четена — не пипа склада. Приходите са партидите, разходите са
// документите в текущо състояние, наличността е преиграване според метода на
// фирмата (WAC/FIFO/LIFO).

import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { todayIso } from "../../lib/dates";
import { fetchCompanyLocations, CompanyLocation } from "../../lib/locations";
import { useI18n } from "../../components/I18nProvider";
import { RequireAuth } from "../../components/RequireAuth";

interface Flow {
  date: string;
  doc: string;
  kind: string;
  reason: string;
  product_id: number;
  product_name: string;
  location_id: number;
  quantity: string;
  value: string;
}

interface Balance {
  product_id: number;
  product_name: string;
  location_id: number;
  quantity: string;
  value: string;
}

interface Report {
  from: string;
  to: string;
  receipts: Flow[];
  issues: Flow[];
  balances: Balance[];
  warnings: string[];
}

const ROW_CAP = 300;

function StockInner() {
  const { t } = useI18n();
  const today = todayIso();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [locationId, setLocationId] = useState(0);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const locName = useCallback(
    (id: number) => locations.find((l) => l.id === id)?.name ?? (id > 0 ? String(id) : t("stock.no_location")),
    [locations, t]
  );

  const reason = (r: string) => {
    const key = `stock.reason.${r}`;
    const label = t(key);
    return label === key ? r : label;
  };

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&location_id=${locationId}`;
      setReport(await api.get<Report>(`/v1/stock/report${q}`));
      setLocations(await fetchCompanyLocations());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [from, to, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const receipts = report?.receipts ?? [];
  const issues = report?.issues ?? [];
  const balances = report?.balances ?? [];
  const warnings = report?.warnings ?? [];
  const receiptsShown = receipts.slice(0, ROW_CAP);
  const issuesShown = issues.slice(0, ROW_CAP);
  const balancesShown = balances.slice(0, ROW_CAP);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("stock.title")}</h1>
      </div>
      {error && <div className="error-text">{error}</div>}

      <div className="card content" style={{ marginBottom: 12 }}>
        <div className="form-grid">
          <div className="field">
            <label className="label">{t("stock.from")}</label>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">{t("stock.to")}</label>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">{t("stock.location")}</label>
            <select
              className="input"
              value={String(locationId)}
              onChange={(e) => setLocationId(Number(e.target.value) || 0)}
            >
              <option value="0">{t("stock.all_locations")}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void load()}>
            {t("stock.load")}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="card content" style={{ marginBottom: 12 }}>
          <strong>{t("stock.warnings")}</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={`${i}-${w}`}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <FlowTable
        title={t("stock.receipts")}
        rows={receiptsShown}
        total={receipts.length}
        cap={ROW_CAP}
        locName={locName}
        reason={reason}
        t={t}
      />
      <FlowTable
        title={t("stock.issues")}
        rows={issuesShown}
        total={issues.length}
        cap={ROW_CAP}
        locName={locName}
        reason={reason}
        t={t}
      />

      <div className="card" style={{ marginTop: 12 }}>
        <div className="content">
          <strong>{t("stock.balances")}</strong>
          {balances.length > ROW_CAP && (
            <span className="muted">
              {" "}
              {t("stock.showing")} {Math.min(balances.length, ROW_CAP)} / {balances.length}
            </span>
          )}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t("stock.product")}</th>
              <th>{t("stock.location")}</th>
              <th>{t("stock.quantity")}</th>
              <th>{t("stock.value")}</th>
            </tr>
          </thead>
          <tbody>
            {balances.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {t("common.empty")}
                </td>
              </tr>
            ) : (
              balancesShown.map((b, i) => (
                <tr key={`${b.product_id}-${b.location_id}-${i}`}>
                  <td>{b.product_name}</td>
                  <td>{locName(b.location_id)}</td>
                  <td>{b.quantity}</td>
                  <td>{b.value}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlowTable({
  title,
  rows,
  total,
  cap,
  locName,
  reason,
  t,
}: {
  title: string;
  rows: Flow[];
  total: number;
  cap: number;
  locName: (id: number) => string;
  reason: (r: string) => string;
  t: (key: string) => string;
}) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="content">
        <strong>{title}</strong>
        {total > cap && (
          <span className="muted">
            {" "}
            {t("stock.showing")} {Math.min(total, cap)} / {total}
          </span>
        )}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>{t("stock.date")}</th>
            <th>{t("stock.document")}</th>
            <th>{t("stock.product")}</th>
            <th>{t("stock.location")}</th>
            <th>{t("stock.quantity")}</th>
            <th>{t("stock.value")}</th>
            <th>{t("stock.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {total === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                {t("common.empty")}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.date}-${r.doc}-${r.product_id}-${i}`}>
                <td>{r.date}</td>
                <td>{r.doc}</td>
                <td>{r.product_name}</td>
                <td>{locName(r.location_id)}</td>
                <td>{r.quantity}</td>
                <td>{r.value}</td>
                <td>{reason(r.reason)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function StockPage() {
  return (
    <RequireAuth>
      <StockInner />
    </RequireAuth>
  );
}
