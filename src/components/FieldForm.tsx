import { useEffect, useMemo, useRef, useState } from "react";
import { LockIcon, UnlockIcon } from "lucide-react";
import { Rnd } from "react-rnd";
import { BoxStyleDialog } from "@/components/BoxStyleDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { makeUnitConverters, type PixelRect } from "@/lib/boxGeometry";
import { getEmployerProfile, matchEmployerField } from "@/lib/employerProfile";
import {
  base64ToBytes,
  downloadPdfBytes,
  exportFilledPdf,
  getPageSize,
  loadPdfDocument,
  renderPdfPageToCanvas,
} from "@/lib/pdf";
import { resizeHandleStyles } from "@/lib/rndHandleStyles";
import { saveTemplateBoxes } from "@/lib/template";
import { validateFieldValue } from "@/lib/validation";
import type { FieldBox, Template } from "@/types/template";

type FieldFormProps = {
  template: Template;
  onBack: () => void;
  onEditFields: () => void;
};

const PAGE_WIDTH = 800;
const PAGE_NUMBER = 1; // v1 only supports single-page templates (see roadmap)
const REDRAW_DEBOUNCE_MS = 80;

// The only fonts allowed for preview/export (see CLAUDE.md hard rules),
// mapped to their closest canvas-safe equivalents.
const CSS_FONT_FAMILY: Record<FieldBox["fontFamily"], string> = {
  Helvetica: "Helvetica, Arial, sans-serif",
  "Times-Roman": '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

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
  // Pre-fill any box whose name matches a known employer field (see roadmap
  // Step 7) — still just normal editable state from here on.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const profile = getEmployerProfile();
    const initial: Record<string, string> = {};
    for (const box of template.boxes) {
      const field = matchEmployerField(box.name);
      if (field && profile[field]) {
        initial[box.id] = profile[field];
      }
    }
    return initial;
  });

  // Positions are locked by default so filling in values day-to-day never
  // risks an accidental drag (see roadmap Step 5).
  const [locked, setLocked] = useState(true);
  const [boxes, setBoxes] = useState<FieldBox[]>(template.boxes);
  const [positionsDirty, setPositionsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);

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

  function handleChange(boxId: string, value: string) {
    setValues((current) => ({ ...current, [boxId]: value }));
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
      const bytes = await exportFilledPdf(template.pdfData, boxes, values);
      const filename = `${template.name.replace(/[^a-z0-9]+/gi, "_")}.pdf`;
      downloadPdfBytes(bytes, filename);
    } catch {
      setError(
        "Something went wrong creating your PDF. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex w-full items-center justify-between">
        <h2 className="text-xl font-semibold">{template.name}</h2>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" onClick={onBack}>
            Back to templates
          </Button>
        </div>
      </div>

      {boxes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground">
            This template doesn't have any fields yet.
          </p>
          <Button onClick={onEditFields}>Add fields</Button>
        </div>
      ) : (
        <div className="flex w-full items-start gap-6">
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
              className="rounded-md border border-border shadow-sm"
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

          <div className="flex w-72 shrink-0 flex-col gap-3">
            {/* Fields follow the order boxes were drawn in (boxes is
                already in creation order) — matches the natural
                top-to-bottom flow of filling in a form. */}
            {boxes.map((box) => {
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
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <BoxStyleDialog
        box={boxes.find((box) => box.id === editingBoxId) ?? null}
        onChange={updateBoxStyle}
        onClose={() => setEditingBoxId(null)}
      />
    </div>
  );
}
