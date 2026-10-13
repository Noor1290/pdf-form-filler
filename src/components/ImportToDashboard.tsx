import { useState } from "react";
import { CloudUploadIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildBackup, buildBackupFilename, downloadBackup } from "@/lib/backup";
import {
  type ImportChoice,
  type ImportItem,
  type ImportOutcome,
  defaultChoice,
  planImport,
  runImport,
} from "@/lib/dashboardImport";

type ImportToDashboardProps = {
  // How many of this browser's templates are not in the dashboard yet.
  waiting: number;
  companyName: string;
  // Called after an import has run, so the list shows what is there now.
  onImported: () => void;
  // Told when the dialog opens and closes: it must stay on screen to show
  // its results even when nothing is left to import.
  onOpenChange: (open: boolean) => void;
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const sizeOf = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// The one-time import of this browser's templates into the dashboard. It
// starts only when asked, wants a backup file saved first, shows what it
// would do before doing anything, and says for each template whether it
// was imported. This browser's copy is never changed.
export function ImportToDashboard({
  waiting,
  companyName,
  onImported,
  onOpenChange,
}: ImportToDashboardProps) {
  const [items, setItems] = useState<ImportItem[] | null>(null);
  const [choices, setChoices] = useState<Record<string, ImportChoice>>({});
  const [backedUp, setBackedUp] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);

  function open() {
    const plan = planImport();
    setItems(plan);
    setChoices(
      Object.fromEntries(
        plan.map((item) => [item.template.id, defaultChoice(item)]),
      ),
    );
    setBackedUp(false);
    setProgress(null);
    setOutcomes(null);
    onOpenChange(true);
  }

  function close() {
    if (progress !== null && outcomes === null) return; // not in the middle of it
    const ran = outcomes !== null;
    setItems(null);
    onOpenChange(false);
    if (ran) onImported();
  }

  function backUp() {
    const now = new Date();
    downloadBackup(buildBackup(now), buildBackupFilename(now));
    setBackedUp(true);
  }

  async function run() {
    if (!items) return;
    setProgress(0);
    setOutcomes(await runImport(items, choices, setProgress));
  }

  const chosen = (items ?? []).filter(
    (item) => (choices[item.template.id] ?? "skip") !== "skip",
  ).length;
  const running = progress !== null && outcomes === null;

  return (
    <>
      {/* Nothing left to import: only the dialog stays, to show its results. */}
      <div
        role="status"
        hidden={waiting === 0}
        className={`glass w-full max-w-4xl flex-wrap items-center gap-3 border-accent/40 p-4 ${
          waiting === 0 ? "hidden" : "flex"
        }`}
      >
        <div className="icon-tile">
          <CloudUploadIcon className="size-5" />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-0.5">
          <span className="font-semibold text-fg">
            {plural(waiting, "template")} in this browser{" "}
            {waiting === 1 ? "is" : "are"} not in the dashboard
          </span>
          <span className="text-sm text-muted">
            Importing copies them to {companyName}. This browser's copy is kept
            as it is.
          </span>
        </div>
        <Button size="sm" onClick={open}>
          Import to the dashboard
        </Button>
      </div>

      <Dialog
        open={items !== null}
        onOpenChange={(next) => !next && close()}
        disablePointerDismissal
      >
        <DialogContent className="sm:max-w-xl" showCloseButton={!running}>
          <DialogHeader icon={<CloudUploadIcon />}>
            <DialogTitle>Import this browser's templates</DialogTitle>
            <DialogDescription>
              They are copied to {companyName} in the dashboard, with their
              PDFs. This browser's copy is kept as it is. The values last typed
              and the People list stay in this browser.
            </DialogDescription>
          </DialogHeader>

          {outcomes !== null ? (
            <ul
              className="flex flex-col gap-1.5 text-sm"
              aria-label="What was imported"
            >
              {outcomes.length === 0 && (
                <li className="text-muted">Nothing was chosen to import.</li>
              )}
              {outcomes.map((outcome, index) => (
                <li key={index} className="flex flex-wrap gap-x-2">
                  <span className="font-medium text-fg">{outcome.name}:</span>
                  {outcome.ok ? (
                    <span className="text-fg">imported and checked.</span>
                  ) : (
                    <span className="text-danger">
                      NOT imported. {outcome.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : running ? (
            <p role="status" className="text-sm text-fg">
              Importing… {progress} of {chosen} done. Keep this page open.
            </p>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  1. Save a backup first
                </h3>
                <p className="text-sm text-muted">
                  One file with everything this tool keeps in this browser. The
                  import starts only after it.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={backUp}>
                    <DownloadIcon />
                    Back up
                  </Button>
                  {backedUp && (
                    <span role="status" className="text-sm text-fg">
                      Backup downloaded.
                    </span>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  2. What will be imported
                </h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {(items ?? []).map((item) => {
                    const id = item.template.id;
                    return (
                      <li
                        key={id}
                        className="flex flex-col gap-1 rounded-lg border border-line p-2.5"
                      >
                        <span className="flex flex-wrap justify-between gap-x-3">
                          <span className="min-w-0 font-medium wrap-break-word text-fg">
                            {item.template.name}
                          </span>
                          <span className="text-muted">
                            {plural(item.template.boxes.length, "field")}, PDF{" "}
                            {sizeOf(item.bytes)}
                          </span>
                        </span>
                        {item.tooLarge ? (
                          <span className="text-danger">
                            Its PDF is larger than 5 MB, the largest the
                            dashboard stores. It will not be imported.
                          </span>
                        ) : item.nameTaken ? (
                          <label className="flex flex-wrap items-center gap-2 text-fg">
                            The dashboard already has a template with this name:
                            <select
                              value={choices[id] ?? "skip"}
                              onChange={(event) =>
                                setChoices((current) => ({
                                  ...current,
                                  [id]: event.target.value as ImportChoice,
                                }))
                              }
                              className="h-8 rounded-lg border border-line-strong bg-elevated px-2 text-sm text-fg"
                            >
                              <option value="skip">
                                leave the dashboard's as it is
                              </option>
                              <option value="replace">
                                replace it with this browser's
                              </option>
                            </select>
                          </label>
                        ) : (
                          <span className="text-muted">Will be imported.</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </>
          )}

          <DialogFooter>
            {outcomes !== null ? (
              <Button onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={close} disabled={running}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void run()}
                  disabled={!backedUp || running || chosen === 0}
                >
                  Import {plural(chosen, "template")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
