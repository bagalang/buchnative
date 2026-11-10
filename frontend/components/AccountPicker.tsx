"use client";

// Търсачка към сметкоплана (accounts): текст + подреден списък.
// Без hardcode на списъка — филтрира по номер и име.

import { useMemo, useState } from "react";
import { useI18n } from "./I18nProvider";

export interface AccountOption {
  id: number;
  number: string;
  name: string;
}

interface Props {
  value: number;
  accounts: AccountOption[];
  onChange: (id: number) => void;
}

export function AccountPicker({ value, accounts, onChange }: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return accounts.slice(0, 100);
    return accounts
      .filter((a) => `${a.number} ${a.name}`.toLowerCase().includes(s))
      .slice(0, 100);
  }, [accounts, q]);

  return (
    <div className="unit-picker">
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("bank_accounts.search_account")}
      />
      <select
        className="select"
        value={value || 0}
        size={6}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={0}>{t("bank_accounts.pick_account")}</option>
        {filtered.map((a) => (
          <option key={a.id} value={a.id}>
            {a.number} — {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
