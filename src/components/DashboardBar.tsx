import { useEffect, useSyncExternalStore } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CloudIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type LoadProblem,
  type SaveProblem,
  dashboardStatus,
  keepMine,
  retrySaving,
  takeTheirs,
} from "@/lib/dashboardStore";
import type { HubMeta } from "@/lib/hubWire";
import { useReportUnsaved } from "@/lib/unsavedChanges";

type DashboardBarProps = {
  company: HubMeta;
  loadProblems: LoadProblem[];
  // As wide as the screen it sits above.
  wide: boolean;
  // Loads the templates of whichever company the dashboard shows now.
  onReload: () => void;
};

function reasonFor(problem: SaveProblem): string {
  switch (problem.code) {
    case "stale":
      return "Someone else changed it in the dashboard since you opened it.";
    case "forbidden":
      return "Only an admin of this company can change its templates.";
    case "wrong-company":
      return "The dashboard is now showing another company.";
    case "no-answer":
      return "The dashboard did not answer.";
    default:
      return problem.error || "The dashboard could not save it.";
  }
}

// Inside the dashboard: which company's templates these are, whether the
// last change is saved there, and what to do when it is not. A change that
// was not saved is never left looking like one that was.
export function DashboardBar({
  company,
  loadProblems,
  wide,
  onReload,
}: DashboardBarProps) {
  const status = useSyncExternalStore(
    dashboardStatus.subscribe,
    dashboardStatus.get,
  );

  // The dashboard asks before it reloads the tool while a change is not
  // saved there yet.
  useReportUnsaved("dashboard", status.state !== "saved");

  // Closing or reloading with something not saved yet: the browser asks first.
  useEffect(() => {
    if (status.state === "saved") return;
    const hold = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [status.state]);

  const width = wide ? "max-w-296" : "max-w-4xl";

  return (
    <div className={`flex w-full flex-col gap-3 ${width}`}>
      <div
        role="status"
        className="glass flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm"
      >
        <CloudIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-fg">
          Templates of <span className="font-semibold">{company.label}</span>,
          kept in the dashboard.
        </span>
        {status.state === "saved" && (
          <span className="flex items-center gap-1.5 text-muted">
            <CircleCheckIcon className="size-4" aria-hidden="true" />
            Saved
          </span>
        )}
        {status.state === "saving" && (
          <span className="flex items-center gap-1.5 text-muted">
            <LoaderCircleIcon
              className="size-4 motion-safe:animate-spin"
              aria-hidden="true"
            />
            Saving…
          </span>
        )}
        {status.state === "not-saved" && (
          <span className="flex items-center gap-1.5 font-semibold text-danger">
            <CircleAlertIcon className="size-4" aria-hidden="true" />
            NOT saved
          </span>
        )}
      </div>

      {company.role !== "admin" && (
        <p className="notice-panel notice-warn">
          <CircleAlertIcon />
          You can open these templates and fill them in. Only an admin of{" "}
          {company.label} can change them.
        </p>
      )}

      {loadProblems.map((problem) => (
        <p
          key={problem.name}
          role="alert"
          className="notice-panel notice-danger"
        >
          <CircleAlertIcon />
          <span>
            "{problem.name}" could not be loaded from the dashboard:{" "}
            {problem.reason}
          </span>
        </p>
      ))}

      {status.problems.map((problem) => (
        <div
          key={problem.templateId}
          role="alert"
          className="notice-panel notice-danger flex-wrap items-center"
        >
          <CircleAlertIcon />
          <span className="min-w-48 flex-1">
            "{problem.templateName}" was NOT{" "}
            {problem.doing === "delete" ? "deleted" : "saved"} in the dashboard.{" "}
            {reasonFor(problem)}{" "}
            {problem.doing === "save" &&
              "What you see here is still on this screen, but it will be gone when this page is closed or reloaded."}
          </span>
          <span className="flex flex-wrap gap-2">
            {problem.code === "stale" ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void keepMine(problem.templateId)}
                >
                  Save mine over it
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void takeTheirs(problem.templateId)}
                >
                  Use the dashboard's version
                </Button>
              </>
            ) : problem.code === "wrong-company" ? (
              <Button variant="outline" size="sm" onClick={onReload}>
                Load that company's templates
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void retrySaving()}
              >
                Try saving again
              </Button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
