import React from "react";
import { Link } from "react-router-dom";

export default function AuthFrame({ eyebrow, title, intro, children }) {
  return <div className="auth-layout">
    <section className="auth-story">
      <Link className="brand" to="/"><span className="brand-mark">✦</span>Freelance<span className="brand-light">Chain</span></Link>
      <div className="auth-story-inner"><div className="pill pill-light">A BETTER WAY TO COLLABORATE</div><h1>Where good ideas become <em>great work.</em></h1><p>A shared place for projects, proposals and the milestones that move everything forward.</p><div className="auth-mini-card"><span className="mini-icon">✓</span><div><strong>Clear from day one</strong><small>Know the scope. See the progress. Approve the outcome.</small></div></div></div>
      <p className="auth-story-footer">Clear work. Shared progress.</p>
    </section>
    <section className="auth-form-side"><div className="auth-panel"><Link to="/" className="back-link">← Back to home</Link><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="auth-intro">{intro}</p>{children}</div></section>
  </div>;
}
