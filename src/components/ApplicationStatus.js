import React from "react";
import { applicationStage } from "../applicationStage";
export default function ApplicationStatus({ application, project, role, userId }) {
  const stage = applicationStage(application, project, role, userId);
  return <span className="application-stage"><span className={`status status-${stage.tone}`}>{stage.label}</span><small>{stage.detail}</small></span>;
}
