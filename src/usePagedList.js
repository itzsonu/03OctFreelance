import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function readPage(data, page = 1, size = 12) {
  if (Array.isArray(data)) return { items: data, total: data.length, page, pageSize: size, pages: Math.ceil(data.length / size), summary: null };
  return { items: [], total: 0, page, pageSize: size, pages: 0, summary: null, ...data };
}
export default function usePagedList(path, size = 12, enabled = true) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(() => readPage([], 1, size));
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const version = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const current = {}; version.current = current;
    setLoading(true); setError("");
    try {
      const result = readPage(await api(`${path}${path.includes("?") ? "&" : "?"}page=${page}&pageSize=${size}`), page, size);
      if (current !== version.current) return;
      if (page > Math.max(1, result.pages)) { setPage(Math.max(1, result.pages)); return; }
      setData(result);
    } catch (err) { if (current === version.current) setError(err.message); }
    finally { if (current === version.current) setLoading(false); }
  }, [path, page, size, enabled]);
  useEffect(() => { reload(); return () => { version.current = null; }; }, [reload]);
  return { ...data, page, setPage, loading, error, reload, setItems: value => setData(current => ({ ...current, items: typeof value === "function" ? value(current.items) : value })) };
}
