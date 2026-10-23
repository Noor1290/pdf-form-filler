import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import type { PdfDocument } from "@/lib/pdf";
import {
  DEFAULT_LIMIT_MM,
  MIN_BOX_MM,
  fitInside,
  formatSizeCm,
  maxBoxMm,
  pageMm,
  pixelsPerMmFor,
  pointsToMm,
} from "@/lib/formImages/measure";
import { resizeHandleStyles } from "@/lib/rndHandleStyles";
import type { FormPage, ImageBox } from "@/types/formImages";

// A box's place and size while it is being drawn, moved or resized.
export type LiveBox = {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
};

type FormPageViewProps = {
  page: FormPage;
  pageCount: number;
  pdf: PdfDocument | null;
  boxes: ImageBox[];
  selectedBoxId: string | null;
  onSelectBox: (id: string) => void;
  // A new box was drawn on this page (whole millimetres).
  onDrawBox: (rect: LiveBox) => void;
  onMoveBox: (id: string, rect: LiveBox) => void;
  // Told when a box being drawn or resized is held at its size limit.
  onAtLimit: (widthMm: number, heightMm: number) => void;
  // For a scan: how its cleaning went, and the cleaned picture to show
  // instead of the scan (null until it is cleaned, or when switched off).
  scanInfo?: React.ReactNode;
  cleanedUrl?: string | null;
};

export function FormPageView({
  page,
  pageCount,
  pdf,
  boxes,
  selectedBoxId,
  onSelectBox,
  onDrawBox,
  onMoveBox,
  onAtLimit,
  scanInfo,
  cleanedUrl,
}: FormPageViewProps) {
  const scale = pixelsPerMmFor(pointsToMm(page.widthPt));
  const sizeMm = pageMm(page);
  const widthPx = pointsToMm(page.widthPt) * scale;
  const heightPx = pointsToMm(page.heightPt) * scale;

  const [draft, setDraft] = useState<LiveBox | null>(null);
  // Whether the box being drawn is held at its limit.
  const [draftAtLimit, setDraftAtLimit] = useState(false);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  // The box being resized, with its size so far.
  const [resizing, setResizing] = useState<{ id: string } & LiveBox | null>(
    null,
  );

  // Whole millimetres under the pointer, kept on the page.
  function pointerMm(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (value: number, max: number) =>
      Math.max(0, Math.min(max, Math.round(value / scale)));
    return {
      x: clamp(event.clientX - rect.left, sizeMm.width),
      y: clamp(event.clientY - rect.top, sizeMm.height),
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = pointerMm(event);
    drawStart.current = start;
    setDraft({ xMm: start.x, yMm: start.y, widthMm: 0, heightMm: 0 });
  }

  // A new box gets the default limit, so it can't be drawn past it: the
  // corner being dragged stops there.
  function continueDrawing(event: React.PointerEvent<HTMLDivElement>) {
    const start = drawStart.current;
    if (!start) return;
    const now = pointerMm(event);
    const wantedWidth = Math.abs(now.x - start.x);
    const wantedHeight = Math.abs(now.y - start.y);
    const width = Math.min(wantedWidth, DEFAULT_LIMIT_MM);
    const height = Math.min(wantedHeight, DEFAULT_LIMIT_MM);
    const atLimit = wantedWidth > DEFAULT_LIMIT_MM || wantedHeight > DEFAULT_LIMIT_MM;
    setDraftAtLimit(atLimit);
    if (atLimit) onAtLimit(DEFAULT_LIMIT_MM, DEFAULT_LIMIT_MM);
    setDraft({
      xMm: now.x < start.x ? start.x - width : start.x,
      yMm: now.y < start.y ? start.y - height : start.y,
      widthMm: width,
      heightMm: height,
    });
  }

  function finishDrawing() {
    drawStart.current = null;
    if (draft && draft.widthMm >= MIN_BOX_MM && draft.heightMm >= MIN_BOX_MM) {
      onDrawBox(draft);
    }
    setDraft(null);
    setDraftAtLimit(false);
  }

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted">
          Page {page.number} of {pageCount}
        </span>
        {scanInfo}
      </figcaption>
      <div
        className="on-paper relative shrink-0 rounded-lg ring-1 ring-line select-none"
        style={{ width: widthPx, height: heightPx }}
      >
        {pdf ? (
          <PdfPageSurface pdf={pdf} page={page} widthPx={widthPx} heightPx={heightPx} />
        ) : (
          page.image && (
            <ImagePageSurface
              page={page}
              url={cleanedUrl ?? page.image.url}
              widthPx={widthPx}
              heightPx={heightPx}
            />
          )
        )}
        {/* A cleaned PDF scan is the whole page as seen. */}
        {pdf && cleanedUrl && (
          <img
            src={cleanedUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 size-full rounded-lg bg-white"
          />
        )}

        {/* Where boxes are drawn: the whole page, under the boxes. */}
        <div
          data-testid={`draw-on-page-${page.number}`}
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={finishDrawing}
          onPointerCancel={finishDrawing}
        />

        {draft && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-accent"
            style={{
              left: draft.xMm * scale,
              top: draft.yMm * scale,
              width: draft.widthMm * scale,
              height: draft.heightMm * scale,
            }}
          >
            <SizeLabel
              text={formatSizeCm(draft.widthMm, draft.heightMm)}
              atLimit={draftAtLimit}
            />
          </div>
        )}

        {boxes.map((box) => {
          const max = maxBoxMm(box, sizeMm);
          const live = resizing?.id === box.id ? resizing : box;
          const selected = box.id === selectedBoxId;
          const atLimit =
            resizing?.id === box.id &&
            (live.widthMm >= box.limitWidthMm || live.heightMm >= box.limitHeightMm);
          return (
            <Rnd
              key={box.id}
              bounds="parent"
              position={{ x: box.xMm * scale, y: box.yMm * scale }}
              size={{ width: box.widthMm * scale, height: box.heightMm * scale }}
              dragGrid={[scale, scale]}
              resizeGrid={[scale, scale]}
              minWidth={MIN_BOX_MM * scale}
              minHeight={MIN_BOX_MM * scale}
              maxWidth={max.width * scale}
              maxHeight={max.height * scale}
              onMouseDown={() => onSelectBox(box.id)}
              onDragStop={(_event, data) =>
                onMoveBox(box.id, {
                  xMm: Math.round(data.x / scale),
                  yMm: Math.round(data.y / scale),
                  widthMm: box.widthMm,
                  heightMm: box.heightMm,
                })
              }
              onResize={(_event, _direction, ref, _delta, position) => {
                const now = {
                  xMm: Math.round(position.x / scale),
                  yMm: Math.round(position.y / scale),
                  widthMm: Math.round(parseFloat(ref.style.width) / scale),
                  heightMm: Math.round(parseFloat(ref.style.height) / scale),
                };
                setResizing({ id: box.id, ...now });
                if (now.widthMm >= box.limitWidthMm || now.heightMm >= box.limitHeightMm) {
                  onAtLimit(box.limitWidthMm, box.limitHeightMm);
                }
              }}
              onResizeStop={(_event, _direction, ref, _delta, position) => {
                setResizing(null);
                onMoveBox(box.id, {
                  xMm: Math.round(position.x / scale),
                  yMm: Math.round(position.y / scale),
                  widthMm: Math.round(parseFloat(ref.style.width) / scale),
                  heightMm: Math.round(parseFloat(ref.style.height) / scale),
                });
              }}
              resizeHandleStyles={resizeHandleStyles}
              // An outline, not a border: it sits just outside the box, so
              // the image inside is shown exactly where the PDF puts it.
              className={
                selected
                  ? "outline-2 outline-accent"
                  : "outline-2 outline-accent outline-dashed"
              }
            >
              <div
                className="relative h-full w-full cursor-move"
                data-testid={`box-${box.label}`}
              >
                {box.image && (
                  <BoxImagePreview box={{ ...box, ...live }} scale={scale} />
                )}
                <SizeLabel
                  text={`${box.label} · ${formatSizeCm(live.widthMm, live.heightMm)}`}
                  atLimit={atLimit}
                />
              </div>
            </Rnd>
          );
        })}
      </div>
    </figure>
  );
}

// Above a box: its size, and while it is held at its limit, that too,
// right where the pointer is (the full message is in the side panel).
function SizeLabel({ text, atLimit = false }: { text: string; atLimit?: boolean }) {
  return (
    <span className="pointer-events-none absolute -top-6 left-0 rounded bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap text-accent-fg">
      {atLimit ? `${text} · at its size limit` : text}
    </span>
  );
}

// The box's image exactly where the PDF puts it: the same fit, centred.
function BoxImagePreview({ box, scale }: { box: ImageBox; scale: number }) {
  if (!box.image) return null;
  const placed = fitInside(
    { x: 0, y: 0, width: box.widthMm, height: box.heightMm },
    box.image.pixelWidth,
    box.image.pixelHeight,
  );
  return (
    <img
      src={box.image.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{
        left: placed.x * scale,
        top: placed.y * scale,
        width: placed.width * scale,
        height: placed.height * scale,
      }}
    />
  );
}

function PdfPageSurface({
  pdf,
  page,
  widthPx,
  heightPx,
}: {
  pdf: PdfDocument;
  page: FormPage;
  widthPx: number;
  heightPx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const pdfPage = await pdf.getPage(page.number);
      // Drawn at the screen's own sharpness (up to 2 pixels per CSS pixel).
      const sharpness = Math.min(2, window.devicePixelRatio || 1);
      const viewport = pdfPage.getViewport({
        scale: (widthPx / page.widthPt) * sharpness,
      });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context || cancelled) return;
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      if (!cancelled) setDrawn(true);
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [pdf, page, widthPx]);

  return (
    <>
      {!drawn && <div aria-hidden="true" className="skeleton absolute inset-0" />}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 rounded-lg"
        style={{ width: widthPx, height: heightPx }}
      />
    </>
  );
}

// A form page made from an image: the whole image on a white A4 page,
// fitted and centred, as in the PDF.
function ImagePageSurface({
  page,
  url,
  widthPx,
  heightPx,
}: {
  page: FormPage;
  // The image's own, or its cleaned version (the same size).
  url: string;
  widthPx: number;
  heightPx: number;
}) {
  if (!page.image) return null;
  const placed = fitInside(
    { x: 0, y: 0, width: widthPx, height: heightPx },
    page.image.pixelWidth,
    page.image.pixelHeight,
  );
  return (
    <div className="absolute inset-0 overflow-hidden rounded-lg bg-white">
      <img
        src={url}
        alt=""
        draggable={false}
        className="absolute max-w-none"
        style={{
          left: placed.x,
          top: placed.y,
          width: placed.width,
          height: placed.height,
        }}
      />
    </div>
  );
}
