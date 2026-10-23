import React, { useEffect, useState } from "react";
import { invalidateCachedSession } from "../api";
import { listenForSessionChanges } from "../sessionChanges";

export default function SessionBoundary({ children }) {
  const [version, setVersion] = useState(0);
  useEffect(() => listenForSessionChanges(() => {
    invalidateCachedSession();
    // Remove the old account page state before restoring the shared cookie.
    setVersion(value => value + 1);
  }), []);
  return <React.Fragment key={version}>{children}</React.Fragment>;
}
