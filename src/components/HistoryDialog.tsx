import { useEffect, useRef, useState } from "react";
import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { makeUnitConverters } from "@/lib/boxGeometry";
import {
  type RevisionSummary,
  loadRevision,
  restoreRevision,
  templateHistory,
} from "@/lib/dashboardStore";
import {
  base64ToBytes,
  getPageSize,
  loadPdfDocument,
  renderPdfPageToCanvas,
} from "@/lib/pdf";
import type { Template } from "@/types/template";

type HistoryDialogProps = {
  // The template whose history is shown; null keeps the dialog closed.
  template: Template | null;
  companyName: string;
  // Only an admin of the company can restore a version.
  canRestore: boolean;
  // Called after a version was restored, so the list shows the template as it is now.
  onRestored: () => void;
  onClose: () => void;
};

const PREVIEW_WIDTH = 460;
const PAGE_NUMBER = 1;

const savedAt = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

// One revision's fields drawn on its PDF, to look at. Nothing here can be
// moved, typed into or saved.
function RevisionPreview({ template }: { template: Template }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const pdf = await loadPdfDocument(base64ToBytes(template.pdfData));
        const size = await getPageSize(pdf, PAGE_NUMBER);
        if (!current || !canvas.current) return;
        await renderPdfPageToCanvas(
          pdf,
          PAGE_NUMBER,
          canvas.current,
          PREVIEW_WIDTH,
        );
        if (current) setPageWidth(size.width);
      } catch {
        if (current) setFailed(true);
      }
    })();
    return () => {
      current = false;
    };
  }, [template.pdfData]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-danger">
        The PDF of this version could not be drawn.
      </p>
    );
  }

  const { pointToPixelRect } = makeUnitConverters(
    pageWidth ?? 1,
    PREVIEW_WIDTH,
  );
  const boxes = template.boxes.filter((box) => box.page === PAGE_NUMBER);

  return (
    <div className="preview-frame max-w-full overflow-auto p-3">
      <div className="relative" style={{ width: PREVIEW_WIDTH }}>
        <canvas ref={canvas} className="block" />
        {pageWidth !== null &&
          boxes.map((box) => {
            const rect = pointToPixelRect(box);
            return (
              <div
                key={box.id}
                className="absolute overflow-hidden border border-dashed border-black/70 bg-white/60 px-0.5 text-[10px] leading-tight whitespace-nowrap text-black"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }}
              >
                {box.name}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// A template's saved revisions, newest first: when each was saved and by
// whom, what it looked like, and, for an admin, a way to make an earlier
// one the newest. Restoring never deletes or rewrites anything: it is
// saved as a new revision.
export function HistoryDialog({
  template,
  companyName,
  canRestore,
  onRestored,
  onClose,
}: HistoryDialogProps) {
  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      {template && (
        <HistoryContent
          key={template.id}
          template={template}
          companyName={companyName}
          canRestore={canRestore}
          onRestored={onRestored}
        />
      )}
    </Dialog>
  );
}

function HistoryContent({
  template,
  companyName,
  canRestore,
  onRestored,
}: Omit<HistoryDialogProps, "template" | "onClose"> & { template: Template }) {
  const [revisions, setRevisions] = useState<RevisionSummary[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<Template | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoredAs, setRestoredAs] = useState<number | null>(null);

  async function refresh() {
    const history = await templateHistory(template.id);
    if (!history.ok) {
      setError(`The history could not be loaded. ${history.error}`);
      setRevisions([]);
      return;
    }
    setRevisions(history.revisions);
    setCurrent(history.current);
  }

  useEffect(() => {
    void refresh();
    // Loaded once when the dialog opens for this template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function show(revision: number) {
    setSelected(revision);
    setPreview(null);
    setConfirming(false);
    setError(null);
    const loaded = await loadRevision(template.id, revision);
    if (loaded.ok) setPreview(loaded.template);
    else setError(`This version could not be loaded. ${loaded.error}`);
  }

  async function restore() {
    if (selected === null) return;
    setBusy(true);
    setError(null);
    const result = await restoreRevision(template.id, selected);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      setError(`Not restored. ${result.error}`);
      return;
    }
    setRestoredAs(result.revision);
    setSelected(null);
    setPreview(null);
    await refresh();
    onRestored();
  }

  return (
    <DialogContent className="sm:max-w-4xl">
      <DialogHeader icon={<HistoryIcon />}>
        <DialogTitle>History of "{template.name}"</DialogTitle>
        <DialogDescription>
          Every saved version, newest first. Looking at one changes nothing.
        </DialogDescription>
      </DialogHeader>

      {restoredAs !== null && (
        <p role="status" className="text-sm text-fg">
          Restored. It was saved as revision {restoredAs}; the earlier versions
          are all still here.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex w-full flex-col gap-2 md:w-64 md:shrink-0">
          {revisions === null ? (
            <p className="text-sm text-muted">Asking the dashboard…</p>
          ) : (
            <ul aria-label="Saved versions" className="flex flex-col gap-1.5">
              {revisions.map((revision) => (
                <li key={revision.revision}>
                  <button
                    type="button"
                    aria-pressed={selected === revision.revision}
                    onClick={() => void show(revision.revision)}
                    className={`flex w-full flex-col gap-0.5 rounded-lg border p-2.5 text-left text-sm ${
                      selected === revision.revision
                        ? "border-accent bg-accent/10"
                        : "border-line hover:border-line-strong"
                    }`}
                  >
                    <span className="font-medium text-fg">
                      Revision {revision.revision}
                      {revision.revision === current && " (current)"}
                    </span>
                    <span className="text-muted">
                      {savedAt(revision.saved_at)},{" "}
                      {revision.saved_by_you
                        ? "saved by you"
                        : "saved by someone else"}
                    </span>
                    <span className="wrap-break-word text-muted">
                      {revision.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {selected === null ? (
            <p className="text-sm text-muted">
              Choose a version to see its fields on the form.
            </p>
          ) : preview === null ? (
            !error && (
              <p className="text-sm text-muted">Loading revision {selected}…</p>
            )
          ) : (
            <>
              <p className="text-sm text-fg">
                Revision {selected}: {preview.boxes.length}{" "}
                {preview.boxes.length === 1 ? "field" : "fields"} on{" "}
                {preview.pdfFileName}
              </p>
              <RevisionPreview template={preview} />
              {!canRestore ? (
                <p className="text-sm text-muted">
                  Only an admin of {companyName} can restore a version.
                </p>
              ) : selected === current ? (
                <p className="text-sm text-muted">
                  This is the version in use now.
                </p>
              ) : confirming ? (
                <div
                  role="alert"
                  className="notice-panel notice-warn flex-wrap items-center"
                >
                  <span className="min-w-48 flex-1">
                    Restore revision {selected}? It is saved as a new revision,
                    and every earlier version is kept.
                  </span>
                  <span className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirming(false)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void restore()}
                      disabled={busy}
                    >
                      {busy ? "Restoring…" : "Restore"}
                    </Button>
                  </span>
                </div>
              ) : (
                <div>
                  <Button variant="outline" onClick={() => setConfirming(true)}>
                    Restore this version
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
