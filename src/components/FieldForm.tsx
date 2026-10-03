import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileTextIcon,
  LockIcon,
  Trash2Icon,
  UnlockIcon,
  UsersIcon,
} from "lucide-react";
import { Rnd } from "react-rnd";
import { BoxStyleDialog } from "@/components/BoxStyleDialog";
import { ImportEntriesDialog } from "@/components/ImportEntriesDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  makeUnitConverters,
  sortBoxesByPosition,
  type PixelRect,
} from "@/lib/boxGeometry";
import { matchEmployerField } from "@/lib/employerProfile";
import {
  base64ToBytes,
  downloadPdfBytes,
  exportFilledPdf,
  getPageSize,
  loadPdfDocument,
  renderPdfPageToCanvas,
} from "@/lib/pdf";
import { resizeHandleStyles } from "@/lib/rndHandleStyles";
import {
  saveTemplateBoxes,
  saveTemplateEntries,
  saveTemplateValues,
} from "@/lib/template";
import { validateFieldValue } from "@/lib/validation";
import type {
  EmployerField,
  FieldBox,
  Template,
  TemplateEntry,
} from "@/types/template";

type FieldFormProps = {
  template: Template;
  onBack: () => void;
  onEditFields: () => void;
};

const PAGE_WIDTH = 800;
const PAGE_NUMBER = 1; // v1 only supports single-page templates (see roadmap)
const REDRAW_DEBOUNCE_MS = 80;
const VALUES_SAVE_DEBOUNCE_MS = 400;
const ENTRIES_SAVE_DEBOUNCE_MS = 400;

// The only fonts allowed for preview/export (see CLAUDE.md hard rules),
// mapped to their closest canvas-safe equivalents.
const CSS_FONT_FAMILY: Record<FieldBox["fontFamily"], string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times-Roman": '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

// Employer-level fields (company name, TAN, ...) don't vary per person, so
// this is reused both for the first person and every "next person" reset.
// `employerFields` comes from this specific template (see
// CompanyDetailsPanel) — not shared with any other template.
function computeEmployerAutofill(
  boxes: FieldBox[],
  employerFields: EmployerField[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const box of boxes) {
    const match = matchEmployerField(box.name, employerFields);
    if (match && match.value) {
      result[box.id] = match.value;
    }
  }
  return result;
}

export function FieldForm({
  template,
  onBack,
  onEditFields,
}: FieldFormProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  // Start from employer autofill, then let whatever was last saved for this
  // template (see roadmap Step 7) win — a saved value always wins, so
  // autofill never overwrites something the user actually typed.
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...computeEmployerAutofill(template.boxes, template.employerFields ?? []),
    ...(template.values ?? {}),
  }));

  // Entries hold one filled-in person each, for exporting everyone as a
  // single multi-page PDF (see roadmap). `values` above always represents
  // whichever person is currently in the form; `activeEntryId` says whether
  // that's an already-added entry (edits sync back to it) or a fresh,
  // not-yet-added person. Restored from the template so navigating away
  // mid-batch and coming back doesn't lose anyone already added.
  const [entries, setEntries] = useState<TemplateEntry[]>(
    () => template.entries ?? [],
  );
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [confirmingClearEntries, setConfirmingClearEntries] = useState(false);

  // Positions are locked by default so filling in values day-to-day never
  // risks an accidental drag (see roadmap Step 5).
  const [locked, setLocked] = useState(true);
  const [boxes, setBoxes] = useState<FieldBox[]>(template.boxes);
  const [positionsDirty, setPositionsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await loadPdfDocument(base64ToBytes(template.pdfData));
        if (cancelled || !pdfCanvasRef.current) return;
        await renderPdfPageToCanvas(
          pdf,
          PAGE_NUMBER,
          pdfCanvasRef.current,
          PAGE_WIDTH,
        );
        const size = await getPageSize(pdf, PAGE_NUMBER);
        if (cancelled) return;
        setPageSize(size);
        setCanvasSize({
          width: pdfCanvasRef.current.width,
          height: pdfCanvasRef.current.height,
        });
      } catch {
        if (!cancelled) setError("This file doesn't look like a PDF.");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [template.pdfData]);

  const { pixelToPointRect, pointToPixelRect, pointsToPixels } = useMemo(
    () => makeUnitConverters(pageSize?.width ?? 1, canvasSize?.width ?? 1),
    [pageSize, canvasSize],
  );

  // The input list follows reading order (top-to-bottom, then left-to-right)
  // rather than the order boxes were drawn in — `boxes` itself stays in
  // creation order since that's what gets saved.
  const orderedBoxes = useMemo(() => sortBoxesByPosition(boxes), [boxes]);

  // Redraw the text overlay whenever a value or box position changes, on a
  // separate canvas layered over the (already-rendered) PDF page — cheap
  // enough that a light debounce is just a safety margin against fast typing.
  useEffect(() => {
    if (!canvasSize) return;
    const timeout = setTimeout(() => {
      const canvas = textCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const box of boxes) {
        const value = values[box.id];
        if (!value) continue;

        const pixelRect = pointToPixelRect(box);
        const fontSizePx = pointsToPixels(box.fontSize);

        ctx.font = `${box.bold ? "bold " : ""}${fontSizePx}px ${CSS_FONT_FAMILY[box.fontFamily]}`;
        ctx.fillStyle = box.color;
        ctx.textBaseline = "middle";
        ctx.textAlign = box.align;

        const textX =
          box.align === "left"
            ? pixelRect.x
            : box.align === "center"
              ? pixelRect.x + pixelRect.width / 2
              : pixelRect.x + pixelRect.width;
        const textY = pixelRect.y + pixelRect.height / 2;

        ctx.fillText(value, textX, textY);
      }
    }, REDRAW_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [values, boxes, canvasSize, pointToPixelRect, pointsToPixels]);

  // Persist values with the template so leaving and coming back shows what
  // was last typed, not a blank form — debounced the same way as the
  // preview redraw so fast typing doesn't hit localStorage on every key.
  useEffect(() => {
    const timeout = setTimeout(() => {
      saveTemplateValues(template.id, values);
    }, VALUES_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [template.id, values]);

  // Persist the in-progress batch the same way — so navigating away after
  // adding several people and coming back restores the full list, not just
  // whatever was last typed into the form.
  useEffect(() => {
    const timeout = setTimeout(() => {
      saveTemplateEntries(template.id, entries);
    }, ENTRIES_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [template.id, entries]);

  // Background backstop: keeps the active entry roughly in sync while the
  // user is mid-typing. The switch/add-next handlers below do their own
  // synchronous flush (via functional setEntries) for the moments that
  // actually matter, since this effect runs asynchronously after paint and
  // can't be relied on to have caught up before the next click.
  useEffect(() => {
    if (activeEntryId === null) return;
    setEntries((current) =>
      current.map((entry) =>
        entry.id === activeEntryId ? { ...entry, values } : entry,
      ),
    );
  }, [activeEntryId, values]);

  function handleChange(boxId: string, value: string) {
    setValues((current) => ({ ...current, [boxId]: value }));
  }

  // The only way values go away — everything else (autofill, saving) only
  // ever adds or preserves what's there.
  function handleClearValues() {
    setValues({});
    setConfirmingClear(false);
  }

  // Saves the person currently in the form — as a new entry if they weren't
  // one yet, or by flushing the edit into their existing entry — then starts
  // a fresh, blank form for the next person. Employer-level fields are kept
  // since they don't vary per person.
  //
  // The flush here is synchronous (via the functional setEntries form, using
  // `activeEntryId`/`values` read fresh from this render's closure) rather
  // than relying on the background sync effect above to have already caught
  // up — that effect runs asynchronously after paint, so a click landing
  // before it flushes could otherwise silently drop the latest edit.
  function handleAddAndFillNext() {
    setEntries((current) =>
      activeEntryId === null
        ? [...current, { id: crypto.randomUUID(), values }]
        : current.map((entry) =>
            entry.id === activeEntryId ? { ...entry, values } : entry,
          ),
    );
    setActiveEntryId(null);
    setValues(computeEmployerAutofill(boxes, template.employerFields ?? []));
  }

  // Flushes the form's current values into whichever entry was active
  // before switching (same reasoning as handleAddAndFillNext above) so
  // clicking around the list never silently discards unsaved edits.
  function handleSelectEntry(entryId: string) {
    if (entryId === activeEntryId) return;

    // Safe to read from the pre-flush `entries` snapshot: the target entry
    // is (by the guard above) never the one being flushed, so its values
    // are unaffected by the flush below.
    const target = entries.find((candidate) => candidate.id === entryId);
    if (!target) return;

    setEntries((current) =>
      activeEntryId === null
        ? current
        : current.map((entry) =>
            entry.id === activeEntryId ? { ...entry, values } : entry,
          ),
    );
    setActiveEntryId(entryId);
    setValues(target.values);
  }

  function handleDeleteEntry() {
    if (!deletingEntryId) return;
    setEntries((current) =>
      current.filter((entry) => entry.id !== deletingEntryId),
    );
    if (activeEntryId === deletingEntryId) {
      setActiveEntryId(null);
      setValues(computeEmployerAutofill(boxes, template.employerFields ?? []));
    }
    setDeletingEntryId(null);
  }

  // Imported people become regular batch entries, same shape as one added
  // through "Add & fill next person" — kept as its own path (see
  // ImportEntriesDialog) rather than merged into that flow. Selecting the
  // last imported person afterward, the same way handleAddAndFillNext
  // leaves its new person selected, keeps the form's `values` matching a
  // real entry — otherwise handleDownload's "new not-yet-added person"
  // logic (see its comment) would mistake leftover form state for an extra,
  // blank trailing person in the export.
  function handleImportEntries(
    importedValues: Record<string, string>[],
    mode: "append" | "replace",
  ) {
    const imported: TemplateEntry[] = importedValues.map((entryValues) => ({
      id: crypto.randomUUID(),
      values: entryValues,
    }));
    setEntries((current) =>
      mode === "replace" ? imported : [...current, ...imported],
    );
    const lastImported = imported[imported.length - 1];
    setActiveEntryId(lastImported.id);
    setValues(lastImported.values);
  }

  // Separate from deleting one person at a time — lets the user start a
  // fresh batch without clicking "delete" on everyone individually.
  function handleClearAllEntries() {
    setEntries([]);
    setActiveEntryId(null);
    setValues(computeEmployerAutofill(boxes, template.employerFields ?? []));
    setConfirmingClearEntries(false);
  }

  function updateBoxRect(id: string, pixelRect: PixelRect) {
    const point = pixelToPointRect(pixelRect);
    setBoxes((current) =>
      current.map((box) =>
        box.id === id
          ? {
              ...box,
              x: point.x,
              y: point.y,
              width: point.width,
              height: point.height,
            }
          : box,
      ),
    );
    setPositionsDirty(true);
  }

  function handleSaveChanges() {
    setSaving(true);
    saveTemplateBoxes(template.id, boxes);
    setPositionsDirty(false);
    setSaving(false);
  }

  function handleResetToTemplate() {
    setBoxes(template.boxes);
    setPositionsDirty(false);
  }

  function updateBoxStyle(updated: FieldBox) {
    setBoxes((current) =>
      current.map((box) => (box.id === updated.id ? updated : box)),
    );
    setPositionsDirty(true);
  }

  async function handleDownload() {
    setExporting(true);
    try {
      // No one added via "Add & fill next person" — fall back to exactly
      // what's in the form now, so the common single-person case needs no
      // extra click and produces the same single-page PDF as always. When
      // people HAVE been added, flush the form's current values into
      // whichever slot it represents — the active entry if editing one, or
      // a new trailing person otherwise — rather than trusting the
      // background sync effect to have already caught up (same reasoning
      // as the explicit flushes in handleAddAndFillNext/handleSelectEntry):
      // without this, the last person typed in without clicking "Add &
      // fill next person" again was silently left out of the download.
      const entriesValues =
        entries.length === 0
          ? [values]
          : [
              ...entries.map((entry) =>
                entry.id === activeEntryId ? values : entry.values,
              ),
              ...(activeEntryId === null ? [values] : []),
            ];
      const bytes = await exportFilledPdf(
        template.pdfData,
        boxes,
        entriesValues,
      );
      const filename = `${template.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      downloadPdfBytes(bytes, filename);
    } catch (err) {
      console.error("Export failed:", err);
      setError(
        "Something went wrong creating your PDF. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {template.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {boxes.length > 0 && (
            <Button onClick={handleDownload} disabled={exporting}>
              {exporting ? "Preparing PDF…" : "Download PDF"}
            </Button>
          )}
          {positionsDirty && (
            <>
              <span className="text-sm text-muted-foreground">
                Unsaved changes
              </span>
              <Button variant="outline" onClick={handleResetToTemplate}>
                Reset to template
              </Button>
              <Button onClick={handleSaveChanges} disabled={saving}>
                {saving ? "Saving…" : "Save changes to template"}
              </Button>
            </>
          )}
          <Button
            variant="outline"
            onClick={() => setLocked((current) => !current)}
          >
            {locked ? (
              <>
                <LockIcon /> Positions locked
              </>
            ) : (
              <>
                <UnlockIcon /> Positions unlocked
              </>
            )}
          </Button>
          <Button variant="outline" onClick={onEditFields}>
            Edit fields
          </Button>
          {boxes.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setConfirmingClear(true)}
            >
              Clear values
            </Button>
          )}
          <Button variant="outline" onClick={onBack}>
            Back to templates
          </Button>
        </div>
      </div>

      {boxes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FileTextIcon className="size-6 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">
            This template doesn't have any fields yet.
          </p>
          <Button onClick={onEditFields}>Add fields</Button>
        </div>
      ) : (
        <div className="flex w-full items-start gap-6">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div
              className="relative shrink-0 select-none"
              style={
                canvasSize
                  ? { width: canvasSize.width, height: canvasSize.height }
                  : undefined
              }
            >
              <canvas
                ref={pdfCanvasRef}
                className="rounded-lg border border-border"
              />
              <canvas
                ref={textCanvasRef}
                width={canvasSize?.width}
                height={canvasSize?.height}
                className="pointer-events-none absolute inset-0"
              />

              {canvasSize &&
              boxes.map((box) => {
                const pixelRect = pointToPixelRect(box);

                if (locked) {
                  return (
                    <div
                      key={box.id}
                      className="absolute cursor-pointer border border-dashed border-muted-foreground/50 hover:border-primary"
                      style={{
                        left: pixelRect.x,
                        top: pixelRect.y,
                        width: pixelRect.width,
                        height: pixelRect.height,
                      }}
                      onClick={() => setEditingBoxId(box.id)}
                    />
                  );
                }

                return (
                  <Rnd
                    key={box.id}
                    bounds="parent"
                    position={{ x: pixelRect.x, y: pixelRect.y }}
                    size={{ width: pixelRect.width, height: pixelRect.height }}
                    onDragStop={(_event, data) =>
                      updateBoxRect(box.id, {
                        ...pixelRect,
                        x: data.x,
                        y: data.y,
                      })
                    }
                    onResizeStop={(
                      _event,
                      _direction,
                      ref,
                      _delta,
                      position,
                    ) =>
                      updateBoxRect(box.id, {
                        x: position.x,
                        y: position.y,
                        width: parseFloat(ref.style.width),
                        height: parseFloat(ref.style.height),
                      })
                    }
                    resizeHandleStyles={resizeHandleStyles}
                    className="border-2 border-primary bg-primary/10 hover:bg-primary/20"
                  >
                    <div
                      className="h-full w-full cursor-pointer"
                      onClick={() => setEditingBoxId(box.id)}
                    >
                      <span className="pointer-events-none absolute -top-6 left-0 rounded bg-primary px-1.5 py-0.5 text-xs whitespace-nowrap text-primary-foreground">
                        {box.name}
                      </span>
                    </div>
                  </Rnd>
                );
              })}
            </div>
          </div>

          <div className="flex w-72 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Fields</h3>
            {/* Fields follow their position on the page — top-to-bottom,
                then left-to-right — not the order they were drawn in. */}
            {orderedBoxes.map((box) => {
              const warning = validateFieldValue(
                box.validationType,
                values[box.id] ?? "",
              );
              return (
                <div key={box.id} className="flex flex-col gap-1">
                  <label
                    htmlFor={`field-${box.id}`}
                    className="text-sm font-medium"
                  >
                    {box.name}
                  </label>
                  <Input
                    id={`field-${box.id}`}
                    value={values[box.id] ?? ""}
                    onChange={(event) =>
                      handleChange(box.id, event.target.value)
                    }
                  />
                  {warning && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">
                      {warning}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex w-56 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                People
              </h3>
              {entries.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingClearEntries(true)}
                >
                  Clear all
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={handleAddAndFillNext}>
              Add &amp; fill next person
            </Button>
            <ImportEntriesDialog
              boxes={boxes}
              existingEntryCount={entries.length}
              onImport={handleImportEntries}
            />

            {entries.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center">
                <UsersIcon className="size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Filling in just one person? Download PDF works right away —
                  this list is only for several people at once.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {entries.map((entry, index) => (
                  <li key={entry.id}>
                    <div
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                        entry.id === activeEntryId
                          ? "border-primary bg-primary/10"
                          : "border-border"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectEntry(entry.id)}
                        className="flex-1 truncate text-left text-sm"
                      >
                        Person {index + 1}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete Person ${index + 1}`}
                        onClick={() => setDeletingEntryId(entry.id)}
                      >
                        <Trash2Icon className="text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <BoxStyleDialog
        box={boxes.find((box) => box.id === editingBoxId) ?? null}
        onChange={updateBoxStyle}
        onClose={() => setEditingBoxId(null)}
      />

      <Dialog
        open={confirmingClear}
        onOpenChange={(open) => !open && setConfirmingClear(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all values?</DialogTitle>
            <DialogDescription>
              This will erase everything typed into this template's fields.
              This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearValues}>
              Clear values
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingEntryId !== null}
        onOpenChange={(open) => !open && setDeletingEntryId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this person?</DialogTitle>
            <DialogDescription>
              This will remove "Person{" "}
              {entries.findIndex((entry) => entry.id === deletingEntryId) + 1}
              " from this download. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingEntryId(null)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteEntry}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmingClearEntries}
        onOpenChange={(open) => !open && setConfirmingClearEntries(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all people?</DialogTitle>
            <DialogDescription>
              This will remove everyone added to this batch ({entries.length}{" "}
              {entries.length === 1 ? "person" : "people"}). This can't be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingClearEntries(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearAllEntries}>
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
