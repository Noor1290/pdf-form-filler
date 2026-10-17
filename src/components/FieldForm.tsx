import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlertIcon,
  DownloadIcon,
  EraserIcon,
  FileTextIcon,
  LockIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UnlockIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { Rnd } from "react-rnd";
import { BoxStyleDialog } from "@/components/BoxStyleDialog";
import { ImportEntriesDialog } from "@/components/ImportEntriesDialog";
import { SaveFailedDialog } from "@/components/SaveFailedDialog";
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
  loadValueMeasurer,
  renderPdfPageToCanvas,
  type ReplacedCharacters,
} from "@/lib/pdf";
import type { DashboardPayroll } from "@/lib/payrollHub";
import { resizeHandleStyles } from "@/lib/rndHandleStyles";
import { templateStore } from "@/lib/templateStore";
import { validateFieldValue } from "@/lib/validation";
import { createDragClickGuard, hasMoved } from "@/lib/dragClick";
import { useReportUnsaved } from "@/lib/unsavedChanges";
import type {
  EmployerField,
  FieldBox,
  Template,
  TemplateEntry,
} from "@/types/template";

const { saveTemplateBoxes, saveTemplateEntries, saveTemplateValues } =
  templateStore;

type FieldFormProps = {
  template: Template;
  onBack: () => void;
  onEditFields: () => void;
  // Payroll results waiting from the Payroll Hub dashboard, if any (always
  // null when the app is opened on its own) — handed straight to the same
  // import preview a file goes through.
  dashboardData: DashboardPayroll | null;
  onDashboardImported: () => void;
  onDashboardPreviewClosed: () => void;
  // The offline copy: the form can be filled in and the PDF downloaded, but
  // nothing about the template can be changed (its fields, or where they sit).
  readOnly?: boolean;
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

// Whether two sets of values put the same text in every field. A field that
// was never touched counts the same as one that was emptied again.
function sameValues(
  a: Record<string, string>,
  b: Record<string, string>,
): boolean {
  const boxIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const boxId of boxIds) {
    if ((a[boxId] ?? "") !== (b[boxId] ?? "")) return false;
  }
  return true;
}

function hasAnyValue(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value !== "");
}

// The form is saved as plain values, without saying whose they are. When
// they are exactly a listed person's, the form was showing that person when
// the screen was left, and it is that person again on coming back: treating
// them as someone new put the same person in the download twice.
function findEntryShownInForm(template: Template): TemplateEntry | undefined {
  const savedValues = template.values ?? {};
  if (!hasAnyValue(savedValues)) return undefined;
  return (template.entries ?? []).findLast((entry) =>
    sameValues(entry.values, savedValues),
  );
}

// One line of the "could not be printed" list shown after a download.
type UnprintedValue = {
  person: string | null; // null when the download is the form alone
  boxName: string;
  characters: string[];
};

export function FieldForm({
  template,
  onBack,
  onEditFields,
  dashboardData,
  onDashboardImported,
  onDashboardPreviewClosed,
  readOnly = false,
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
  // The listed person the form was left showing, if any (see
  // findEntryShownInForm). Worked out once, when the screen opens.
  const [entryShownOnOpening] = useState(() => findEntryShownInForm(template));
  // Start from employer autofill, then let whatever was last saved for this
  // template (see roadmap Step 7) win — a saved value always wins, so
  // autofill never overwrites something the user actually typed. A listed
  // person's values are shown as they are, the same as after clicking them.
  const [values, setValues] = useState<Record<string, string>>(
    () =>
      entryShownOnOpening?.values ?? {
        ...computeEmployerAutofill(
          template.boxes,
          template.employerFields ?? [],
        ),
        ...(template.values ?? {}),
      },
  );

  // Entries hold one filled-in person each, for exporting everyone as a
  // single multi-page PDF (see roadmap). `values` above always represents
  // whichever person is currently in the form; `activeEntryId` says whether
  // that's an already-added entry (edits sync back to it) or a fresh,
  // not-yet-added person. Restored from the template so navigating away
  // mid-batch and coming back doesn't lose anyone already added.
  const [entries, setEntries] = useState<TemplateEntry[]>(
    () => template.entries ?? [],
  );
  const [activeEntryId, setActiveEntryId] = useState<string | null>(
    entryShownOnOpening?.id ?? null,
  );
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
  // The click that ends moving a field does not open its settings.
  const dragGuard = useMemo(createDragClickGuard, []);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Which parts of this screen the browser refused to store (its storage
  // for this site is full). While either is set the screen says "NOT
  // saved": what is shown must never pass for saved when it is not.
  const [unsaved, setUnsaved] = useState({ values: false, entries: false });
  const notSaved = unsaved.values || unsaved.entries;
  // While it says "NOT saved", the dashboard asks before it reloads the tool.
  useReportUnsaved("form", notSaved);
  // The same, readable from the delayed saves below without waiting for the
  // next render.
  const unsavedNow = useRef(unsaved);
  const [saveFailure, setSaveFailure] = useState<
    "form-and-people" | "positions" | null
  >(null);
  // Opening the screen stores it again exactly as it was found. If that is
  // refused, nothing the user did is lost, so it is not reported.
  const valuesOnOpening = useRef(values);
  const entriesOnOpening = useRef(entries);
  // Shown after a download in which some characters could not be printed.
  const [unprintedValues, setUnprintedValues] = useState<
    UnprintedValue[] | null
  >(null);

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

  // Measures a value as the download draws it, so a value wider than its box
  // is said beside its field (audit M16). Until the fonts are loaded, and if
  // they cannot be, nothing is said.
  const [measureValue, setMeasureValue] = useState<
    ((box: FieldBox, value: string) => number) | null
  >(null);
  useEffect(() => {
    let live = true;
    loadValueMeasurer()
      .then((measure) => {
        if (live) setMeasureValue(() => measure);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

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

  // The blocking warning opens when a save is first refused, not again on
  // every key typed after that; the notice on the screen stays until a save
  // works. Says whether the warning was opened just now.
  function recordSaves(after: { values: boolean; entries: boolean }): boolean {
    const before = unsavedNow.current;
    unsavedNow.current = after;
    setUnsaved(after);
    const wasSaved = !before.values && !before.entries;
    const justRefused = wasSaved && (after.values || after.entries);
    if (justRefused) setSaveFailure("form-and-people");
    return justRefused;
  }

  // What the two delayed saves below have not stored yet. Kept apart from
  // their timers so that leaving the screen can store it at once: a timer
  // that is cancelled must not take the last change with it.
  const waitingToSave = useRef<{
    values?: Record<string, string>;
    entries?: TemplateEntry[];
  }>({});

  function saveWaitingValues(templateId: string): boolean {
    const waiting = waitingToSave.current.values;
    if (waiting === undefined) return false;
    waitingToSave.current.values = undefined;
    const saved =
      saveTemplateValues(templateId, waiting) ||
      waiting === valuesOnOpening.current;
    return recordSaves({ ...unsavedNow.current, values: !saved });
  }

  function saveWaitingEntries(templateId: string): boolean {
    const waiting = waitingToSave.current.entries;
    if (waiting === undefined) return false;
    waitingToSave.current.entries = undefined;
    const saved =
      saveTemplateEntries(templateId, waiting) ||
      waiting === entriesOnOpening.current;
    return recordSaves({ ...unsavedNow.current, entries: !saved });
  }

  // The People list as last drawn, for the moments below that run outside a
  // render (leaving the screen, closing the page).
  const listNow = useRef({ entries, activeEntryId });
  useEffect(() => {
    listNow.current = { entries, activeEntryId };
  }, [entries, activeEntryId]);

  // A value typed for a listed person reaches the form at once and the
  // People list one redraw later (the background backstop further down).
  // Leaving in between must not store that person without the last key, so
  // the list is brought level with the form first.
  function bringPeopleListLevel() {
    const typed = waitingToSave.current.values;
    const { entries: drawn, activeEntryId: activeId } = listNow.current;
    if (typed === undefined || activeId === null) return;
    const list = waitingToSave.current.entries ?? drawn;
    const active = list.find((entry) => entry.id === activeId);
    if (!active || sameValues(active.values, typed)) return;
    waitingToSave.current.entries = list.map((entry) =>
      entry.id === activeId ? { ...entry, values: typed } : entry,
    );
  }

  // Stores at once whatever is still waiting. Says whether the "NOT saved"
  // warning was opened by it, that is, the browser refused and this is the
  // first the user hears of it.
  function saveWhatIsWaiting(templateId: string): boolean {
    bringPeopleListLevel();
    const valuesJustRefused = saveWaitingValues(templateId);
    const entriesJustRefused = saveWaitingEntries(templateId);
    return valuesJustRefused || entriesJustRefused;
  }

  // Persist values with the template so leaving and coming back shows what
  // was last typed, not a blank form — debounced the same way as the
  // preview redraw so fast typing doesn't hit localStorage on every key.
  useEffect(() => {
    waitingToSave.current.values = values;
    const timeout = setTimeout(
      () => saveWaitingValues(template.id),
      VALUES_SAVE_DEBOUNCE_MS,
    );

    return () => clearTimeout(timeout);
  }, [template.id, values]);

  // Persist the in-progress batch the same way — so navigating away after
  // adding several people and coming back restores the full list, not just
  // whatever was last typed into the form.
  useEffect(() => {
    waitingToSave.current.entries = entries;
    const timeout = setTimeout(
      () => saveWaitingEntries(template.id),
      ENTRIES_SAVE_DEBOUNCE_MS,
    );

    return () => clearTimeout(timeout);
  }, [template.id, entries]);

  // Whatever the delayed saves were still waiting to store is stored when
  // the page is closed or reloaded, and when this screen closes by any
  // route. A refusal the user has not been told about holds the page: the
  // browser asks before leaving, and the warning is there on staying.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (saveWhatIsWaiting(template.id)) event.preventDefault();
    }
    function handlePageHide() {
      saveWhatIsWaiting(template.id);
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      saveWhatIsWaiting(template.id);
    };
  }, [template.id]);

  // "Back to templates" and "Edit fields" store what is waiting first. If
  // the browser refuses and the user is only now being told, they stay here
  // with the warning: on this screen the PDF can still be downloaded, and
  // leaving is what would lose it. Once told, leaving is not held back.
  function leaveScreen(goThere: () => void) {
    const justRefused = saveWhatIsWaiting(template.id);
    if (!justRefused) goThere();
  }

  function handleRetrySave() {
    const valuesSaved = saveTemplateValues(template.id, values);
    const entriesSaved = saveTemplateEntries(template.id, entries);
    unsavedNow.current = { values: !valuesSaved, entries: !entriesSaved };
    setUnsaved(unsavedNow.current);
    if (!valuesSaved || !entriesSaved) setSaveFailure("form-and-people");
  }

  // Background backstop: keeps the active entry roughly in sync while the
  // user is mid-typing. The switch/add-next handlers below do their own
  // synchronous flush (via functional setEntries) for the moments that
  // actually matter, since this effect runs asynchronously after paint and
  // can't be relied on to have caught up before the next click.
  useEffect(() => {
    if (activeEntryId === null) return;
    setEntries((current) => {
      // Already in step (a person just selected, or just restored on
      // opening): the list is left as it is, so it is not saved again.
      const active = current.find((entry) => entry.id === activeEntryId);
      if (!active || active.values === values) return current;
      return current.map((entry) =>
        entry.id === activeEntryId ? { ...entry, values } : entry,
      );
    });
  }, [activeEntryId, values]);

  // True while the form holds someone typed in but not added to the list
  // yet: something has been typed, and it is more than the company details
  // every new person starts with.
  const formHoldsNewPerson =
    activeEntryId === null &&
    hasAnyValue(values) &&
    !sameValues(
      values,
      computeEmployerAutofill(boxes, template.employerFields ?? []),
    );

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
  // clicking around the list never silently discards unsaved edits. A new
  // person typed in but not added yet is added to the list first, for the
  // same reason: the switch used to throw them away without a word.
  function handleSelectEntry(entryId: string) {
    if (entryId === activeEntryId) return;

    // Safe to read from the pre-flush `entries` snapshot: the target entry
    // is (by the guard above) never the one being flushed, so its values
    // are unaffected by the flush below.
    const target = entries.find((candidate) => candidate.id === entryId);
    if (!target) return;

    const typedPerson: TemplateEntry | null = formHoldsNewPerson
      ? { id: crypto.randomUUID(), values }
      : null;
    setEntries((current) => {
      if (typedPerson) return [...current, typedPerson];
      return activeEntryId === null
        ? current
        : current.map((entry) =>
            entry.id === activeEntryId ? { ...entry, values } : entry,
          );
    });
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
    // Each imported person gets the template's company details, as a person
    // typed by hand does, under the values in the file: a value the file
    // has wins; a column it lacks, or leaves blank, keeps the company detail.
    const employerValues = computeEmployerAutofill(
      boxes,
      template.employerFields ?? [],
    );
    const imported: TemplateEntry[] = importedValues.map((entryValues) => {
      const values = { ...entryValues };
      for (const [boxId, value] of Object.entries(employerValues)) {
        if (!values[boxId]) values[boxId] = value;
      }
      return { id: crypto.randomUUID(), values };
    });
    setEntries((current) =>
      mode === "replace" ? imported : [...current, ...imported],
    );
    const lastImported = imported[imported.length - 1];
    setActiveEntryId(lastImported.id);
    setValues(lastImported.values);
  }

  // Separate from deleting one person at a time — lets the user start a
  // fresh batch without clicking "delete" on everyone individually.
  //
  // The form is only emptied when it was showing one of the people being
  // removed. Someone still being typed in is not in the list (the
  // confirmation counts only the people who are), so they stay in the form.
  function handleClearAllEntries() {
    setEntries([]);
    if (activeEntryId !== null) {
      setActiveEntryId(null);
      setValues(computeEmployerAutofill(boxes, template.employerFields ?? []));
    }
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

  // A save the browser refused leaves "Unsaved changes" showing.
  function handleSaveChanges() {
    setSaving(true);
    if (saveTemplateBoxes(template.id, boxes)) setPositionsDirty(false);
    else setSaveFailure("positions");
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
      const replaced: ReplacedCharacters[] = [];
      const bytes = await exportFilledPdf(
        template.pdfData,
        boxes,
        entriesValues,
        (found) => replaced.push(found),
      );
      const filename = `${template.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      downloadPdfBytes(bytes, filename);

      // A character the fonts cannot print no longer stops the download:
      // it is replaced, and the people and fields concerned are listed.
      if (replaced.length > 0) {
        setUnprintedValues(
          replaced.map(({ entryIndex, boxName, characters }) => ({
            person:
              entries.length === 0
                ? null
                : entryIndex < entries.length
                  ? `Person ${entryIndex + 1}`
                  : "The person in the form (not in the list yet)",
            boxName,
            characters,
          })),
        );
      }
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
    <div className="flex w-full max-w-296 flex-col gap-5">
      <div className="flex w-full animate-rise flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">
          {template.name}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {boxes.length > 0 && (
            <Button onClick={handleDownload} disabled={exporting}>
              <DownloadIcon />
              {exporting ? "Preparing PDF…" : "Download PDF"}
            </Button>
          )}
          {positionsDirty && (
            <>
              <span className="badge text-warn">Unsaved changes</span>
              <Button variant="outline" onClick={handleResetToTemplate}>
                Reset to template
              </Button>
              <Button onClick={handleSaveChanges} disabled={saving}>
                {saving ? "Saving…" : "Save changes to template"}
              </Button>
            </>
          )}
          {!readOnly && (
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
          )}
          {!readOnly && (
            <Button variant="outline" onClick={() => leaveScreen(onEditFields)}>
              Edit fields
            </Button>
          )}
          {boxes.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setConfirmingClear(true)}
            >
              Clear values
            </Button>
          )}
          <Button variant="outline" onClick={() => leaveScreen(onBack)}>
            Back to templates
          </Button>
        </div>
      </div>

      {/* Stays for as long as what is on this screen is not stored. */}
      {notSaved && (
        <div
          role="alert"
          className="notice-panel notice-danger flex-wrap items-center"
        >
          <TriangleAlertIcon />
          <p className="min-w-0 flex-1 basis-80">
            <strong>NOT saved.</strong> The browser's storage for this tool is
            full, so what you see on this screen is not saved. It will be gone
            when this page is closed or reloaded. You can still download the
            PDF now.
          </p>
          <Button variant="outline" size="sm" onClick={handleRetrySave}>
            Try saving again
          </Button>
        </div>
      )}

      {boxes.length === 0 ? (
        <div className="glass flex animate-rise flex-col items-center gap-4 p-12 text-center">
          <div className="icon-tile">
            <FileTextIcon className="size-5" />
          </div>
          <p className="text-muted">
            This template doesn't have any fields yet.
          </p>
          {!readOnly && (
            <Button onClick={() => leaveScreen(onEditFields)}>Add fields</Button>
          )}
        </div>
      ) : (
        <div className="flex w-full flex-col items-start gap-5 xl:flex-row xl:justify-between">
          {/* The preview keeps its true size at every window width and
              scrolls sideways inside this frame when the window is narrower
              than the page. Nothing here blurs, tints or overlays the page. */}
          <div className="preview-frame max-w-full overflow-x-auto p-4">
            <div
              className={
                canvasSize || error
                  ? "on-paper relative shrink-0 select-none"
                  : "on-paper relative h-140 w-200 shrink-0 select-none"
              }
              style={
                canvasSize
                  ? { width: canvasSize.width, height: canvasSize.height }
                  : undefined
              }
            >
              {/* Shown only until the page has been drawn, in its place. */}
              {!canvasSize && !error && (
                <div aria-hidden="true" className="skeleton absolute inset-0" />
              )}
              <canvas
                ref={pdfCanvasRef}
                className={
                  canvasSize
                    ? "rounded-lg border border-line"
                    : "invisible rounded-lg border border-line"
                }
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
                      className="absolute cursor-pointer border border-dashed border-accent/70 transition-colors duration-150 hover:border-solid hover:border-accent"
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
                    onDragStop={(_event, data) => {
                      dragGuard.dragStopped(
                        box.id,
                        hasMoved(pixelRect.x, pixelRect.y, data.x, data.y),
                      );
                      updateBoxRect(box.id, {
                        ...pixelRect,
                        x: data.x,
                        y: data.y,
                      });
                    }}
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
                    className="border-2 border-accent"
                  >
                    <div
                      className="h-full w-full cursor-pointer"
                      onClick={() => {
                        if (dragGuard.shouldOpen(box.id)) setEditingBoxId(box.id);
                      }}
                    >
                      <span className="pointer-events-none absolute -top-6 left-0 rounded bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap text-accent-fg">
                        {box.name}
                      </span>
                    </div>
                  </Rnd>
                );
              })}
            </div>
          </div>

          {/* Beside the preview on a wide window, underneath it on a narrow
              one (side by side there if they fit). */}
          <div className="grid w-full shrink-0 animate-rise items-start gap-5 sm:grid-cols-2 xl:w-80 xl:grid-cols-1">
          <section className="glass min-w-0">
            <div className="card-header">
              <h3 className="card-title">Fields</h3>
            </div>
            <div className="flex flex-col gap-4 p-4">
            {/* Fields follow their position on the page — top-to-bottom,
                then left-to-right — not the order they were drawn in. */}
            {orderedBoxes.map((box) => {
              const warning = validateFieldValue(
                box.validationType,
                values[box.id] ?? "",
              );
              const tooWide =
                measureValue !== null &&
                measureValue(box, values[box.id] ?? "") > box.width;
              return (
                <div key={box.id} className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`field-${box.id}`}
                    className="text-sm font-medium text-fg"
                  >
                    {box.name}
                  </label>
                  <Input
                    id={`field-${box.id}`}
                    value={values[box.id] ?? ""}
                    onChange={(event) =>
                      handleChange(box.id, event.target.value)
                    }
                    className={
                      box.validationType === "amount" ? "num" : undefined
                    }
                  />
                  {warning && (
                    <p className="flex items-center gap-1.5 text-xs text-warn">
                      <TriangleAlertIcon className="size-3.5 shrink-0" />
                      {warning}
                    </p>
                  )}
                  {tooWide && (
                    <p className="flex items-center gap-1.5 text-xs text-warn">
                      <TriangleAlertIcon className="size-3.5 shrink-0" />
                      Too long for its box: on the PDF it will run past the
                      edge of the box.
                    </p>
                  )}
                </div>
              );
            })}
            </div>
          </section>

          <section className="glass min-w-0">
            <div className="card-header">
              <h3 className="card-title">
                People
              </h3>
              {unsaved.entries && (
                <span className="badge text-danger">Not saved</span>
              )}
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
            <div className="flex flex-col gap-3 p-4">
            <Button variant="outline" onClick={handleAddAndFillNext}>
              <UserPlusIcon />
              Add &amp; fill next person
            </Button>
            <ImportEntriesDialog
              boxes={boxes}
              employerFields={template.employerFields ?? []}
              existingEntryCount={entries.length}
              onImport={handleImportEntries}
              dashboardData={dashboardData}
              onDashboardImported={onDashboardImported}
              onDashboardPreviewClosed={onDashboardPreviewClosed}
            />

            {entries.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line p-4 text-center">
                <div className="icon-tile">
                  <UsersIcon className="size-5" />
                </div>
                <p className="text-xs text-muted">
                  Filling in just one person? Download PDF works right away —
                  this list is only for several people at once.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {entries.map((entry, index) => (
                  <li key={entry.id}>
                    <div
                      className={`flex items-center justify-between gap-2 rounded-lg border py-1 pr-1 pl-3 transition-colors duration-150 ${
                        entry.id === activeEntryId
                          ? "border-accent bg-accent/10 shadow-[inset_3px_0_0_0_var(--accent)]"
                          : "border-line hover:bg-surface-hover"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectEntry(entry.id)}
                        aria-current={
                          entry.id === activeEntryId ? "true" : undefined
                        }
                        className={`flex-1 truncate rounded py-1.5 text-left text-sm text-fg ${
                          entry.id === activeEntryId ? "font-semibold" : ""
                        }`}
                      >
                        Person {index + 1}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete Person ${index + 1}`}
                        onClick={() => setDeletingEntryId(entry.id)}
                      >
                        <Trash2Icon className="text-danger" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </section>
          </div>
        </div>
      )}

      {error && (
        <p className="notice-panel notice-danger">
          <CircleAlertIcon />
          {error}
        </p>
      )}

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
          <DialogHeader icon={<EraserIcon />} tone="danger">
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
          <DialogHeader icon={<UserMinusIcon />} tone="danger">
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
          <DialogHeader icon={<UsersIcon />} tone="danger">
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

      <SaveFailedDialog
        open={saveFailure !== null}
        onClose={() => setSaveFailure(null)}
      >
        {saveFailure === "form-and-people"
          ? 'What you see on this screen is still here, and you can still download the PDF now, but it will be gone when this page is closed or reloaded. To make room, open this tool in another browser tab and delete a template you no longer need there, then come back here and press "Try saving again".'
          : undefined}
      </SaveFailedDialog>

      <Dialog
        open={unprintedValues !== null}
        onOpenChange={(open) => !open && setUnprintedValues(null)}
      >
        <DialogContent>
          <DialogHeader icon={<TriangleAlertIcon />} tone="warn">
            <DialogTitle>Some characters could not be printed</DialogTitle>
            <DialogDescription>
              Your PDF was downloaded, but the fonts this tool can use do not
              have every character. Each one listed here was replaced with
              "?" in the PDF (a line break or tab with a space). Please check
              these before you use it.
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1.5 text-sm text-fg">
            {(unprintedValues ?? []).map((unprinted, index) => (
              <li key={index}>
                {unprinted.person ? `${unprinted.person}, ` : ""}
                {unprinted.boxName}:{" "}
                {unprinted.characters
                  .map((character) =>
                    /\s/.test(character) ? "line break or tab" : character,
                  )
                  .filter((text, at, all) => all.indexOf(text) === at)
                  .join(" ")}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setUnprintedValues(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
