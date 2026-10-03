import { useRef, useState } from "react";
import { UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImportFileError, parseImportFile, type ParsedImport } from "@/lib/importEntries";
import type { FieldBox } from "@/types/template";

type ImportEntriesDialogProps = {
  boxes: FieldBox[];
  existingEntryCount: number;
  onImport: (entries: Record<string, string>[], mode: "append" | "replace") => void;
};

const PREVIEW_ROW_COUNT = 3;

// Separate from the manual "Add & fill next person" flow — lets someone
// bring in a whole payroll export at once instead of typing each person in
// by hand. Everything happens in the browser (read the file, match its
// columns to this template's fields, show what would be imported) with no
// server involved, same as the rest of the app.
export function ImportEntriesDialog({
  boxes,
  existingEntryCount,
  onImport,
}: ImportEntriesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  const dialogOpen = parsed !== null || parseError !== null;

  function reset() {
    setParsed(null);
    setParseError(null);
    setReplaceMode(false);
    setConfirmingReplace(false);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setFileName(file.name);
    try {
      const text = await file.text();
      setParsed(parseImportFile(file.name, text, boxes));
      setParseError(null);
    } catch (err) {
      setParsed(null);
      setParseError(
        err instanceof ImportFileError
          ? err.message
          : "Something went wrong reading this file. Please try again.",
      );
    }
  }

  function runImport() {
    if (!parsed) return;
    onImport(parsed.entries, replaceMode ? "replace" : "append");
    reset();
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
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <UploadIcon /> Import entries
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && reset()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import entries</DialogTitle>
            <DialogDescription>
              From "{fileName}"
            </DialogDescription>
          </DialogHeader>

          {parseError && (
            <p className="text-sm text-destructive">{parseError}</p>
          )}

          {parsed && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">
                {parsed.entries.length}{" "}
                {parsed.entries.length === 1 ? "person" : "people"} found in
                this file.
              </p>

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
                  None of the columns in this file match a field in this
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
            <Button variant="outline" onClick={reset}>
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
              this file. This can't be undone.
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
