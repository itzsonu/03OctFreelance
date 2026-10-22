import React from "react";

export default function TrustEvidence({ trust }) {
  if (!trust || trust.score == null || trust.clientCount == null) return null;
  return <p className="trust-evidence">{trust.clientCount} distinct stored client IDs have approved work. {trust.scoredMilestones} of {trust.approvedMilestones} raw approved milestones count toward the score. Each stored ID contributes up to 3 milestones; all approvals without a stored client ID are grouped together and capped at 3. Stored IDs are account references, not identity verification.</p>;
}
