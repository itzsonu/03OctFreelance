import React, { useEffect, useState } from "react";
import { api } from "../api";

export default function ProjectDrafts({ refreshKey, onContinue }) {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  async function load() {
    try { const data = await api("/project-drafts"); setDrafts(data.drafts || []); setError(""); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [refreshKey]);
  async function act(draft, remove = false) {
    setBusy(draft._id); setError("");
    try {
      if (remove) { await api(`/project-drafts/${draft._id}`, { method: "DELETE", body: JSON.stringify({ version: draft.__v }) }); setDeleting(null); await load(); }
      else { const result = await api(`/project-drafts/${draft._id}`); onContinue(result.draft); }
    } catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }
  return <section className="panel project-drafts"><div className="panel-heading"><div><p className="eyebrow">CONTINUE LATER</p><h2>Saved drafts</h2><p>Private to your account. Freelancers see a project only after you publish it.</p></div><span className="count-pill">{drafts.length}</span></div>
    {error && <p className="message error" role="alert">{error}<button type="button" className="text-button" onClick={load}>Retry drafts</button></p>}
    {loading ? <p>Loading saved drafts…</p> : !drafts.length ? <p>No saved drafts yet. Choose “Save draft and close” while creating a project.</p> : drafts.map(draft => <article className="saved-draft-row" key={draft._id}><div><h3>{draft.form?.title || "Untitled project"}</h3><small>Saved {new Date(draft.updatedAt).toLocaleString()}{draft.state === "publishing" ? " · Publishing started; continue to finish" : ""}</small></div><div className="dialog-actions"><button type="button" className="button button-outline" disabled={Boolean(busy)} onClick={() => act(draft)}>Continue draft</button>{draft.state === "draft" && <button type="button" className="text-button danger" disabled={Boolean(busy)} onClick={() => setDeleting(draft._id)}>Delete draft</button>}{deleting === draft._id && <><span>Delete this saved draft?</span><button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => setDeleting(null)}>Keep draft</button><button type="button" className="text-button danger" disabled={Boolean(busy)} onClick={() => act(draft, true)}>Confirm delete</button></>}</div></article>)}
  </section>;
}
