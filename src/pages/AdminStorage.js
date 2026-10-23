import React, { useCallback, useEffect, useState } from "react";
import Shell from "../components/Shell";
import { api } from "../api";
import { fileSize } from "../components/AccountData";
export default function AdminStorage() {
  const [data, setData] = useState(null); const [preview, setPreview] = useState(null); const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => { setData(await api("/admin/storage")); }, []);
  useEffect(() => { load().catch(err => setError(err.message)); }, [load]);
  async function run(apply = false) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await api(apply ? "/admin/storage/cleanup" : "/admin/storage/preview", { method: "POST", ...(apply ? { body: JSON.stringify({ token: preview.token }) } : {}) });
      if (apply) { setNotice(`${result.message} Removed ${result.removedFiles} files; released ${result.releasedReservations} abandoned reservations; skipped ${result.skipped}.`); setPreview(null); await load(); }
      else { setPreview(result); setConfirmed(false); }
    } catch (err) { setError(err.message); if (apply) { setPreview(null); load().catch(() => {}); } } finally { setBusy(false); }
  }
  return <Shell role="admin" eyebrow="STORAGE" title="Attachment storage" subtitle="Review abandoned uploads before running a limited cleanup.">
    {error && <p className="message error" role="alert">{error}</p>}{notice && <p className="message success" role="status">{notice}</p>}
    <section className="panel account-settings-card"><h2>Storage limits</h2>{data ? <><p>{data.recordedFiles} recorded attachments · {fileSize(data.recordedBytes)} recorded bytes.</p>{data.shared && <p>Shared attachment allowance: {fileSize(data.shared.usedBytes)} of {fileSize(data.shared.maxBytes)} used · {data.shared.usedFiles} of {data.shared.maxFiles} files. This is shared across all accounts.</p>}<p>Per account: {fileSize(data.maxBytes)}, up to {data.maxFiles} files. Each file: {fileSize(data.maxFileBytes)}, {data.filesPerRequest} per request.</p></> : <p>Loading storage…</p>}<p>Recorded attachments, submission history, messages and case evidence are preserved. Cleanup considers only abandoned uploads without an attachment record, older than 24 hours. Files with metadata but no visible submission are retained for manual investigation.</p><button className="button button-outline" disabled={busy} onClick={() => run()}>Preview abandoned uploads</button>
      {preview && <div className="info-box"><h3>Cleanup preview</h3><p>{preview.candidates} eligible files or reservations · {fileSize(preview.bytes)} of file data. Up to {preview.batchLimit} items per run.</p><p>{preview.message} Preview expires {new Date(preview.expiresAt).toLocaleTimeString()}.</p>{preview.candidates > 0 && <><label className="acknowledge-row"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Remove the abandoned uploads in this preview. Each item will be checked again.</span></label><button className="button button-dark" disabled={busy || !confirmed} onClick={() => run(true)}>Remove previewed abandoned uploads</button></>}</div>}
    </section><section className="panel account-settings-card storage-history"><h2>Recent maintenance</h2><button className="text-button" disabled={busy} onClick={() => load().catch(err => setError(err.message))}>Refresh history</button>{data?.history?.length ? data.history.map(item => <div className="request-response" key={item._id}><strong>{item.status} · {new Date(item.createdAt).toLocaleString()}</strong><p>Removed: {item.removedFiles} · Reservations released: {item.releasedReservations} · Skipped: {item.skipped}</p><small>Administrator: {item.actor}</small></div>) : <p>No maintenance previews yet.</p>}</section>
  </Shell>;
}
