import React, { useEffect, useState } from "react";
import { api, currentUser } from "../api";
import AttachmentList from "./AttachmentList";
import useLiveUpdates from "../useLiveUpdates";

export default function ConversationPanel({ applicationId, projectId, otherLabel }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const userId = currentUser()?.id;

  useEffect(() => {
    let current = true;
    api(`/messages/application/${applicationId}`)
      .then(data => { if (current) { setMessages(data); setError(""); } })
      .catch(err => { if (current) setError(err.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [applicationId]);

  useLiveUpdates(event => {
    if (event.type !== "reconnected" && !(event.type === "messages" && event.projectId === projectId)) return;
    api(`/messages/application/${applicationId}`).then(setMessages).catch(() => {});
  });

  async function send(event) {
    event.preventDefault();
    const body = draft.trim();
    if (!body && !files.length) return;
    setBusy(true); setError("");
    try {
      const requestBody = files.length ? (() => {
        const form = new FormData();
        form.append("body", body);
        files.forEach(file => form.append("files", file));
        return form;
      })() : JSON.stringify({ body });
      const saved = await api(`/messages/application/${applicationId}`, { method: "POST", body: requestBody });
      setMessages(current => [...current, saved]);
      setDraft("");
      setFiles([]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="conversation-panel" aria-label={`Conversation with ${otherLabel}`}>
    <div className="conversation-heading"><strong>Conversation with {otherLabel}</strong><span>Keep project details in one place</span></div>
    <div className="conversation-messages" role="log" aria-live="polite">{loading ? <p>Loading messages…</p> : messages.length === 0 ? <p>No messages yet. Ask a question or share a project detail.</p> : messages.map(message => <div className={`conversation-message ${String(message.senderId) === String(userId) ? "mine" : "theirs"}`} key={message.id}><span>{String(message.senderId) === String(userId) ? "You" : otherLabel}</span>{message.body && <p>{message.body}</p>}<AttachmentList projectId={projectId} attachments={message.attachments} /><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></div>)}</div>
    {error && <p className="message error" role="alert">{error}</p>}
    <form onSubmit={send}><label htmlFor={`message-${applicationId}`} className="visually-hidden">Write a message to {otherLabel}</label><input id={`message-${applicationId}`} value={draft} onChange={event => setDraft(event.target.value)} maxLength="2000" placeholder="Write a message…" /><label className="file-picker">Attach<input type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp" multiple onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></label><button className="button button-dark" disabled={busy || (!draft.trim() && !files.length)}>{busy ? "Sending…" : "Send →"}</button></form>
    {files.length > 0 && <p className="selected-files">{files.map(file => file.name).join(", ")}</p>}
  </section>;
}
