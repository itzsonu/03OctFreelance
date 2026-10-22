import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, currentUser } from "../api";
import AttachmentList from "./AttachmentList";
import useLiveUpdates from "../useLiveUpdates";

export default function ConversationPanel({ applicationId, projectId, otherLabel }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [olderBusy, setOlderBusy] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const context = useRef(null);
  const log = useRef(null);
  const scroll = useRef(null);
  const userId = currentUser()?.id;
  const sameConversation = context.current?.id === applicationId;
  const active = ctx => ctx && ctx.alive && context.current === ctx;
  const page = data => Array.isArray(data) ? { messages: data, hasOlder: false } : data;
  function merge(ctx, additions) {
    if (!active(ctx)) return;
    const byId = new Map(ctx.messages.map(item => [String(item.id), item]));
    additions.forEach(item => byId.set(String(item.id), item));
    ctx.messages = [...byId.values()].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id)));
    setMessages(ctx.messages);
  }
  async function refresh(ctx = context.current) {
    if (!active(ctx)) return;
    if (ctx.refreshing) { ctx.again = true; return; }
    ctx.refreshing = true;
    try {
      do {
        ctx.again = false;
        const after = ctx.after;
        const data = page(await api(`/messages/application/${ctx.id}?limit=30${after ? `&after=${encodeURIComponent(after)}` : ""}`));
        if (!active(ctx)) return;
        merge(ctx, data.messages || []);
        if (!after) { ctx.before = data.beforeCursor; setHasOlder(Boolean(data.hasOlder)); }
        ctx.after = data.afterCursor || ctx.after;
        if (data.hasMore) ctx.again = true;
        setError("");
      } while (active(ctx) && ctx.again);
    } catch (err) { if (active(ctx)) setError(err.message); }
    finally { ctx.refreshing = false; if (active(ctx)) setLoading(false); }
  }
  useEffect(() => {
    const ctx = { id: applicationId, alive: true, messages: [], after: null, before: null, refreshing: false, again: false };
    context.current = ctx; setMessages([]); setDraft(""); setFiles([]); setHasOlder(false); setOlderBusy(false); setBusy(false); setLoading(true); setError("");
    refresh(ctx);
    return () => { ctx.alive = false; };
    // The context owns requests for this conversation; late responses are ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);
  useLayoutEffect(() => {
    if (scroll.current && log.current) { log.current.scrollTop = scroll.current.top + log.current.scrollHeight - scroll.current.height; scroll.current = null; }
  }, [messages]);
  useLiveUpdates(event => {
    if (event.type === "reconnected" || (event.type === "messages" && event.projectId === projectId)) refresh();
  });
  async function older() {
    const ctx = context.current;
    if (!active(ctx) || ctx.olderBusy || !ctx.before) return;
    ctx.olderBusy = true; setOlderBusy(true); setError("");
    try {
      const data = page(await api(`/messages/application/${ctx.id}?limit=30&before=${encodeURIComponent(ctx.before)}`));
      if (!active(ctx)) return;
      if (log.current) scroll.current = { top: log.current.scrollTop, height: log.current.scrollHeight };
      merge(ctx, data.messages || []); ctx.before = data.beforeCursor; setHasOlder(Boolean(data.hasOlder));
    } catch (err) { if (active(ctx)) setError(err.message); }
    finally { ctx.olderBusy = false; if (active(ctx)) setOlderBusy(false); }
  }
  async function send(event) {
    event.preventDefault();
    const body = draft.trim(); const ctx = context.current;
    if (!active(ctx) || (!body && !files.length)) return;
    setBusy(true); setError("");
    try {
      const requestBody = files.length ? (() => { const form = new FormData(); form.append("body", body); files.forEach(file => form.append("files", file)); return form; })() : JSON.stringify({ body });
      const saved = await api(`/messages/application/${ctx.id}`, { method: "POST", body: requestBody });
      if (!active(ctx)) return;
      merge(ctx, [saved]); setDraft(""); setFiles([]); refresh(ctx);
    } catch (err) { if (active(ctx)) setError(err.message); }
    finally { if (active(ctx)) setBusy(false); }
  }
  return <section className="conversation-panel" aria-label={`Conversation with ${otherLabel}`}>
    <div className="conversation-heading"><strong>Conversation with {otherLabel}</strong><span>Keep project details in one place</span></div>
    {sameConversation && hasOlder && <button type="button" className="button button-outline conversation-older" disabled={olderBusy} onClick={older}>{olderBusy ? "Loading older messages…" : "Load older messages"}</button>}
    <div className="conversation-messages" role="log" aria-live="polite" ref={log}>{loading || !sameConversation ? <p>Loading messages…</p> : messages.length === 0 ? <p>No messages yet. Ask a question or share a project detail.</p> : messages.map(message => <div className={`conversation-message ${String(message.senderId) === String(userId) ? "mine" : "theirs"}`} key={message.id}><span>{String(message.senderId) === String(userId) ? "You" : otherLabel}</span>{message.body && <p>{message.body}</p>}<AttachmentList projectId={projectId} attachments={message.attachments} /><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></div>)}</div>
    {error && <p className="message error" role="alert">{error}<button type="button" className="text-button" onClick={() => refresh()}>Refresh messages</button></p>}
    <form onSubmit={send}><label htmlFor={`message-${applicationId}`} className="visually-hidden">Write a message to {otherLabel}</label><input id={`message-${applicationId}`} value={sameConversation ? draft : ""} onChange={event => setDraft(event.target.value)} maxLength="2000" placeholder="Write a message…" disabled={busy} /><label className="file-picker">Attach<input type="file" accept=".pdf,.txt,.csv,.png,.jpg,.jpeg,.webp" multiple disabled={busy} onChange={event => setFiles(Array.from(event.target.files || []).slice(0, 3))} /></label><button className="button button-dark" disabled={loading || !sameConversation || busy || (!draft.trim() && !files.length)}>{busy ? "Sending…" : "Send →"}</button></form>
    {files.length > 0 && <p className="selected-files">{files.map(file => file.name).join(", ")}</p>}
  </section>;
}
