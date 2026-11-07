"use client";

// Pager — предишна/следваща страница с общ брой редове.
// Странициране е на сървъра: клиентът подава offset/limit и получава total.

import { useI18n } from "./I18nProvider";

export function Pager({
  offset,
  limit,
  total,
  loading,
  onPage,
  labels,
}: {
  offset: number;
  limit: number;
  total: number;
  loading: boolean;
  onPage: (offset: number) => void;
  labels?: { prev: string; next: string; info: string };
}) {
  const { t } = useI18n();
  const prev = labels?.prev ?? t("common.prev");
  const next = labels?.next ?? t("common.next");
  const info = labels?.info ?? t("common.page_info");
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="btn-row" style={{ marginTop: 16 }}>
      <button
        className="btn"
        type="button"
        disabled={offset === 0 || loading}
        onClick={() => onPage(Math.max(0, offset - limit))}
      >
        {prev}
      </button>
      <span className="muted">
        {info
          .replace("{page}", String(page))
          .replace("{pages}", String(pages))
          .replace("{total}", String(total))}
      </span>
      <button
        className="btn"
        type="button"
        disabled={offset + limit >= total || loading}
        onClick={() => onPage(offset + limit)}
      >
        {next}
      </button>
    </div>
  );
}
