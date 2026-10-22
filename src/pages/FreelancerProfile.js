import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import TrustEvidence from "../components/TrustEvidence";

const empty = { headline: "", bio: "", skills: "", experienceYears: 0, portfolioUrl: "", portfolioItems: [], availability: "available", hourlyRate: "", discoverable: false };
const parseSkills = value => [...new Set(value.split(",").map(skill => skill.trim()).filter(Boolean))];

export default function FreelancerProfile() {
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trust, setTrust] = useState(null);

  useEffect(() => {
    api("/profile/me").then(data => {
      const profile = data.profile || {};
      setTrust(data.trust || null);
      setForm({ headline: profile.headline || "", bio: profile.bio || "", skills: (profile.skills || []).join(", "), experienceYears: profile.experienceYears || 0, portfolioUrl: profile.portfolioUrl || "", portfolioItems: profile.portfolioItems || [], availability: profile.availability || "available", hourlyRate: profile.hourlyRate ?? "", discoverable: Boolean(profile.discoverable) });
    }).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, []);

  async function save(event) {
    event.preventDefault(); setError(""); setNotice("");
    const skills = parseSkills(form.skills);
    if (skills.length > 15) { setError("Add up to 15 skills."); return; }
    setBusy(true);
    try {
      const data = await api("/profile/me", { method: "PUT", body: JSON.stringify({ ...form, skills, experienceYears: Number(form.experienceYears), hourlyRate: form.hourlyRate === "" ? null : Number(form.hourlyRate) }) });
      setForm({ ...form, skills: (data.profile.skills || []).join(", "), portfolioItems: data.profile.portfolioItems || [], hourlyRate: data.profile.hourlyRate ?? "" });
      setNotice(form.discoverable ? "Profile saved. Clients can now find you in talent search." : "Profile saved. Clients can see it when reviewing your proposals.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  function updatePortfolioItem(index, key, value) {
    setForm(current => ({ ...current, portfolioItems: current.portfolioItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  }

  return <Shell role="freelancer" eyebrow="FREELANCER PROFILE" title="Show what you do best." subtitle="A clear profile helps clients understand the person behind your proposal." action={<Link className="button button-outline" to="/freelancer-dashboard">← Find projects</Link>}>
    {error && <div className="message error" role="alert">{error}</div>}
    {notice && <div className="message success" role="status">{notice}</div>}
    <div className="profile-layout"><section className="panel profile-form-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR DETAILS</p><h2>Freelancer profile</h2></div></div>{loading ? <p className="empty-state">Loading your profile…</p> : <form className="stack-form" onSubmit={save}><label>Professional headline<input maxLength="100" value={form.headline} onChange={event => setForm({ ...form, headline: event.target.value })} placeholder="e.g. Full stack developer for early-stage teams" /></label><label>About you<textarea rows="6" maxLength="1200" value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} placeholder="Share your strengths, the work you enjoy and how you collaborate…" /></label><label>Skills <small>Separate each skill with a comma</small><input value={form.skills} onChange={event => setForm({ ...form, skills: event.target.value })} placeholder="React, Node.js, UI design" /></label><div className="form-row"><label>Years of experience<input type="number" min="0" max="60" value={form.experienceYears} onChange={event => setForm({ ...form, experienceYears: event.target.value })} /></label><label>Portfolio URL<input type="url" value={form.portfolioUrl} onChange={event => setForm({ ...form, portfolioUrl: event.target.value })} placeholder="https://your-portfolio.com" /></label></div><label className="visibility-control"><input type="checkbox" checked={form.discoverable} onChange={event => setForm({ ...form, discoverable: event.target.checked })} /><span>Show my profile in client talent search<small>Clients can see your name, bio, skills, portfolio link and verified work score. Email stays private.</small></span></label><p className="form-help">Without this option, your profile appears only to clients reviewing your proposal.</p><button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save profile ↗"}</button></form>}</section><aside className="profile-side"><div className="trust-profile-card"><p className="eyebrow">VERIFIED WORK</p><h3>Trust score</h3><strong>{trust?.score == null ? "New" : `${trust.score}/100`}</strong><p>{trust?.score == null ? "Complete milestones to build a verified history." : `${trust.approvedMilestones} approved milestones · ${trust.completedProjects} completed projects · ${trust.revisionRequests} revision requests.`}</p><TrustEvidence trust={trust} /><small>Calculated from work approved on FreelanceChain. Clients see it when reviewing your proposal.</small></div><div className="profile-help"><span>✦</span><h3>Make your proposal stronger</h3><p>Give clients a short picture of your experience, key skills and relevant work. Your proposal should still explain how you would approach each project.</p></div></aside></div>
    <section className="panel profile-extension-panel"><div className="panel-heading"><div><p className="eyebrow">MORE ABOUT YOUR WORK</p><h2>Portfolio and availability</h2></div></div>{loading ? <p className="empty-state">Loading profile details…</p> : <form className="stack-form" onSubmit={save}><div className="form-row"><label>Availability<select value={form.availability} onChange={event => setForm(current => ({ ...current, availability: event.target.value }))}><option value="available">Available for work</option><option value="limited">Limited availability</option><option value="unavailable">Not available</option></select></label><label>Hourly rate (₹)<input type="number" min="0" max="10000000" value={form.hourlyRate} onChange={event => setForm(current => ({ ...current, hourlyRate: event.target.value }))} placeholder="Optional" /></label></div><div className="portfolio-editor"><div className="portfolio-editor-heading"><div><strong>Portfolio items</strong><small>External links only. Add up to 10 examples.</small></div><button type="button" className="button button-outline" disabled={form.portfolioItems.length >= 10} onClick={() => setForm(current => ({ ...current, portfolioItems: [...current.portfolioItems, { title: "", description: "", url: "" }] }))}>+ Add item</button></div>{form.portfolioItems.length === 0 && <p className="form-help">No portfolio items added yet.</p>}{form.portfolioItems.map((item, index) => <fieldset className="portfolio-edit-item" key={index}><legend>Portfolio item {index + 1}</legend><button type="button" className="text-button danger" onClick={() => setForm(current => ({ ...current, portfolioItems: current.portfolioItems.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button><label>Title<input required maxLength="80" value={item.title} onChange={event => updatePortfolioItem(index, "title", event.target.value)} /></label><label>Short description<textarea rows="2" maxLength="300" value={item.description} onChange={event => updatePortfolioItem(index, "description", event.target.value)} /></label><label>External link<input required type="url" maxLength="500" value={item.url} onChange={event => updatePortfolioItem(index, "url", event.target.value)} placeholder="https://example.com/work" /></label></fieldset>)}</div><button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save portfolio details"}</button></form>}</section>
  </Shell>;
}
