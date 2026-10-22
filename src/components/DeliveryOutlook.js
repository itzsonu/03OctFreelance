import React from "react";
import { Link } from "react-router-dom";

export default function DeliveryOutlook({ project, linked = false }) {
  const outlook = project?.outlook;
  if (!outlook) return null;
  return <article className={`delivery-outlook outlook-${outlook.status}`}>
    <div className="outlook-card-top"><span className="outlook-state">{outlook.status === "forecast_late" || outlook.status === "overdue" ? "Review timing" : outlook.status === "needs_review" ? "Check progress" : outlook.status === "on_pace" ? "On pace" : "More history needed"}</span><small>{outlook.approved} of {outlook.total} approved</small></div>
    {linked ? <h3><Link to={`/milestones/${project._id}`}>{project.title}</Link></h3> : null}
    <strong className="outlook-headline">{outlook.headline}</strong>
    {outlook.scheduleBasis === "dependencies_unresolved" ? <p className="outlook-estimate">Milestone prerequisite links are incomplete, so a reliable finish date cannot be estimated.</p> : outlook.projectedDate ? <p className="outlook-estimate">At roughly {outlook.paceDays} day{outlook.paceDays === 1 ? "" : "s"} per approval, the {outlook.scheduleBasis === "critical_dependency_chain" ? "critical dependency chain" : "remaining sequential steps"} point to <strong>{outlook.projectedDate}</strong>.{outlook.scheduleBasis === "critical_dependency_chain" && <span> Longest chain: {outlook.criticalChain?.join(" → ")} ({outlook.criticalChainRemaining} of {outlook.remaining} remaining steps).</span>}{outlook.daysBeyondDeadline > 0 ? ` That is ${outlook.daysBeyondDeadline} day${outlook.daysBeyondDeadline === 1 ? "" : "s"} after the deadline.` : ""}</p> : <p className="outlook-estimate">A pace estimate needs at least two approved steps at least a day apart. Current workflow signals still appear below.</p>}
    {outlook.signals?.length > 0 && <ul>{outlook.signals.map((signal, index) => <li key={index}>{signal}</li>)}</ul>}
    {outlook.nextAction && <p className="outlook-action"><b>Next step:</b> {outlook.nextAction}</p>}
  </article>;
}
