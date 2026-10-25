import React from "react";
import { Link } from "react-router-dom";
export function PolicyLinks({ includeAdmin = false }) { return <nav className="policy-links" aria-label="Service information"><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/support">Support</Link>{includeAdmin && <Link to="/admin/login">Admin sign in</Link>}</nav>; }
export default function ServicePage({ title, intro, children }) {
  return <div className="service-page"><header><Link className="brand" to="/"><span className="brand-mark">✦</span>FreelanceChain</Link><Link to="/account">My account</Link></header><main><p className="eyebrow">HELP & INFORMATION</p><h1>{title}</h1><p className="page-subtitle">{intro}</p>{children}</main><footer><PolicyLinks /><Link to="/">← Back to projects</Link></footer></div>;
}
