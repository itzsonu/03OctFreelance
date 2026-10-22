import React, { useState } from "react";
import { downloadAttachment } from "../api";

export default function AttachmentList({ projectId, attachments = [] }) {
  const [error, setError] = useState("");
  if (!attachments.length) return null;
  return <ul className="attachment-list">{attachments.map(attachment => <li key={attachment.id || attachment._id}>
    <button type="button" className="attachment-download" onClick={async () => {
      setError("");
      try { await downloadAttachment(projectId, { ...attachment, id: attachment.id || attachment._id }); }
      catch (err) { setError(err.message); }
    }}>↓ {attachment.filename || "Attachment"} <small>{Math.ceil((attachment.size || 0) / 1024)} KB</small></button>
    {error && <span className="attachment-error" role="alert">{error}</span>}
  </li>)}</ul>;
}