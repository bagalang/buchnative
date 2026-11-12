"use client";

import { Account, Counterpart } from "./types";
import { cpLabel, filterAccounts, filterCounterparts } from "./helpers";

export function CounterpartSelect({
  t,
  counterparts,
  value,
  search,
  onSearch,
  onChange,
}: {
  t: (k: string) => string;
  counterparts: Counterpart[];
  value: number;
  search: string;
  onSearch: (v: string) => void;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <input
        className="input"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t("bank_tx.search_counterpart")}
        style={{ marginBottom: 6 }}
      />
      <select
        className="select"
        value={value || 0}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={0}>{t("bank_tx.none_counterpart")}</option>
        {filterCounterparts(counterparts, search).map((c) => (
          <option key={c.id} value={c.id}>
            {cpLabel(c)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AccountSelect({
  t,
  chartAccounts,
  value,
  search,
  onSearch,
  onChange,
}: {
  t: (k: string) => string;
  chartAccounts: Account[];
  value: number;
  search: string;
  onSearch: (v: string) => void;
  onChange: (v: number) => void;
}) {
  // Текущата сметка трябва да е в списъка, дори когато филтърът я
  // изпусне — иначе select-а лъжливо показва „изберете сметка“.
  const opts = filterAccounts(chartAccounts, search);
  const current = value > 0 ? chartAccounts.find((a) => a.id === value) : undefined;
  const list = current && !opts.some((a) => a.id === current.id) ? [current, ...opts] : opts;
  return (
    <div>
      <input
        className="input"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder={t("bank_tx.search_account")}
        style={{ marginBottom: 6 }}
      />
      <select
        className="select"
        value={value || 0}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={0}>{t("bank_tx.pick_account")}</option>
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {a.number} {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
