import { useRef, useState } from "react";
import {
  ArchiveRestoreIcon,
  CircleCheckIcon,
  DownloadIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type Backup,
  type BackupSummary,
  buildBackup,
  buildBackupFilename,
  downloadBackup,
  formatSavedAt,
  parseBackupFile,
  restoreBackup,
  summarizeBackup,
  summarizeBrowser,
} from "@/lib/backup";

type BackupControlsProps = {
  // Whether this browser holds anything to back up.
  canBackUp: boolean;
  // Called after a restore has replaced what the browser holds, so the list
  // can show what is now stored.
  onRestored: () => void;
};

type Pending = {
  fileName: string;
  backup: Backup;
  inFile: BackupSummary;
  inBrowser: BackupSummary;
};

type Message = { title: string; description: string; failed: boolean };

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function Holdings({ summary }: { summary: BackupSummary }) {
  const nothing =
    summary.templates.length === 0 &&
    !summary.hasEarlierCompanyDetails &&
    summary.unreadableCount === 0;
  if (nothing) return <p className="text-sm text-subtle">No templates.</p>;

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {summary.templates.map((template) => (
        <li
          key={template.id}
          className="flex flex-wrap justify-between gap-x-3"
        >
          <span className="min-w-0 font-medium wrap-break-word text-fg">
            {template.name}
          </span>
          <span className="text-muted">
            {plural(template.fields, "field")},{" "}
            {plural(template.people, "person", "people")}
          </span>
        </li>
      ))}
      {summary.hasEarlierCompanyDetails && (
        <li className="text-muted">
          Company details saved by an earlier version of this tool
        </li>
      )}
      {summary.unreadableCount > 0 && (
        <li className="text-muted">
          {plural(summary.unreadableCount, "item")} that could not be read,
          kept as it is
        </li>
      )}
    </ul>
  );
}

// "Back up" and "Restore": everything this tool keeps in the browser, as
// one file. Restoring shows what is in the file and what is in the browser
// first, and replaces nothing until the user says so.
export function BackupControls({ canBackUp, onRestored }: BackupControlsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  function backUp() {
    const now = new Date();
    downloadBackup(buildBackup(now), buildBackupFilename(now));
  }

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file can be chosen again
    if (!file) return;

    const result = await parseBackupFile(file);
    if (!result.valid) {
      setMessage({
        title: "This file cannot be restored",
        description: result.error,
        failed: true,
      });
      return;
    }
    setPending({
      fileName: file.name,
      backup: result.backup,
      inFile: summarizeBackup(result.backup),
      inBrowser: summarizeBrowser(),
    });
  }

  function restore() {
    if (!pending) return;
    const result = restoreBackup(pending.backup);
    setPending(null);

    if (result.ok) {
      setMessage({
        title: "Backup restored",
        description: "Everything from the backup file is now in this browser.",
        failed: false,
      });
    } else if (result.unchanged) {
      setMessage({
        title: "The backup was NOT restored",
        description:
          "The browser's storage for this tool is full, so the backup could not be put back. Nothing was changed: this browser holds what it held before.",
        failed: true,
      });
    } else {
      setMessage({
        title: "The backup was NOT restored",
        description:
          "The browser refused to store the backup, and what was here before could not be put back either. Keep this page open and restore your latest backup file again.",
        failed: true,
      });
    }
    // Whatever happened, show what the browser holds now.
    onRestored();
  }

  const savedAt = pending ? formatSavedAt(pending.inFile.exportedAt) : null;
  const browserHasTemplates = (pending?.inBrowser.templates.length ?? 0) > 0;

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChosen}
      />
      {canBackUp && (
        <Button
          variant="outline"
          onClick={backUp}
          title="Save every template in this browser to one file"
        >
          <DownloadIcon />
          Back up
        </Button>
      )}
      <Button
        variant="outline"
        onClick={() => fileInput.current?.click()}
        title="Put a backup file back into this browser"
      >
        <ArchiveRestoreIcon />
        Restore
      </Button>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader icon={<ArchiveRestoreIcon />}>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              Restoring replaces every template in this browser with the ones
              in the file.
            </DialogDescription>
          </DialogHeader>

          {pending && (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  In the backup file
                </h3>
                <p className="text-xs wrap-break-word text-muted">
                  {pending.fileName}
                  {savedAt && `, saved on ${savedAt}`}
                </p>
                <Holdings summary={pending.inFile} />
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-fg">
                  In this browser now
                </h3>
                <Holdings summary={pending.inBrowser} />
              </section>

              {browserHasTemplates && (
                <div
                  role="alert"
                  className="notice-panel notice-danger flex-wrap items-center"
                >
                  <TriangleAlertIcon />
                  <span className="min-w-0 flex-1">
                    The templates in this browser now will be removed. To keep
                    them, back them up first.
                  </span>
                  <Button variant="outline" size="sm" onClick={backUp}>
                    Back up what is here
                  </Button>
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={restore}>
              Replace with this backup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={message !== null}
        onOpenChange={(open) => !open && setMessage(null)}
        disablePointerDismissal={message?.failed}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader
            icon={message?.failed ? <TriangleAlertIcon /> : <CircleCheckIcon />}
            tone={message?.failed ? "danger" : "accent"}
          >
            <DialogTitle>{message?.title}</DialogTitle>
            <DialogDescription>{message?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setMessage(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
