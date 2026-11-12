"use client";

// AccountPicker — търсещо падащо меню за сметка. Показва ЦЕЛИЯ сметкоплан
// (филтриран по номер/име), без обрязване до първите N реда. Запазва
// числовия контракт (value/onChange с id), който ползват банковите страници.

import { useEffect, useMemo, useRef, useState } from "react";
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
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}

export function AccountPicker({
  value,
  accounts,
  onChange,
  placeholder,
  disabled,
  allowClear,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = accounts.find((a) => a.id === value);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return accounts;
    return accounts.filter(
      (a) =>
        a.number.toLowerCase().includes(s) || a.name.toLowerCase().includes(s)
    );
  }, [accounts, search]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setSearch("");
      const id = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const pick = (id: number) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div className="acct-picker" ref={wrapRef}>
      <div
        className={`acct-picker-trigger${disabled ? " is-disabled" : ""}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className={`acct-picker-label${selected ? "" : " is-empty"}`}>
          {selected
            ? `${selected.number} · ${selected.name}`
            : placeholder ?? t("journal.account")}
        </span>
        {allowClear && selected && !disabled && (
          <button
            type="button"
            className="acct-picker-clear"
            title={t("journal.filter.clear")}
            onClick={(e) => {
              e.stopPropagation();
              onChange(0);
            }}
          >
            ✕
          </button>
        )}
        <span className="acct-picker-caret" aria-hidden>
          ▾
        </span>
      </div>
      {open && !disabled && (
        <div className="acct-picker-panel">
          <input
            ref={searchRef}
            className="input acct-picker-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("journal.account_search")}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="acct-picker-list" role="listbox">
            {filtered.map((a) => (
              <button
                type="button"
                key={a.id}
                role="option"
                aria-selected={a.id === value}
                className={`acct-picker-option${
                  a.id === value ? " is-active" : ""
                }`}
                onClick={() => pick(a.id)}
              >
                <span className="acct-picker-num">{a.number}</span>
                <span className="acct-picker-name">{a.name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="acct-picker-empty">{t("journal.no_accounts")}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}