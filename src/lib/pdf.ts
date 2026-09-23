import {
  degrees,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { FieldBox } from "@/types/template";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PdfDocument = pdfjsLib.PDFDocumentProxy;

// The browser's reported file.type is unreliable (it depends on OS file
// association, which can be missing or wrong on Windows), so we check the
// actual "%PDF-" signature instead of trusting the MIME type.
export async function isPdfFile(file: File): Promise<boolean> {
  const header = await file.slice(0, 5).text();
  return header === "%PDF-";
}

export async function loadPdfDocument(
  source: File | Uint8Array,
): Promise<PdfDocument> {
  // pdf.js transfers (detaches) the underlying buffer to its worker, so a
  // caller-held Uint8Array (e.g. one cached via useMemo) must be cloned —
  // otherwise a second load of the same source hits a detached buffer.
  const data =
    source instanceof File ? await source.arrayBuffer() : source.slice();
  return pdfjsLib.getDocument({ data }).promise;
}

// Templates store the PDF as base64 in localStorage (see CLAUDE.md — no
// backend in v1), so we need to convert both ways when saving/reopening.
export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Page size in PDF points (i.e. at scale 1), used to convert between
// on-screen box pixel coordinates and the page's own coordinate space.
export async function getPageSize(
  pdf: PdfDocument,
  pageNumber: number,
): Promise<{ width: number; height: number }> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

// Renders a page at a given CSS-pixel width, scaling to fit rather than
// hardcoding a zoom factor, so different page sizes look reasonable.
export async function renderPdfPageToCanvas(
  pdf: PdfDocument,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  targetWidth: number,
): Promise<void> {
  const page = await pdf.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context not available");

  await page.render({ canvas, canvasContext: context, viewport }).promise;
}

// Only these three families (+ bold) are allowed — see the CLAUDE.md hard
// rule against custom font embedding in v1.
const STANDARD_FONTS: Record<
  FieldBox["fontFamily"],
  { regular: StandardFonts; bold: StandardFonts }
> = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
  },
  "Times-Roman": {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
  },
  Courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
};

function hexToRgbColor(hex: string) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

// Draws one entry's values onto a single (already-copied) page, matching
// each box's position/font/alignment — shared by every page produced by
// exportFilledPdf below.
async function drawValuesOnPage(
  page: PDFPage,
  boxes: FieldBox[],
  values: Record<string, string>,
  getFont: (box: FieldBox) => Promise<PDFFont>,
): Promise<void> {
  for (const box of boxes) {
    const value = values[box.id];
    if (!value) continue;

    const font = await getFont(box);
    const textWidth = font.widthOfTextAtSize(value, box.fontSize);

    // Anchor point in VISUAL space first (top-left origin, y-down — same
    // convention box.x/box.y are stored in; see BoxEditor).
    const visualX =
      box.align === "left"
        ? box.x
        : box.align === "center"
          ? box.x + box.width / 2 - textWidth / 2
          : box.x + box.width - textWidth;
    // ~1/3 of the font size approximates a font's cap-height-to-baseline
    // offset, so the text lands visually centered like the live preview's
    // canvas middle-baseline rendering.
    const visualY = box.y + box.height / 2 + box.fontSize * 0.32;

    const { x, y } = visualPointToContentSpace(page, visualX, visualY);

    page.drawText(value, {
      x,
      y,
      size: box.fontSize,
      font,
      color: hexToRgbColor(box.color),
      // Pages can carry a /Rotate value (e.g. a landscape form saved as a
      // rotated portrait page) — pdf-lib always draws against the page's
      // raw, unrotated content space, so the glyphs must be counter-rotated
      // here to appear upright once a viewer applies that page rotation.
      rotate: degrees(page.getRotation().angle),
    });
  }
}

// Bakes one filled set of values per entry into the original PDF, matching
// each box's position/font/alignment — used by the "Download PDF" action.
// Each entry becomes its own copy of the source PDF's page(s), appended in
// order, so filling in several people produces one multi-page PDF rather
// than one download per person. A single entry behaves exactly like the
// original single-person export (same page count, nothing extra).
export async function exportFilledPdf(
  pdfData: string,
  boxes: FieldBox[],
  entriesValues: Record<string, string>[],
): Promise<Uint8Array> {
  // Some source PDFs carry owner-level restrictions (no open password, but
  // pdf-lib refuses to load them by default) — safe to ignore here since we
  // only read pages and draw text, never touch the restrictions themselves.
  const sourceDoc = await PDFDocument.load(base64ToBytes(pdfData), {
    ignoreEncryption: true,
  });
  const outputDoc = await PDFDocument.create();
  const fontCache = new Map<string, PDFFont>();

  async function getFont(box: FieldBox): Promise<PDFFont> {
    const variant = box.bold ? "bold" : "regular";
    const key = `${box.fontFamily}-${variant}`;
    const cached = fontCache.get(key);
    if (cached) return cached;
    // Fonts are embedded into whichever document draws with them — that's
    // the shared output doc here, not the source, so one embed covers every
    // entry's pages.
    const font = await outputDoc.embedFont(
      STANDARD_FONTS[box.fontFamily][variant],
    );
    fontCache.set(key, font);
    return font;
  }

  const sourcePageIndices = sourceDoc.getPageIndices();
  const boxesByPage = new Map<number, FieldBox[]>();
  for (const box of boxes) {
    const existing = boxesByPage.get(box.page);
    if (existing) existing.push(box);
    else boxesByPage.set(box.page, [box]);
  }

  for (const entryValues of entriesValues) {
    const copiedPages = await outputDoc.copyPages(
      sourceDoc,
      sourcePageIndices,
    );

    for (const [pageIndex, page] of copiedPages.entries()) {
      outputDoc.addPage(page);
      const pageBoxes = boxesByPage.get(pageIndex + 1);
      if (!pageBoxes) continue;
      await drawValuesOnPage(page, pageBoxes, entryValues, getFont);
    }
  }

  return outputDoc.save();
}

// Converts a point from the page's VISUAL coordinate space (top-left
// origin, y-down — what pdf.js shows on screen, and what box.x/box.y are
// stored in) into the page's raw content-space coordinates pdf-lib draws
// against. The two only differ when the page has a /Rotate value.
function visualPointToContentSpace(
  page: PDFPage,
  visualX: number,
  visualY: number,
): { x: number; y: number } {
  const { width: rawWidth, height: rawHeight } = page.getSize();
  const rotation = page.getRotation().angle;
  const visualHeight =
    rotation === 90 || rotation === 270 ? rawWidth : rawHeight;

  // Flip from top-left/y-down into the page's own bottom-left/y-up space.
  const vx = visualX;
  const vy = visualHeight - visualY;

  switch (rotation) {
    case 90:
      return { x: rawWidth - vy, y: vx };
    case 180:
      return { x: rawWidth - vx, y: rawHeight - vy };
    case 270:
      return { x: vy, y: rawHeight - vx };
    default:
      return { x: vx, y: vy };
  }
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
