"use client";

// Банкови транзакции: импорт от файл (преглед + дубликати), ръчно
// осчетоводяване и разнасяне с търсене на контрагент и сметка — като
// secret/baraba. Сумите остават десимални низове.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "../../components/RequireAuth";
import { useI18n } from "../../components/I18nProvider";
import { api, ListResponse } from "../../lib/api";
import {
  Account,
  BankAccount,
  BankTransaction,
  Counterpart,
  JeLine,
  Preview,
} from "./types";
import { fmtAmount, isPositive, matchCounterpart } from "./helpers";
import { BankTxModals } from "./BankTxModals";

function BankTransactionsInner() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [chartAccounts, setChartAccounts] = useState<Account[]>([]);
  const [counterparts, setCounterparts] = useState<Counterpart[]>([]);
  const [rows, setRows] = useState<BankTransaction[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pendingContent, setPendingContent] = useState("");
  const [importing, setImporting] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);

  const [bookTx, setBookTx] = useState<BankTransaction | null>(null);
  const [bookContra, setBookContra] = useState(0);
  const [bookDebit, setBookDebit] = useState(0);
  const [bookCredit, setBookCredit] = useState(0);
  const [bookCpId, setBookCpId] = useState(0);
  const [bookCpSearch, setBookCpSearch] = useState("");
  const [bookAccSearch, setBookAccSearch] = useState("");
  const [bookLoading, setBookLoading] = useState(false);

  const [reallocTx, setReallocTx] = useState<BankTransaction | null>(null);
  const [reallocAccount, setReallocAccount] = useState(0);
  const [reallocCpId, setReallocCpId] = useState(0);
  const [reallocCpSearch, setReallocCpSearch] = useState("");
  const [reallocAccSearch, setReallocAccSearch] = useState("");
  const [reallocLines, setReallocLines] = useState<JeLine[]>([]);
  const [reallocJeDesc, setReallocJeDesc] = useState("");
  const [reallocLoading, setReallocLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [b, a, c] = await Promise.all([
        api.get<ListResponse<BankAccount>>("/v1/bank-accounts"),
        api.get<ListResponse<Account>>("/v1/accounts?limit=1000"),
        api.get<ListResponse<Counterpart>>("/v1/counterparts"),
      ]);
      setAccounts(b.items ?? []);
      setChartAccounts(a.items ?? []);
      setCounterparts(c.items ?? []);
    } catch {
      /* silent */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (selectedAccount) params.set("bank_account_id", selectedAccount);
      if (filterStatus) params.set("status", filterStatus);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const qs = params.toString();
      const data = await api.get<ListResponse<BankTransaction>>(
        `/v1/bank-transactions${qs ? `?${qs}` : ""}`
      );
      setRows(data.items ?? []);
      setSelected([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, filterStatus, dateFrom, dateTo]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((tx) =>
      [tx.description, tx.counterpart_name, tx.reference, tx.amount, tx.transaction_date]
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [rows, q]);

  const handleFile = async (file: File) => {
    setError("");
    setSuccess("");
    const content = await file.text();
    setPendingContent(content);
    setPreview(null);
    setPreviewOpen(true);
    setPreviewLoading(true);
    try {
      const data = await api.post<Preview>("/v1/bank-transactions/preview", {
        bank_account_id: selectedAccount ? Number(selectedAccount) : undefined,
        file_content: content,
      });
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const r = await api.post<{
        imported: number;
        journal_count: number;
        auto_journal?: number;
        bank_account_name?: string;
      }>("/v1/bank-transactions/import", {
        bank_account_id: selectedAccount ? Number(selectedAccount) : undefined,
        file_content: pendingContent,
      });
      const msg =
        r.journal_count > 0
          ? t("bank_tx.imported_with_journal")
              .replace("{n}", String(r.imported))
              .replace("{j}", String(r.journal_count))
          : t("bank_tx.imported").replace("{n}", String(r.imported));
      setSuccess(msg);
      setError("");
      setPreviewOpen(false);
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleAutoAllocate = async () => {
    setAutoBusy(true);
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
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoBusy(false);
    }
  };

  const openBook = (tx: BankTransaction) => {
    const m = matchCounterpart(tx.counterpart_name || "", counterparts);
    setBookTx(tx);
    setBookContra(0);
    setBookDebit(0);
    setBookCredit(0);
    setBookCpId(m?.id ?? 0);
    setBookCpSearch(tx.counterpart_name || "");
    setBookAccSearch("");
    // Предложение по ключови думи (като baraba) — предварително избрана сметка.
    api
      .get<{ account_id?: number; account_number?: string; account_name?: string }>(
        `/v1/bank-transactions/${tx.id}/suggest`
      )
      .then((s) => {
        if (s.account_id) setBookContra(s.account_id);
      })
      .catch(() => {});
  };

  const openReallocate = async (tx: BankTransaction) => {
    const m = matchCounterpart(tx.counterpart_name || "", counterparts);
    setReallocTx(tx);
    setReallocAccount(0);
    setReallocCpId(m?.id ?? 0);
    setReallocCpSearch(tx.counterpart_name || "");
    setReallocAccSearch("");
    setReallocLines([]);
    setReallocJeDesc("");
    if (tx.journal_entry_id > 0) {
      try {
        const je = await api.get<{ description?: string; lines?: JeLine[] }>(
          `/v1/journal/${tx.journal_entry_id}`
        );
        setReallocLines(je.lines ?? []);
        setReallocJeDesc(je.description ?? "");
      } catch {
        setReallocLines([]);
      }
    }
  };

  const bankGlId = (tx: BankTransaction | null): number => {
    if (!tx) return 0;
    const ba = accounts.find((a) => a.id === tx.bank_account_id);
    return ba?.gl_account_id ?? 0;
  };

  const handleBook = async () => {
    if (!bookTx) return;
    const gl = bankGlId(bookTx);
    const payload: Record<string, number> = {};
    if (gl > 0) {
      if (!bookContra) {
        setError(t("bank_tx.pick_contra"));
        return;
      }
      payload.contra_account_id = bookContra;
    } else {
      if (!bookDebit || !bookCredit) {
        setError(t("bank_tx.pick_both_accounts"));
        return;
      }
      payload.debit_account_id = bookDebit;
      payload.credit_account_id = bookCredit;
    }
    if (bookCpId > 0) payload.counterpart_id = bookCpId;
    setBookLoading(true);
    try {
      await api.post(`/v1/bank-transactions/${bookTx.id}/book`, payload);
      setSuccess(t("bank_tx.booked"));
      setBookTx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBookLoading(false);
    }
  };

  const handleReallocate = async () => {
    if (!reallocTx) return;
    if (!reallocAccount) {
      setError(t("bank_tx.pick_account"));
      return;
    }
    const payload: Record<string, number> = { account_id: reallocAccount };
    if (reallocCpId > 0) payload.counterpart_id = reallocCpId;
    setReallocLoading(true);
    try {
      const r = await api.post<{ message: string }>(
        `/v1/bank-transactions/${reallocTx.id}/reallocate`,
        payload
      );
      setSuccess(r.message || t("bank_tx.reallocated"));
      setReallocTx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReallocLoading(false);
    }
  };

  const handleDelete = async (tx: BankTransaction) => {
    if (!window.confirm(t("common.confirmDelete"))) return;
    try {
      await api.del(`/v1/bank-transactions/${tx.id}`);
      setReallocTx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUnbook = async (tx: BankTransaction) => {
    if (!window.confirm(t("bank_tx.unbook_confirm"))) return;
    try {
      await api.post(`/v1/bank-transactions/${tx.id}/unbook`, {});
      setSuccess(t("bank_tx.unbooked"));
      setReallocTx(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveJe = async (
    jeId: number,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    try {
      await api.put(`/v1/journal/${jeId}`, payload);
      setSuccess(t("bank_tx.je_saved"));
      if (reallocTx && reallocTx.journal_entry_id === jeId) {
        const je = await api.get<{ description?: string; lines?: JeLine[] }>(
          `/v1/journal/${jeId}`
        );
        setReallocLines(je.lines ?? []);
        setReallocJeDesc(je.description ?? "");
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const handleBulk = async (action: "unbook" | "delete") => {
    if (selected.length === 0) return;
    const msg =
      action === "delete"
        ? t("bank_tx.bulk_delete_confirm").replace("{n}", String(selected.length))
        : t("bank_tx.bulk_unbook_confirm").replace("{n}", String(selected.length));
    if (!window.confirm(msg)) return;
    setError("");
    setSuccess("");
    try {
      const r = await api.post<{ processed: number }>(
        "/v1/bank-transactions/bulk",
        { action, ids: selected }
      );
      setSelected([]);
      await load();
      setSuccess(
        (action === "delete"
          ? t("bank_tx.bulk_deleted")
          : t("bank_tx.bulk_unbooked")
        ).replace("{n}", String(r.processed ?? selected.length))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((sel) =>
      sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
    );
  };

  const allSelected = filteredRows.length > 0 && filteredRows.every((tx) => selected.includes(tx.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected([]);
    } else {
      setSelected(filteredRows.map((tx) => tx.id));
    }
  };

  const statusBadge = (tx: BankTransaction) => {
    if (tx.is_allocated)
      return (
        <span className="badge badge-success">{t("bank_tx.status.allocated")}</span>
      );
    if (tx.is_booked)
      return (
        <span className="badge badge-warning">{t("bank_tx.status.booked")}</span>
      );
    return <span className="badge badge-danger">{t("bank_tx.status.new")}</span>;
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{t("bank_tx.title")}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="select"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
          >
            <option value="">{t("bank_tx.all_accounts")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.iban})
              </option>
            ))}
          </select>
          <select
            className="select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">{t("bank_tx.all_statuses")}</option>
            <option value="new">{t("bank_tx.status.new")}</option>
            <option value="booked">{t("bank_tx.status.booked")}</option>
            <option value="allocated">{t("bank_tx.status.allocated")}</option>
          </select>
          <input
            className="input"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title={t("bank_tx.date_from")}
            style={{ maxWidth: 160 }}
          />
          <input
            className="input"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title={t("bank_tx.date_to")}
            style={{ maxWidth: 160 }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.sta,.mt940,.txt,.STA,.csv,.CSV"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {t("bank_tx.import_file")}
          </button>
          <button
            className="btn"
            onClick={handleAutoAllocate}
            disabled={autoBusy}
            type="button"
          >
            {t("bank_rules.auto")}
          </button>
          <a className="btn" href="/bank-matching-rules">
            {t("nav.bank_rules")}
          </a>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {success && (
        <div className="muted" style={{ color: "var(--success)", marginBottom: 12 }}>
          {success}
        </div>
      )}

      {selected.length > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span className="muted">
            {t("bank_tx.selected_count").replace("{n}", String(selected.length))}
          </span>
          <button
            className="btn btn-sm"
            onClick={() => handleBulk("unbook")}
            type="button"
          >
            {t("bank_tx.bulk_unbook")}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => handleBulk("delete")}
            type="button"
          >
            {t("bank_tx.bulk_delete")}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setSelected([])}
            type="button"
          >
            {t("bank_tx.select_none")}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("bank_tx.search_placeholder")}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="content muted">{t("common.loading")}</div>
        ) : filteredRows.length === 0 ? (
          <div className="content muted">{t("bank_tx.empty")}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ textAlign: "center", width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    title={t("bank_tx.select_all")}
                  />
                </th>
                <th>{t("bank_tx.date")}</th>
                <th>{t("bank_tx.description")}</th>
                <th>{t("bank_tx.counterpart")}</th>
                <th style={{ textAlign: "right" }}>{t("bank_tx.amount")}</th>
                <th style={{ textAlign: "center" }}>{t("bank_tx.status")}</th>
                <th style={{ textAlign: "right" }}>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((tx) => (
                <tr key={tx.id}>
                  <td style={{ textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(tx.id)}
                      onChange={() => toggleSelect(tx.id)}
                    />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{tx.transaction_date}</td>
                  <td
                    style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}
                    title={tx.description}
                  >
                    {tx.description}
                  </td>
                  <td>{tx.counterpart_name}</td>
                  <td
                    style={{
                      textAlign: "right",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                      color: isPositive(tx.amount)
                        ? "var(--success)"
                        : "var(--danger)",
                    }}
                  >
                    {fmtAmount(tx.amount)} {tx.currency}
                  </td>
                  <td style={{ textAlign: "center" }}>{statusBadge(tx)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div className="icon-actions" style={{ justifyContent: "flex-end" }}>
                      {!tx.is_booked && (
                        <button className="btn btn-sm" onClick={() => openBook(tx)}>
                          {t("bank_tx.book")}
                        </button>
                      )}
                      {tx.is_booked && (
                        <>
                          <button
                            className="btn btn-sm"
                            onClick={() => {
                              void openReallocate(tx);
                            }}
                          >
                            {t("bank_tx.preview_action")}
                          </button>
                          <button
                            className="btn btn-sm"
                            onClick={() => handleUnbook(tx)}
                          >
                            {t("bank_tx.unbook")}
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => handleDelete(tx)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>


      <BankTxModals
        t={t}
        counterparts={counterparts}
        chartAccounts={chartAccounts}
        previewOpen={previewOpen}
        setPreviewOpen={setPreviewOpen}
        previewLoading={previewLoading}
        preview={preview}
        importing={importing}
        handleImport={handleImport}
        bookTx={bookTx}
        setBookTx={setBookTx}
        bookCpId={bookCpId}
        bookCpSearch={bookCpSearch}
        setBookCpSearch={setBookCpSearch}
        setBookCpId={setBookCpId}
        bookContra={bookContra}
        bookAccSearch={bookAccSearch}
        setBookAccSearch={setBookAccSearch}
        setBookContra={setBookContra}
        bookDebit={bookDebit}
        setBookDebit={setBookDebit}
        bookCredit={bookCredit}
        setBookCredit={setBookCredit}
        handleBook={handleBook}
        bookLoading={bookLoading}
        reallocTx={reallocTx}
        setReallocTx={setReallocTx}
        reallocLines={reallocLines}
        reallocJeDesc={reallocJeDesc}
        reallocCpId={reallocCpId}
        reallocCpSearch={reallocCpSearch}
        setReallocCpSearch={setReallocCpSearch}
        setReallocCpId={setReallocCpId}
        reallocAccount={reallocAccount}
        reallocAccSearch={reallocAccSearch}
        setReallocAccSearch={setReallocAccSearch}
        setReallocAccount={setReallocAccount}
        handleReallocate={handleReallocate}
        reallocLoading={reallocLoading}
        bankGlId={bankGlId}
        handleUnbook={handleUnbook}
        handleDelete={handleDelete}
        handleSaveJe={handleSaveJe}
      />
    </div>
  );
}

export default function BankTransactionsPage() {
  return (
    <RequireAuth>
      <BankTransactionsInner />
    </RequireAuth>
  );
}
