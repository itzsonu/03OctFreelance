import React from "react";
export default function Pagination({ page = 1, pages = 0, total = 0, loading, onPage, label = "results" }) {
  if (pages <= 1 && page <= 1) return null;
  return <nav className="list-pagination" aria-label={`${label} pagination`}><span>{total} {label} · Page {page} of {Math.max(1, pages)}</span><div><button type="button" className="button button-outline" disabled={loading || page <= 1} onClick={() => onPage(page - 1)} aria-label={`Previous ${label} page`}>← Previous</button><button type="button" className="button button-outline" disabled={loading || page >= pages} onClick={() => onPage(page + 1)} aria-label={`Next ${label} page`}>Next →</button></div></nav>;
}
