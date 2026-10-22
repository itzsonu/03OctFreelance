import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { currentUser, signOut } from "../api";
import NotificationCenter from "./NotificationCenter";

export default function Shell({ role, eyebrow, title, subtitle, action, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = currentUser();
  const dashboardPath = role === "client" ? "/client-dashboard" : role === "admin" ? "/admin/cases" : "/freelancer-dashboard";
  const dashboardLabel = role === "client" ? "My projects" : role === "admin" ? "Case queue" : "Find work";
  const workspaceLabel = role === "client" ? "Client workspace" : role === "admin" ? "Admin workspace" : "Freelancer workspace";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to main content</a>
      <aside className="shell-sidebar">
        <Link className="brand" to="/"><span className="brand-mark">✦</span><span>Freelance<span className="brand-light">Chain</span></span></Link>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="shell-nav" aria-label="Main navigation">
          <Link className={`shell-nav-link ${location.pathname === dashboardPath ? "active" : ""}`} to={dashboardPath}>
            <span className="nav-icon">▦</span>{dashboardLabel}
          </Link>
          {role !== "admin" && <Link className={`shell-nav-link ${location.pathname === "/workrooms" ? "active" : ""}`} to="/workrooms"><span className="nav-icon">▤</span>Project inbox</Link>}
          {role === "client" && <Link className={`shell-nav-link ${location.pathname === "/talent" ? "active" : ""}`} to="/talent"><span className="nav-icon">⌕</span>Find talent</Link>}
          {role === "freelancer" && <Link className={`shell-nav-link ${location.pathname === "/profile" ? "active" : ""}`} to="/profile"><span className="nav-icon">◉</span>My profile</Link>}
          <Link className={`shell-nav-link ${location.pathname === "/account" ? "active" : ""}`} to="/account"><span className="nav-icon">⚙</span>Account settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><span>✦</span><strong>One step at a time.</strong><p>Keep every project clear with a simple milestone flow.</p></div>
          <div className="sidebar-profile"><div className="avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div><div><strong>{user?.name || "Your account"}</strong><small>{workspaceLabel}</small></div></div>
          <button className="text-button logout" onClick={() => { signOut(); navigate("/login"); }}>Sign out <span>↗</span></button>
        </div>
      </aside>
      <div className="shell-main">
        <header className="mobile-bar"><Link className="brand" to="/"><span className="brand-mark">✦</span>FreelanceChain</Link><button className="text-button" onClick={() => { signOut(); navigate("/login"); }}>Sign out</button></header>
        <nav className="mobile-nav" aria-label="Mobile workspace navigation"><Link to={dashboardPath} aria-current={location.pathname === dashboardPath ? "page" : undefined}>{dashboardLabel}</Link>{role !== "admin" && <Link to="/workrooms" aria-current={location.pathname === "/workrooms" ? "page" : undefined}>Project inbox</Link>}{role === "client" ? <Link to="/talent" aria-current={location.pathname === "/talent" ? "page" : undefined}>Find talent</Link> : role === "freelancer" ? <Link to="/profile" aria-current={location.pathname === "/profile" ? "page" : undefined}>My profile</Link> : null}<Link to="/account" aria-current={location.pathname === "/account" ? "page" : undefined}>Account</Link></nav>
        <div className="shell-topline"><span>{eyebrow}</span><div className="topline-actions"><NotificationCenter /><span className="topline-user"><span className="online-dot" /> {user?.name}</span></div></div>
        <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-subtitle">{subtitle}</p></div>{action}</div>
        <main id="workspace-content">{children}</main>
      </div>
    </div>
  );
}
