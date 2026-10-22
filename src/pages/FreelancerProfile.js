import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Shell from "../components/Shell";
import TrustEvidence from "../components/TrustEvidence";
import ProfileSetup from "../components/ProfileSetup";

const categories = ["Web Development", "Design & Creative", "Writing & Translation", "Marketing", "Data & Analytics", "Video & Animation", "Admin & Support", "Other"];
const empty = { headline: "", bio: "", skills: "", preferredCategories: [], experienceYears: 0, portfolioUrl: "", portfolioItems: [], availability: "available", hourlyRate: "", discoverable: false };
const parseSkills = value => [...new Set(value.split(",").map(skill => skill.trim()).filter(Boolean))];
const fromProfile = profile => ({ ...empty, ...profile, skills: (profile.skills || []).join(", "), preferredCategories: profile.preferredCategories || [], portfolioItems: profile.portfolioItems || [], hourlyRate: profile.hourlyRate ?? "", discoverable: Boolean(profile.discoverable) });

export default function FreelancerProfile() {
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [trust, setTrust] = useState(null);
  const [setup, setSetup] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api("/profile/me").then(data => {
      if (!active) return;
      setTrust(data.trust || null); setSetup(data.setup || null); setForm(fromProfile(data.profile || {})); setLoaded(true);
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  async function save(event) {
    event.preventDefault(); setError(""); setNotice("");
    const skills = parseSkills(form.skills);
    if (skills.length > 15) { setError("Add up to 15 skills."); return; }
    if (form.portfolioItems.some(item => !item.title.trim() || !/^https?:\/\//i.test(item.url))) { setError("Give every portfolio item a title and a valid HTTP or HTTPS link, or remove the empty item."); return; }
    setBusy(true);
    try {
      const data = await api("/profile/me", { method: "PUT", body: JSON.stringify({ ...form, skills, experienceYears: Number(form.experienceYears), hourlyRate: form.hourlyRate === "" ? null : Number(form.hourlyRate) }) });
      setForm(fromProfile(data.profile)); setSetup(data.setup || null);
      setNotice(data.profile.discoverable ? "Profile saved. Clients can now find you in talent search." : "Profile saved. Your project suggestions will use these details; talent search visibility stays off.");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function updatePortfolioItem(index, key, value) {
    setForm(current => ({ ...current, portfolioItems: current.portfolioItems.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  }
  function toggleCategory(category) {
    setForm(current => ({ ...current, preferredCategories: current.preferredCategories.includes(category) ? current.preferredCategories.filter(item => item !== category) : [...current.preferredCategories, category] }));
  }

  return <Shell role="freelancer" eyebrow="FREELANCER PROFILE" title="Show what you do best." subtitle="Start with your skills and the work you want to do. No platform history required." action={<Link className="button button-outline" to="/freelancer-dashboard">← Find projects</Link>}>
    {error && <div className="message error" role="alert">{error}</div>}
    {notice && <div className="message success" role="status">{notice}<Link to="/freelancer-dashboard"> See project suggestions →</Link></div>}
    {!loading && <ProfileSetup setup={setup} />}
    {loading ? <p className="empty-state">Loading your profile…</p> : !loaded ? <div className="empty-state"><p>Your saved profile could not be loaded.</p><button className="button button-outline" onClick={() => setLoadAttempt(value => value + 1)}>Retry profile</button></div> : <form onSubmit={save}>
      <div className="profile-layout"><section className="panel profile-form-panel"><div className="panel-heading"><div><p className="eyebrow">YOUR DETAILS</p><h2>Freelancer profile</h2></div></div>
        <div className="stack-form">
          <div id="profile-intro" className="profile-form-group">
            <label>Professional headline<input maxLength="100" value={form.headline} onChange={event => setForm({ ...form, headline: event.target.value })} placeholder="e.g. React developer for booking dashboards" /></label>
            <label>About you<textarea rows="5" maxLength="1200" value={form.bio} onChange={event => setForm({ ...form, bio: event.target.value })} placeholder="Describe what you can create, problems you enjoy solving and how you work." /></label>
          </div>
          <label id="profile-skills">Skills <small>Separate each skill with a comma. Start with skills you can demonstrate.</small><input value={form.skills} onChange={event => setForm({ ...form, skills: event.target.value })} placeholder="React, Node.js, UI design" /></label>
          <div className="form-row"><label>Years of experience<input type="number" min="0" max="60" value={form.experienceYears} onChange={event => setForm({ ...form, experienceYears: event.target.value })} /><small>Zero is fine when you are starting. This is self-reported experience.</small></label><label>Portfolio URL<input type="url" value={form.portfolioUrl} onChange={event => setForm({ ...form, portfolioUrl: event.target.value })} placeholder="https://your-portfolio.com" /></label></div>
          <fieldset className="profile-preferences" id="profile-preferences"><legend>Preferred work fields</legend><p>Choose the fields you want to explore. You can still browse every category.</p><div className="preference-options">{categories.map(category => <label key={category}><input type="checkbox" checked={form.preferredCategories.includes(category)} onChange={() => toggleCategory(category)} />{category}</label>)}</div></fieldset>
          <label>Availability<select value={form.availability} onChange={event => setForm(current => ({ ...current, availability: event.target.value }))}><option value="available">Available for work</option><option value="limited">Limited availability</option><option value="unavailable">Not available</option></select></label>
          <label className="visibility-control"><input type="checkbox" checked={form.discoverable} onChange={event => setForm({ ...form, discoverable: event.target.checked })} /><span>Show my profile in client talent search<small>Clients can see your name, bio, skills, portfolio links and verified work score. Email stays private.</small></span></label>
          <p className="form-help">Visibility is optional. Without it, clients can still review your profile when you send them a proposal.</p>
          <button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save profile ↗"}</button>
        </div>
      </section><aside className="profile-side"><div className="trust-profile-card"><p className="eyebrow">VERIFIED WORK</p><h3>Trust score</h3><strong>{trust?.score == null ? "No score yet" : `${trust.score}/100`}</strong><p>{trust?.score == null ? "No approved work on FreelanceChain yet. Your skills and profile can still help you find relevant projects." : `${trust.approvedMilestones} approved milestones · ${trust.completedProjects} completed projects · ${trust.revisionRequests} revision requests.`}</p><TrustEvidence trust={trust} /><small>Only platform-approved work builds this score. Portfolio samples and self-reported experience are separate.</small></div><div className="profile-help"><span>✦</span><h3>Start with an honest example</h3><p>A practice project, personal website or writing sample can show how you work. Explain what you created yourself and what you learned.</p></div></aside></div>
      <section className="panel profile-extension-panel" id="profile-samples"><div className="panel-heading"><div><p className="eyebrow">OPTIONAL WORK SAMPLES</p><h2>Portfolio and availability</h2></div></div><div className="stack-form">
        <label>Hourly rate (₹)<input type="number" min="0" max="10000000" value={form.hourlyRate} onChange={event => setForm(current => ({ ...current, hourlyRate: event.target.value }))} placeholder="Optional" /></label>
        <div className="portfolio-editor"><div className="portfolio-editor-heading"><div><strong>Portfolio items</strong><small>External links only. Practice and personal projects are welcome; these are not platform-verified approvals.</small></div><button type="button" className="button button-outline" disabled={form.portfolioItems.length >= 10} onClick={() => setForm(current => ({ ...current, portfolioItems: [...current.portfolioItems, { title: "", description: "", url: "" }] }))}>+ Add item</button></div>
          {form.portfolioItems.length === 0 && <p className="form-help">You can save your profile without a work sample and add one later.</p>}
          {form.portfolioItems.map((item, index) => <fieldset className="portfolio-edit-item" key={index}><legend>Portfolio item {index + 1}</legend><button type="button" className="text-button danger" onClick={() => setForm(current => ({ ...current, portfolioItems: current.portfolioItems.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button><label>Title<input required maxLength="80" value={item.title} onChange={event => updatePortfolioItem(index, "title", event.target.value)} placeholder="e.g. My practice booking dashboard" /></label><label>Short description<textarea rows="2" maxLength="300" value={item.description} onChange={event => updatePortfolioItem(index, "description", event.target.value)} placeholder="Describe your contribution and what this example demonstrates." /></label><label>External link<input required type="url" maxLength="500" value={item.url} onChange={event => updatePortfolioItem(index, "url", event.target.value)} placeholder="https://example.com/work" /></label></fieldset>)}
        </div><button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save portfolio details"}</button>
      </div></section>
    </form>}
  </Shell>;
}
