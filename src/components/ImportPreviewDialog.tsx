import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ParsedImport } from "@/lib/importEntries";
import type { FieldBox } from "@/types/template";

export type ImportPreview = {
  key: string; // changes whenever a different file or delivery is shown
  description: string;
  source: "file" | "data"; // only changes the wording ("this file" / "this data")
  parsed: ParsedImport | null;
  error: string | null;
  warnings: string[];
};

type ImportPreviewDialogProps = {
  preview: ImportPreview | null;
  boxes: FieldBox[];
  existingEntryCount: number;
  onImport: (entries: Record<string, string>[], mode: "append" | "replace") => void;
  onClose: () => void;
};

const PREVIEW_ROW_COUNT = 3;

// What is about to be imported, and the Add to / Replace choice — the one
// confirmation step every import goes through, whether the rows came from
// a file or from the Payroll Hub dashboard.
export function ImportPreviewDialog({
  preview,
  boxes,
  existingEntryCount,
  onImport,
  onClose,
}: ImportPreviewDialogProps) {
  const [replaceMode, setReplaceMode] = useState(false);
  const [confirmingReplace, setConfirmingReplace] = useState(false);
  const [shown, setShown] = useState<ImportPreview | null>(null);

  // A different file or delivery must never inherit a "Replace" choice made
  // for the previous one, including when it arrives while this is open.
  if (preview && preview.key !== shown?.key) {
    setShown(preview);
    setReplaceMode(false);
    setConfirmingReplace(false);
  }

  const parsed = preview?.parsed ?? null;
  const source = (preview ?? shown)?.source ?? "file";

  function close() {
    setReplaceMode(false);
    setConfirmingReplace(false);
    onClose();
  }

  function runImport() {
    if (!parsed) return;
    const mode = replaceMode ? "replace" : "append";
    setReplaceMode(false);
    setConfirmingReplace(false);
    onImport(parsed.entries, mode);
  }

  function handleImportClick() {
    if (replaceMode && existingEntryCount > 0) {
      setConfirmingReplace(true);
    } else {
      runImport();
    }
  }

  const canImport = (parsed?.matchedColumns.length ?? 0) > 0;
  const boxNameById = new Map(boxes.map((box) => [box.id, box.name]));
  const previewBoxIds = parsed
    ? Array.from(new Set(parsed.entries.flatMap((entry) => Object.keys(entry))))
    : [];

  return (
    <>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import entries</DialogTitle>
            <DialogDescription>
              {(preview ?? shown)?.description}
            </DialogDescription>
          </DialogHeader>

          {preview?.error && (
            <p className="text-sm text-destructive">{preview.error}</p>
          )}

          {parsed && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">
                {parsed.entries.length}{" "}
                {parsed.entries.length === 1 ? "person" : "people"} found in
                this {source}.
              </p>

              {preview?.warnings.map((warning) => (
                <p
                  key={warning}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-sm text-foreground"
                >
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  {warning}
                </p>
              ))}

              {parsed.unmatchedColumns.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {parsed.unmatchedColumns.length}{" "}
                  {parsed.unmatchedColumns.length === 1
                    ? "column had"
                    : "columns had"}{" "}
                  no matching field and{" "}
                  {parsed.unmatchedColumns.length === 1 ? "was" : "were"}{" "}
                  ignored: {parsed.unmatchedColumns.join(", ")}.
                </p>
              )}

              {!canImport && (
                <p className="text-sm text-destructive">
                  None of the columns in this {source} match a field in this
                  template, so there's nothing to import.
                </p>
              )}

              {canImport && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted">
                      <tr>
                        {previewBoxIds.map((boxId) => (
                          <th key={boxId} className="px-2.5 py-1.5 font-medium">
                            {boxNameById.get(boxId) ?? boxId}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.entries.slice(0, PREVIEW_ROW_COUNT).map((entry, index) => (
                        <tr key={index} className="border-t border-border">
                          {previewBoxIds.map((boxId) => (
                            <td key={boxId} className="px-2.5 py-1.5 text-muted-foreground">
                              {entry[boxId] || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsed.entries.length > PREVIEW_ROW_COUNT && (
                    <p className="border-t border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                      + {parsed.entries.length - PREVIEW_ROW_COUNT} more
                    </p>
                  )}
                </div>
              )}

              {existingEntryCount > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5">
                  <span className="text-sm">
                    {replaceMode
                      ? `Replace the ${existingEntryCount} ${existingEntryCount === 1 ? "person" : "people"} already added`
                      : `Add to the ${existingEntryCount} ${existingEntryCount === 1 ? "person" : "people"} already added`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={replaceMode ? "default" : "outline"}
                    onClick={() => setReplaceMode((current) => !current)}
                  >
                    {replaceMode ? "Replace" : "Add to"}
                  </Button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            {parsed && (
              <Button onClick={handleImportClick} disabled={!canImport}>
                Import {parsed.entries.length}{" "}
                {parsed.entries.length === 1 ? "person" : "people"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmingReplace}
        onOpenChange={(open) => !open && setConfirmingReplace(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace existing people?</DialogTitle>
            <DialogDescription>
              This will remove the {existingEntryCount}{" "}
              {existingEntryCount === 1 ? "person" : "people"} already added
              and replace them with the {parsed?.entries.length ?? 0} from
              this {source}. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingReplace(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={runImport}>
              Replace all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
