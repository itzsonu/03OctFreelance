import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import useLiveUpdates from "../useLiveUpdates";

export default function ReviewPanel({ projectId, role }) {
  const [review, setReview] = useState(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const otherLabel = role === "client" ? "freelancer" : "client";

  const load = useCallback(async () => {
    try { setReview(await api(`/reviews/project/${projectId}`)); setError(""); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);
  useLiveUpdates(event => { if (event.type === "reconnected" || (event.type === "project" && event.projectId === projectId)) load(); });

  async function submit(event) {
    event.preventDefault();
    if (text.trim().length < 10) return;
    setBusy(true); setError("");
    try {
      await api(`/reviews/project/${projectId}`, { method: "POST", body: JSON.stringify({ rating: Number(rating), text: text.trim() }) });
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="panel review-panel" aria-label="Project review"><div className="panel-heading"><div><p className="eyebrow">AFTER DELIVERY</p><h2>Project review</h2></div></div><div className="review-content">
    {loading ? <p>Loading reviews…</p> : review?.mine ? <><div className="review-entry"><strong>Your review of the {otherLabel} · {review.mine.rating}/5 stars</strong><p>{review.mine.text}</p></div>{review.other ? <div className="review-entry"><strong>{otherLabel === "client" ? "Client" : "Freelancer"} review · {review.other.rating}/5 stars</strong><p>{review.other.text}</p></div> : <p className="form-help">Your review is saved. The other person's review appears after they submit theirs.</p>}</> : <><p>How was it working with this {otherLabel}? Both reviews become visible after both people submit. Reviews cannot be edited.</p><form className="stack-form" onSubmit={submit}><label>Rating<select value={rating} onChange={event => setRating(event.target.value)} aria-label="Project rating"><option value="5">5 stars — Excellent</option><option value="4">4 stars — Good</option><option value="3">3 stars — Okay</option><option value="2">2 stars — Difficult</option><option value="1">1 star — Poor</option></select></label><label>Your feedback<textarea required minLength="10" maxLength="1000" rows="4" value={text} onChange={event => setText(event.target.value)} placeholder="Describe what went well and what could improve…" /></label><button className="button button-dark" disabled={busy || text.trim().length < 10}>{busy ? "Saving…" : "Submit review ↗"}</button></form></>}
    {error && <p className="message error" role="alert">{error}</p>}
  </div></section>;
}
