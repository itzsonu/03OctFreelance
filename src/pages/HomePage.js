import { projectCategoryLabel } from "../projectCategory";
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

const money = value => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const steps = [
  { number: "01", title: "Post a clear brief", text: "Share the work, budget, skills and milestones you need." },
  { number: "02", title: "Choose your partner", text: "Review proposals and find a freelancer who fits the project." },
  { number: "03", title: "Deliver together", text: "Submit, review and approve each milestone in one workspace." },
];

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const locationSearch = searchParams.toString();
  const query = searchParams.get("q") || "";
  const skill = searchParams.get("skill") || "";
  const [draftQuery, setDraftQuery] = useState(query);
  const [filters, setFilters] = useState({ category: "", skill: "", minBudget: "", maxBudget: "", deadlineFrom: "", deadlineTo: "", sort: "newest" });
  const [featuredSkills, setFeaturedSkills] = useState([]);
  const [projects, setProjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    setDraftQuery(params.get("q") || "");
    setFilters({ category: params.get("category") || "", skill: params.get("skill") || "", minBudget: params.get("minBudget") || "", maxBudget: params.get("maxBudget") || "", deadlineFrom: params.get("deadlineFrom") || "", deadlineTo: params.get("deadlineTo") || "", sort: params.get("sort") || "newest" });
  }, [locationSearch]);

  useEffect(() => {
    let current = true;
    const source = new URLSearchParams(locationSearch);
    const params = new URLSearchParams();
    ["q", "skill", "category", "minBudget", "maxBudget", "deadlineFrom", "deadlineTo", "sort", "page"].forEach(key => {
      const value = source.get(key);
      if (value) params.set(key, value);
    });
    setLoading(true);
    const filters = params.toString();
    api(`/projects/public${filters ? `?${filters}` : ""}`)
      .then(data => {
        if (!current) return;
        setProjects(data.projects || []);
        setTotal(data.total || 0);
        setPages(data.pages || 0);
        setError(false);
        if (!query && !skill) setFeaturedSkills([...new Set((data.projects || []).flatMap(project => project.requiredSkills || []))].slice(0, 5));
      })
      .catch(() => { if (current) setError(true); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [locationSearch, query, skill, retry]);

  function updateParams(changes, resetPage = true) {
    const params = new URLSearchParams(locationSearch);
    Object.entries(changes).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
    if (resetPage) params.delete("page");
    setSearchParams(params);
  }

  function applyFilters(event) {
    event.preventDefault();
    updateParams({ ...filters, q: query });
  }

  function searchProjects(event) {
    event.preventDefault();
    updateParams({ q: draftQuery.trim() });
    document.getElementById("open-projects")?.scrollIntoView?.();
  }

  function filterSkill(value) {
    updateParams({ skill: skill === value ? "" : value });
  }

  function clearFilters() {
    setDraftQuery("");
    setSearchParams({}, { replace: true });
  }

  const isFiltered = Boolean(query || skill || searchParams.get("category") || searchParams.get("minBudget") || searchParams.get("maxBudget") || searchParams.get("deadlineFrom") || searchParams.get("deadlineTo") || (searchParams.get("sort") && searchParams.get("sort") !== "newest"));
  const activeFilters = [query && `Search: ${query}`, skill && `Skill: ${skill}`, searchParams.get("category") && `Category: ${searchParams.get("category")}`, searchParams.get("minBudget") && `From ₹${Number(searchParams.get("minBudget")).toLocaleString("en-IN")}`, searchParams.get("maxBudget") && `Up to ₹${Number(searchParams.get("maxBudget")).toLocaleString("en-IN")}`, searchParams.get("deadlineFrom") && `After ${searchParams.get("deadlineFrom")}`, searchParams.get("deadlineTo") && `By ${searchParams.get("deadlineTo")}`, searchParams.get("sort") && searchParams.get("sort") !== "newest" && `Sort: ${searchParams.get("sort").replace("-", " ")}`].filter(Boolean);
  const page = Number(searchParams.get("page") || 1);
  const featured = !isFiltered && projects[0];

  return <div className="site-page marketplace-page">
    <header className="site-header marketplace-header">
      <Link className="brand" to="/" aria-label="FreelanceChain home"><span className="brand-mark">✦</span><span>Freelance<span className="brand-light">Chain</span></span></Link>
      <nav aria-label="Main navigation"><a href="#open-projects">Find work</a><a href="#how-it-works">How it works</a><a href="#for-clients">For clients</a><Link to="/login">Log in</Link><Link className="button button-dark header-cta" to="/login?role=client">Post a project <span>↗</span></Link></nav>
    </header>
    <main>
      <section className="market-hero"><div className="market-hero-inner">
        <div className="market-hero-copy"><p className="market-kicker"><span className="online-dot" /> A marketplace for work that moves forward</p><h1>Find good work.<br /><span>Build something great.</span></h1><p className="market-lead">Explore open projects, send a proposal and work together with clear milestones from start to finish.</p>
          <form className="market-search" onSubmit={searchProjects} role="search"><label htmlFor="market-search-input" className="visually-hidden">Search open projects</label><span aria-hidden="true" className="market-search-icon">⌕</span><input id="market-search-input" value={draftQuery} onChange={event => setDraftQuery(event.target.value)} placeholder="Search projects or skills" /><button type="submit">Search jobs <span aria-hidden="true">→</span></button></form>
          <div className="market-hero-links"><a href="#open-projects">Browse open projects <span>↓</span></a><Link to="/login?role=client">Looking to hire? Post a project <span>↗</span></Link></div>
        </div>
        <div className="market-hero-aside"><div className="market-aside-label"><span className="market-spark">✦</span> WORK, MADE CLEARER</div>{featured ? <div className="market-featured-card"><div className="market-featured-top"><span>RECENT OPPORTUNITY</span><span className="market-live"><i /> Open</span></div><h2>{featured.title}</h2><p>{featured.description}</p><div className="market-featured-skills">{(featured.requiredSkills || []).slice(0, 3).map(item => <span key={item}>{item}</span>)}</div><div className="market-featured-bottom"><div><small>Project budget</small><strong>{money(featured.budget)}</strong></div><a href="#open-projects">See projects →</a></div></div> : <div className="market-featured-card market-featured-empty"><h2>One place for the whole project.</h2><p>Discover opportunities, agree on the work and follow each step through delivery.</p><div className="market-aside-steps"><span>Find work</span><span>Send a proposal</span><span>Deliver milestones</span></div></div>}<div className="market-aside-foot"><span>01 Explore</span><span>02 Connect</span><span>03 Deliver</span></div></div>
      </div></section>

      <section className="market-paths" id="for-clients" aria-label="Choose how to use FreelanceChain"><div className="market-section-inner market-path-grid"><div><span className="market-path-icon">↗</span><div><strong>For clients</strong><p>Post a project, compare proposals and manage delivery.</p></div><Link to="/login?role=client">Start hiring <span>→</span></Link></div><div><span className="market-path-icon">⌕</span><div><strong>For freelancers</strong><p>Find projects that fit your skills and track your work.</p></div><Link to="/login?role=freelancer">Find work <span>→</span></Link></div></div></section>

      <section className="market-listings" id="open-projects"><div className="market-section-inner"><div className="market-section-head"><div><p className="eyebrow">EXPLORE OPPORTUNITIES</p><h2>Open projects</h2><p>Browse real project briefs from clients on FreelanceChain.</p></div><Link className="market-section-action" to="/login?role=freelancer">Join as a freelancer <span>↗</span></Link></div>
        <form className="market-discovery-filters" onSubmit={applyFilters} aria-label="Filter open projects">
          <label>Category<select value={filters.category} onChange={event => setFilters(current => ({ ...current, category: event.target.value }))}><option value="">All categories</option><option>Web Development</option><option>Design &amp; Creative</option><option>Writing &amp; Translation</option><option>Marketing</option><option>Data &amp; Analytics</option><option>Video &amp; Animation</option><option>Admin &amp; Support</option><option>Other</option></select></label>
          <label>Skill<input value={filters.skill} onChange={event => setFilters(current => ({ ...current, skill: event.target.value }))} placeholder="e.g. React" /></label>
          <label>Minimum budget<input type="number" min="0" value={filters.minBudget} onChange={event => setFilters(current => ({ ...current, minBudget: event.target.value }))} placeholder="Any" /></label>
          <label>Maximum budget<input type="number" min="0" value={filters.maxBudget} onChange={event => setFilters(current => ({ ...current, maxBudget: event.target.value }))} placeholder="No limit" /></label>
          <label>Deadline from<input type="date" value={filters.deadlineFrom} onChange={event => setFilters(current => ({ ...current, deadlineFrom: event.target.value }))} /></label>
          <label>Deadline to<input type="date" value={filters.deadlineTo} onChange={event => setFilters(current => ({ ...current, deadlineTo: event.target.value }))} /></label>
          <label>Sort<select value={filters.sort} onChange={event => setFilters(current => ({ ...current, sort: event.target.value }))}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="budget-high">Highest budget</option><option value="budget-low">Lowest budget</option><option value="deadline-soon">Soonest deadline</option></select></label>
          <button className="button button-dark" type="submit">Apply filters</button>
        </form>
        {featuredSkills.length > 0 && <div className="market-filter-row" aria-label="Explore projects by skill"><span>Popular skills</span>{featuredSkills.map(item => <button key={item} className={skill === item ? "active" : ""} aria-pressed={skill === item} onClick={() => filterSkill(item)}>{item}</button>)}</div>}
        <div className="market-discovery-summary"><p className="market-results-line">{loading ? "Loading projects…" : `Showing ${total ? (page - 1) * 12 + 1 : 0}–${Math.min(page * 12, total)} of ${total} ${total === 1 ? "open project" : "open projects"}`}</p>{activeFilters.length > 0 && <div className="market-active-filters"><span>Active filters</span>{activeFilters.map(item => <span className="market-active-filter" key={item}>{item}</span>)}<button type="button" onClick={clearFilters}>Clear filters</button></div>}</div>
        {loading ? <div className="market-result-state" role="status">Loading open projects…</div> : error ? <div className="market-result-state" role="alert"><h3>Projects could not load</h3><p>Try again in a moment.</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : projects.length ? <div className="market-job-grid">{projects.map(project => <article className="market-job-card" key={project._id}><div className="market-job-top"><span className="market-job-status"><i /> Open for proposals</span><time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</time></div><span className="market-job-category">{projectCategoryLabel(project)}</span><h3>{project.title}</h3><p className="market-job-description">{project.description}</p><div className="market-job-skills">{(project.requiredSkills || []).slice(0, 4).map(item => <span key={item}>{item}</span>)}</div><div className="market-job-footer"><div><small>Fixed budget</small><strong>{money(project.budget)}</strong></div><Link to={`/jobs/${project._id}`} aria-label={`View details for ${project.title}`}>View project <span>→</span></Link></div></article>)}</div> : <div className="market-result-state"><h3>{isFiltered ? "No matching projects yet" : "No open projects yet"}</h3><p>{isFiltered ? "Try broadening your filters or clear them to see all open work." : "When clients publish projects, their public briefs will appear here."}</p>{isFiltered && <button onClick={clearFilters}>Clear filters</button>}</div>}
        {!loading && !error && pages > 1 && <nav className="market-pagination" aria-label="Project result pages"><button className="button button-outline" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) }, false)}>← Previous</button><span>Page {page} of {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => updateParams({ page: String(page + 1) }, false)}>Next →</button></nav>}
      </div></section>

      <section className="market-how" id="how-it-works"><div className="market-section-inner"><div className="market-section-head"><div><p className="eyebrow">HOW IT WORKS</p><h2>From brief to delivery, together.</h2><p>A simple path for both sides of the project.</p></div></div><div className="market-step-grid">{steps.map(step => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div></div></section>
      <section className="market-cta"><div className="market-section-inner"><div><p className="eyebrow">READY TO GET STARTED?</p><h2>Your next project starts here.</h2></div><div><Link className="button button-light" to="/login?role=client">Post a project ↗</Link><Link className="button button-outline" to="/login?role=freelancer">Find work →</Link></div></div></section>
    </main>
    <footer className="site-footer marketplace-footer"><Link className="brand" to="/"><span className="brand-mark">✦</span>FreelanceChain</Link><span>Find work. Build trust. Deliver together.</span><span>© {new Date().getFullYear()} FreelanceChain</span></footer>
  </div>;
}
