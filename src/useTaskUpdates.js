import { useEffect, useRef, useState } from "react";
import useLiveUpdates from "./useLiveUpdates";

// External updates wait until edits, dragging and pagination are finished.
export default function useTaskUpdates(refresh, blocked, projectId) {
  const callback = useRef(refresh);
  callback.current = refresh;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const status = useLiveUpdates(event => {
    if (event.type === "reconnected" || (["tasks", "project"].includes(event.type) && (!projectId || event.projectId === projectId))) setPending(true);
  });
  useEffect(() => {
    if (!pending || blocked || refreshing) return;
    setPending(false); setRefreshing(true);
    Promise.resolve().then(() => callback.current()).then(applied => {
      if (mounted.current && applied === false) setPending(true);
    }).catch(() => { /* The page displays refresh errors and offers a manual retry. */ })
      .finally(() => { if (mounted.current) setRefreshing(false); });
  }, [pending, blocked, refreshing]);
  return { status, pending, refreshing };
}
