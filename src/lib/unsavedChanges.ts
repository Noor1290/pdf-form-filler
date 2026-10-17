import { useEffect } from "react";

// What this tool holds that is not saved yet, by the part of the screen
// holding it. Inside the dashboard, the dashboard is told whether there is
// anything, so it asks before it reloads the tool on a change of company
// (rehearsal fix F1). On its own, nothing is sent.
const holding = new Set<string>();

export function reportUnsaved(part: string, unsaved: boolean): void {
  if (unsaved) holding.add(part);
  else holding.delete(part);
  window.PayrollHubBridge?.setUnsaved?.(holding.size > 0);
}

// Reports `unsaved` for `part` while the component is on screen; what it
// held is gone once it is not.
export function useReportUnsaved(part: string, unsaved: boolean): void {
  useEffect(() => {
    reportUnsaved(part, unsaved);
    return () => reportUnsaved(part, false);
  }, [part, unsaved]);
}
