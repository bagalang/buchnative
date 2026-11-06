"use client";

// Изписване на материали — документ (чернова → потвърден) с редове: артикул,
// количество и разходна сметка. Потвърждението изважда от склада
// (WAC/FIFO/LIFO) и прави запис Дт разход / Кт складова сметка.

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ListResponse } from "../../lib/api";
import { formatBgDate, todayIso } from "../../lib/dates";
import { fetchCompanyLocations, CompanyLocation } from "../../lib/locations";
import { useI18n } from "../../components/I18nProvider";
import { RequireAuth } from "../../components/RequireAuth";

interface Account {
  id: number;
  number: string;
  name: string;
}

interface Product {
  id: number;
  name: string;
  code: string;
  unit: string;
  is_inventory: number;
  inventory_account_id: number;
  stock_quantity: string;
}

interface Line {
  product_id: number;
  quantity: string;
  account_id: number;
  unit_cost?: string;
  amount?: string;
  inventory_account_id?: number;
}

interface Doc {
  id: number;
  number: string;
  doc_date: string;
  location_id: number;
  status: string;
  notes: string;
  journal_entry_id: number;
  lines?: Line[];
}

function MiInner() {
  const { t } = useI18n();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(0);
  const [msg, setMsg] = useState("");

  const [form, setForm] = useState({
    number: "",
    doc_date: todayIso(),
    location_id: 0,
    notes: "",
  });
  const [lines, setLines] = useState<Line[]>([
    { product_id: 0, quantity: "1", account_id: 0 },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, p, a, loc] = await Promise.all([
        api.get<ListResponse<Doc>>("/v1/material-issues"),
        api.get<ListResponse<Product>>("/v1/products"),
        api.get<ListResponse<Account>>("/v1/accounts"),
        fetchCompanyLocations(),
      ]);
      setDocs(d.items ?? []);
      setProducts(p.items ?? []);
      setAccounts(a.items ?? []);
      setLocations(loc);
      if (loc.length > 0 && form.location_id === 0) {
        setForm({ ...form, location_id: loc[0].id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form.location_id]);

  useEffect(() => {
    void load();
  }, [load]);

  const stockProducts = useMemo(() => products.filter((p) => p.is_inventory), [products]);

  const setLine = (i: number, patch: Partial<Line>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(1);
    setError("");
    setMsg("");
    try {
      const valid = lines.filter((l) => l.product_id > 0 && l.quantity !== "");
      await api.post("/v1/material-issues", {
        ...form,
        lines: valid.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          account_id: l.account_id,
        })),
      });
      setMsg(t("material_issues.saved"));
      setForm({ number: "", doc_date: todayIso(), location_id: form.location_id, notes: "" });
      setLines([{ product_id: 0, quantity: "1", account_id: 0 }]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(0);
    }
  };

  const confirm = async (id: number) => {
    setBusy(id);
    setError("");
    setMsg("");
    try {
      await api.post(`/v1/material-issues/${id}/confirm`, {});
      setMsg(t("material_issues.confirmed"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(0);
    }
  };

  const unpost = async (id: number) => {
    setBusy(id);
    setError("");
    setMsg("");
    try {
      await api.post(`/v1/material-issues/${id}/unpost`, {});
      setMsg(t("material_issues.unposted"));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(0);
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm(t("common.confirmDelete"))) return;
    setBusy(id);
    setError("");
    setMsg("");
    try {
      await api.del(`/v1/material-issues/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(0);
    }
  };

  const pname = (id: number) => {
    const p = products.find((x) => x.id === id);
    return p ? `${p.code ? p.code + " " : ""}${p.name}` : `#${id}`;
  };
  const aname = (id: number) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.number} ${a.name}` : `#${id}`;
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("material_issues.title")}</h1>
      </div>
      <p className="muted">{t("material_issues.hint")}</p>
      {error && <div className="error-text">{error}</div>}
      {msg && <div className="success-text">{msg}</div>}

      <div className="card content" style={{ marginBottom: 18 }}>
        <h3 className="section-title">{t("material_issues.new")}</h3>
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field">
              <label className="label">{t("material_issues.number")}</label>
              <input
                className="input"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label">{t("material_issues.date")}</label>
              <input
                className="input"
                type="date"
                value={form.doc_date}
                onChange={(e) => setForm({ ...form, doc_date: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="label">{t("material_issues.location")}</label>
              <select
                className="input"
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label">{t("material_issues.notes")}</label>
              <input
                className="input"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <table className="table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t("material_issues.product")}</th>
                <th>{t("material_issues.quantity")}</th>
                <th>{t("material_issues.account")}</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select
                      className="input"
                      value={l.product_id}
                      onChange={(e) => {
                        const pid = Number(e.target.value);
                        const p = products.find((x) => x.id === pid);
                        setLine(i, {
                          product_id: pid,
                          inventory_account_id: p?.inventory_account_id ?? 0,
                        });
                      }}
                    >
                      <option value={0}>—</option>
                      {stockProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {pname(p.id)} ({t("material_issues.stock")}: {p.stock_quantity})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      className="input"
                      value={l.account_id}
                      onChange={(e) => setLine(i, { account_id: Number(e.target.value) })}
                    >
                      <option value={0}>—</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {aname(a.id)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setLines([...lines, { product_id: 0, quantity: "1", account_id: 0 }])}
            >
              {t("material_issues.add_line")}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy === 1}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <p className="muted">{t("common.loading")}</p>
      ) : docs.length === 0 ? (
        <p className="muted">{t("material_issues.empty")}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t("material_issues.number")}</th>
              <th>{t("material_issues.date")}</th>
              <th>{t("material_issues.location")}</th>
              <th>{t("material_issues.status")}</th>
              <th style={{ width: 320 }}></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.number}</td>
                <td>{formatBgDate(d.doc_date)}</td>
                <td>{locations.find((l) => l.id === d.location_id)?.name ?? d.location_id}</td>
                <td>
                  <span className={`badge ${d.status === "confirmed" ? "badge-success" : ""}`}>
                    {t(`material_issues.status_${d.status}`)}
                  </span>
                </td>
                <td>
                  <div className="btn-row">
                    <button
                      className="btn btn-sm"
                      disabled={busy === d.id || d.status !== "draft"}
                      onClick={() => void confirm(d.id)}
                    >
                      {t("material_issues.confirm")}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy === d.id || d.status !== "confirmed"}
                      onClick={() => void unpost(d.id)}
                    >
                      {t("material_issues.unpost")}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busy === d.id || d.status !== "draft"}
                      onClick={() => void remove(d.id)}
                    >
                      {t("common.delete")}
                    </button>
                  </div>
                  {d.lines && d.lines.length > 0 ? (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {d.lines.map((l) => `${pname(l.product_id)} × ${l.quantity}`).join(", ")}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MaterialIssuesPage() {
  return (
    <RequireAuth>
      <MiInner />
    </RequireAuth>
  );
}
