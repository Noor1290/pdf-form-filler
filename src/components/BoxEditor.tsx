import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { LayersIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { BoxStyleDialog } from "@/components/BoxStyleDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  makeUnitConverters,
  sortBoxesByPosition,
  type PixelRect,
} from "@/lib/boxGeometry";
import {
  base64ToBytes,
  getPageSize,
  loadPdfDocument,
  renderPdfPageToCanvas,
} from "@/lib/pdf";
import { resizeHandleStyles } from "@/lib/rndHandleStyles";
import { saveTemplateBoxes } from "@/lib/template";
import { inferValidationType } from "@/lib/validation";
import type { FieldBox, Template } from "@/types/template";

type BoxEditorProps = {
  template: Template;
  onBack: () => void;
};

// A box is only created once the user has dragged a noticeable distance —
// otherwise a stray click would create a tiny, useless box.
const MIN_DRAG_PIXELS = 6;
const PAGE_WIDTH = 800;
const PAGE_NUMBER = 1; // v1 only supports single-page templates (see roadmap)

export function BoxEditor({ template, onBack }: BoxEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [boxes, setBoxes] = useState<FieldBox[]>(template.boxes);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [draftRect, setDraftRect] = useState<PixelRect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [pendingBox, setPendingBox] = useState<PixelRect | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [deletingBox, setDeletingBox] = useState<FieldBox | null>(null);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [renamingBox, setRenamingBox] = useState<FieldBox | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await loadPdfDocument(base64ToBytes(template.pdfData));
        if (cancelled || !canvasRef.current) return;
        await renderPdfPageToCanvas(
          pdf,
          PAGE_NUMBER,
          canvasRef.current,
          PAGE_WIDTH,
        );
        const size = await getPageSize(pdf, PAGE_NUMBER);
        if (cancelled) return;
        setPageSize(size);
        setCanvasSize({
          width: canvasRef.current.width,
          height: canvasRef.current.height,
        });
      } catch {
        if (!cancelled) onError("This file doesn't look like a PDF.");
      }
    }

    function onError(message: string) {
      setError(message);
    }

    render();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.pdfData]);

  const { pixelToPointRect, pointToPixelRect } = makeUnitConverters(
    pageSize?.width ?? 1,
    canvasSize?.width ?? 1,
  );

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragStart.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    setDraftRect({ x: dragStart.current.x, y: dragStart.current.y, width: 0, height: 0 });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragStart.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const currentX = event.clientX - rect.left;
    const currentY = event.clientY - rect.top;
    const start = dragStart.current;

    setDraftRect({
      x: Math.min(start.x, currentX),
      y: Math.min(start.y, currentY),
      width: Math.abs(currentX - start.x),
      height: Math.abs(currentY - start.y),
    });
  }

  function handlePointerUp() {
    dragStart.current = null;
    setDraftRect((current) => {
      if (
        current &&
        current.width >= MIN_DRAG_PIXELS &&
        current.height >= MIN_DRAG_PIXELS
      ) {
        setPendingBox(current);
        setPendingName("");
      }
      return null;
    });
  }

  function confirmNewBox() {
    if (!pendingBox) return;
    const trimmed = pendingName.trim();
    if (!trimmed) return;

    const point = pixelToPointRect(pendingBox);
    const newBox: FieldBox = {
      id: crypto.randomUUID(),
      name: trimmed,
      page: PAGE_NUMBER,
      x: point.x,
      y: point.y,
      width: point.width,
      height: point.height,
      fontSize: 12,
      fontFamily: "Helvetica",
      bold: false,
      align: "left",
      color: "#000000",
      validationType: inferValidationType(trimmed),
    };

    setBoxes((current) => [...current, newBox]);
    setDirty(true);
    setPendingBox(null);
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
    setDirty(true);
  }

  function confirmDeleteBox() {
    if (!deletingBox) return;
    setBoxes((current) => current.filter((box) => box.id !== deletingBox.id));
    setDirty(true);
    setDeletingBox(null);
  }

  function updateBoxStyle(updated: FieldBox) {
    setBoxes((current) =>
      current.map((box) => (box.id === updated.id ? updated : box)),
    );
    setDirty(true);
  }

  function startRenameBox(box: FieldBox) {
    setRenamingBox(box);
    setRenameValue(box.name);
  }

  function confirmRenameBox() {
    if (!renamingBox) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;

    setBoxes((current) =>
      current.map((box) =>
        box.id === renamingBox.id ? { ...box, name: trimmed } : box,
      ),
    );
    setDirty(true);
    setRenamingBox(null);
  }

  function handleSave() {
    setSaving(true);
    saveTemplateBoxes(template.id, boxes);
    setDirty(false);
    setSaving(false);
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex w-full items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {template.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            Click and drag on the PDF to add a field. Click an existing field
            to change its font, size, color, or alignment.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {dirty && (
            <span className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
          )}
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save template"}
          </Button>
          <Button variant="outline" onClick={onBack}>
            Back to templates
          </Button>
        </div>
      </div>

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
              ref={canvasRef}
              className="rounded-lg border border-border"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />

            {draftRect && (
              <div
                className="pointer-events-none absolute border-2 border-dashed border-primary bg-primary/10"
                style={{
                  left: draftRect.x,
                  top: draftRect.y,
                  width: draftRect.width,
                  height: draftRect.height,
                }}
              />
            )}

            {canvasSize &&
              boxes.map((box) => {
                const pixelRect = pointToPixelRect(box);
                return (
                  <Rnd
                    key={box.id}
                    bounds="parent"
                    position={{ x: pixelRect.x, y: pixelRect.y }}
                    size={{
                      width: pixelRect.width,
                      height: pixelRect.height,
                    }}
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
                    className="group border-2 border-primary bg-primary/10 hover:bg-primary/20"
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

        <div className="flex w-64 shrink-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">Fields</h3>
          {boxes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
              <LayersIcon className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No fields yet — draw a box on the PDF to add one.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {sortBoxesByPosition(boxes).map((box) => (
                <li
                  key={box.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5"
                >
                  <span className="truncate text-sm">{box.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Rename field "${box.name}"`}
                      onClick={() => startRenameBox(box)}
                    >
                      <PencilIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete field "${box.name}"`}
                      onClick={() => setDeletingBox(box)}
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Dialog
        open={pendingBox !== null}
        onOpenChange={(open) => !open && setPendingBox(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this field</DialogTitle>
            <DialogDescription>
              This name will show up on the fill-in form later.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={pendingName}
            onChange={(event) => setPendingName(event.target.value)}
            placeholder="e.g. Employee Name"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmNewBox();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingBox(null)}>
              Cancel
            </Button>
            <Button onClick={confirmNewBox} disabled={!pendingName.trim()}>
              Add field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingBox !== null}
        onOpenChange={(open) => !open && setDeletingBox(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete field?</DialogTitle>
            <DialogDescription>
              This will remove the "{deletingBox?.name}" field from this
              template. You'll need to draw it again if you change your mind.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingBox(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteBox}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BoxStyleDialog
        box={boxes.find((box) => box.id === editingBoxId) ?? null}
        onChange={updateBoxStyle}
        onClose={() => setEditingBoxId(null)}
      />

      <Dialog
        open={renamingBox !== null}
        onOpenChange={(open) => !open && setRenamingBox(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename field</DialogTitle>
            <DialogDescription>
              Choose a new name for "{renamingBox?.name}".
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmRenameBox();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingBox(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRenameBox} disabled={!renameValue.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
