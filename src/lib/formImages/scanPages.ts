// Scanned pages: telling a scan from a real text page, and cleaning a
// scan (in a worker, see cleanScan.ts) into a lossless PNG for the PDF.
import { OPS, type PDFPageProxy } from "pdfjs-dist";
import type { CleanReport } from "@/lib/formImages/cleanScan";
import type { PdfDocument } from "@/lib/pdf";
import type { FormPage } from "@/types/formImages";

// A scan is cleaned at its own resolution, but never larger than this
// many pixels on its long side (A4 at 400 dpi is 4677).
const MAX_LONG_SIDE = 4700;

type Matrix = number[];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

const SHOWS_TEXT = new Set<number>([
  OPS.showText,
  OPS.showSpacedText,
  OPS.nextLineShowText,
  OPS.nextLineSetSpacingShowText,
]);

// For a PDF page that is a scan, how many pixels per point to draw it at
// to keep the scan's resolution; null for a page that is not a scan.
//
// A scan is one picture covering most of the page (85% or more) and no
// visible text. Invisible text (the searchable layer some scanning apps
// add, text drawn in "invisible" mode 3 or 7) does not count.
export async function scanScaleOf(page: PDFPageProxy): Promise<number | null> {
  const { fnArray, argsArray } = await page.getOperatorList();
  const [x0, y0, x1, y1] = page.view;
  const pageArea = (x1 - x0) * (y1 - y0);

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let textMode = 0;
  const saved: { ctm: Matrix; textMode: number }[] = [];
  let visibleText = false;
  let best = { coverage: 0, scale: 1 };

  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i];
    const args = argsArray[i];
    if (op === OPS.save) saved.push({ ctm, textMode });
    else if (op === OPS.restore) ({ ctm, textMode } = saved.pop() ?? { ctm, textMode });
    else if (op === OPS.transform) ctm = multiply(ctm, args);
    else if (op === OPS.paintFormXObjectBegin) {
      saved.push({ ctm, textMode });
      if (Array.isArray(args[0])) ctm = multiply(ctm, args[0]);
    } else if (op === OPS.paintFormXObjectEnd) ({ ctm, textMode } = saved.pop() ?? { ctm, textMode });
    else if (op === OPS.setTextRenderingMode) textMode = args[0];
    else if (SHOWS_TEXT.has(op)) {
      if (textMode !== 3 && textMode !== 7) visibleText = true;
    } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      const pixelWidth = op === OPS.paintImageXObject ? args[1] : args[0]?.width;
      const area = Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
      const drawnWidth = Math.hypot(ctm[0], ctm[1]);
      const coverage = area / pageArea;
      if (coverage > best.coverage && pixelWidth && drawnWidth) {
        best = { coverage, scale: pixelWidth / drawnWidth };
      }
    }
  }
  if (visibleText || best.coverage < 0.85) return null;
  const longSide = Math.max(x1 - x0, y1 - y0);
  return Math.max(1, Math.min(best.scale, MAX_LONG_SIDE / longSide));
}

// ------------------------------------------------------------ cleaning

export type CleanedPage = {
  png: Uint8Array;
  width: number;
  height: number;
  report: CleanReport;
  // For the before/after view.
  beforeUrl: string;
  afterUrl: string;
};

function canvasOfSize(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function blobOf(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(type))), type, quality),
  );
}

// The page's pixels as scanned, the way up it is seen.
async function scannedPixels(
  page: FormPage,
  pdf: PdfDocument | null,
): Promise<{ canvas: HTMLCanvasElement; beforeUrl: string }> {
  if (page.image) {
    const blob = new Blob([page.image.bytes as BlobPart], { type: `image/${page.image.format}` });
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const canvas = canvasOfSize(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return { canvas, beforeUrl: page.image.url };
  }
  if (!pdf || !page.scanScale) throw new Error("not a scan");
  const pdfPage = await pdf.getPage(page.number);
  const viewport = pdfPage.getViewport({ scale: page.scanScale });
  const canvas = canvasOfSize(Math.round(viewport.width), Math.round(viewport.height));
  const context = canvas.getContext("2d")!;
  // White underneath, as paper.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
  // Only shown on screen, never put in the PDF: a JPEG is enough.
  const before = await blobOf(canvas, "image/jpeg", 0.92);
  return { canvas, beforeUrl: URL.createObjectURL(before) };
}

function cleanInWorker(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<{ pixels: Uint8ClampedArray; report: CleanReport }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cleanScan.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (problem) => {
      worker.terminate();
      reject(problem);
    };
    worker.postMessage({ pixels, width, height }, [pixels.buffer]);
  });
}

export async function cleanFormPage(page: FormPage, pdf: PdfDocument | null): Promise<CleanedPage> {
  const { canvas, beforeUrl } = await scannedPixels(page, pdf);
  const { width, height } = canvas;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const before = context.getImageData(0, 0, width, height);
  const { pixels, report } = await cleanInWorker(before.data, width, height);
  context.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  const blob = await blobOf(canvas, "image/png");
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width,
    height,
    report,
    beforeUrl,
    afterUrl: URL.createObjectURL(blob),
  };
}

// Lets go of the page's previews (the "before" of an image page is the
// image's own, which stays).
export function forgetCleanedPage(page: FormPage, cleaned: CleanedPage): void {
  URL.revokeObjectURL(cleaned.afterUrl);
  if (!page.image) URL.revokeObjectURL(cleaned.beforeUrl);
}
