"use client";

// Предложение на код по КН8 (комбинирана номенклатура) при създаване на артикул.
// Търси се по търговска дума или по самия код; каталогът е намеритичен.

import { useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "./I18nProvider";

interface Cn8Item {
  code: string;
  name: string;
}

export function Cn8Picker({
  code,
  name,
  productName,
  onChange,
}: {
  code: string;
  name: string;
  productName: string;
  onChange: (code: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Cn8Item[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const search = async (query: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ items?: Cn8Item[] }>("/v1/products/cn8-suggest", {
        q: query,
      });
      setItems(r.items ?? []);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="btn-row">
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("products.cn8_placeholder")}
        />
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void search(q)}
        >
          {t("products.cn8_find")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || productName.trim() === ""}
          onClick={() => void search(productName)}
        >
          {t("products.cn8_from_name")}
        </button>
      </div>
      {code !== "" && (
        <p className="muted" style={{ marginTop: 6 }}>
          {code}
          {name ? ` — ${name}` : ""}
        </p>
      )}
      {error && (
        <p className="error-text" style={{ marginTop: 6 }}>
          {error}
        </p>
      )}
      {open && items.length > 0 && (
        <ul className="cn8-list">
          {items.map((it) => (
            <li key={it.code}>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onChange(it.code, it.name);
                  setOpen(false);
                }}
              >
                <strong>{it.code}</strong> {it.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {open && items.length === 0 && !error && (
        <p className="muted" style={{ marginTop: 6 }}>
          {t("products.cn8_empty")}
        </p>
      )}
    </div>
  );
}
