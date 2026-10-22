import { useEffect, useRef, useState } from "react";
import { subscribeUpdates } from "./api";

export default function useLiveUpdates(onChange) {
  const callback = useRef(onChange);
  const [status, setStatus] = useState("connecting");
  useEffect(() => { callback.current = onChange; }, [onChange]);
  useEffect(() => subscribeUpdates(event => {
    if (event.type === "connected") setStatus("live");
    else if (event.type === "disconnected") setStatus("reconnecting");
    else callback.current(event);
  }), []);
  return status;
}
