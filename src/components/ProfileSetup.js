import React from "react";

const anchors = { intro: "profile-intro", skills: "profile-skills", preferences: "profile-preferences", samples: "profile-samples" };
export default function ProfileSetup({ setup }) {
  if (!setup) return null;
  return <section className="panel profile-setup" aria-label="Profile setup guide">
    <div><p className="eyebrow">START WITH WHAT YOU KNOW</p><h2>{setup.ready ? "Your profile is ready to explore work" : "Build your starting profile"}</h2>
      <p>Saved setup: {setup.completed} of {setup.total} essentials complete. You can browse and apply while you build it.</p>
      <p>You do not need previous clients or platform reviews. Personal and practice projects can help show your skills.</p></div>
    <ol>{setup.steps.map(step => <li key={step.key} className={step.done ? "done" : ""}><span aria-hidden="true">{step.done ? "✓" : "○"}</span><a href={`#${anchors[step.key]}`}>{step.label}</a><small>{step.optional ? "Optional sample" : step.done ? "Saved" : "To add"}</small></li>)}</ol>
    <p className="form-help">Save your profile to update this checklist. Talent search visibility is your choice.</p>
  </section>;
}
