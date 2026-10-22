import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, subscribeUpdates } from "../api";

export default function NotificationCenter() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api("/notifications");
      setItems(data.notifications);
      setUnread(data.unreadCount);
      setError("");
    } catch (err) { setError(err.message); }
  }, []);

  useEffect(() => {
    load();
    return subscribeUpdates(event => {
      if (event.type === "notifications" || event.type === "reconnected") load();
    });
  }, [load]);

  async function openItem(item) {
    if (!item.readAt) {
      try { await api(`/notifications/${item._id}/read`, { method: "PATCH" }); await load(); }
      catch (err) { setError(err.message); return; }
    }
    setOpen(false);
    navigate(item.link);
  }

  async function readAll() {
    try { await api("/notifications/read-all", { method: "PATCH" }); await load(); }
    catch (err) { setError(err.message); }
  }

  return <div className="notification-center">
    <button className="notification-trigger" type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => { setOpen(value => !value); if (!open) load(); }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg> Notifications {unread > 0 && <strong>{unread > 99 ? "99+" : unread}</strong>}
    </button>
    {open && <div className="notification-popover" role="region" aria-label="Notifications">
      <div className="notification-head"><strong>Notifications</strong>{unread > 0 && <button type="button" onClick={readAll}>Mark all read</button>}</div>
      {error && <p className="notification-error" role="alert">{error}</p>}
      {!items.length && !error && <p className="notification-empty">No notifications yet.</p>}
      <div className="notification-list">{items.map(item => <button type="button" key={item._id} className={`notification-item ${item.readAt ? "read" : "unread"}`} onClick={() => openItem(item)}>
        <span className="notification-dot" aria-hidden="true" /><span><strong>{item.title}</strong><small>{item.body}</small><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></span>
      </button>)}</div>
    </div>}
  </div>;
}
