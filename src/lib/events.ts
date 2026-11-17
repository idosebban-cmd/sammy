import { useEffect } from "react";

// Lightweight "data changed" signal so the dashboard, nav badge and open pages
// refresh after a save made elsewhere (e.g. from the assistant drawer).
const EVT = "sammy:changed";

export function notifyChanged() {
  window.dispatchEvent(new Event(EVT));
}

export function useOnChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener(EVT, cb);
    return () => window.removeEventListener(EVT, cb);
  }, [cb]);
}
