// Measurements of the "Form & images" tool. Boxes are kept in whole
// millimetres; the PDF is drawn in points. Everything shown on screen and
// everything drawn in the PDF goes through these functions, so the two
// always agree.
import type { ImageBox } from "@/types/formImages";

export const POINTS_PER_MM = 72 / 25.4;

export const A4_PORTRAIT_MM = { width: 210, height: 297 };

export const DEFAULT_LIMIT_MM = 80;
export const DEFAULT_MARGIN_MM = 10;
// A box smaller than this is a stray click, not a box.
export const MIN_BOX_MM = 5;

export type Rect = { x: number; y: number; width: number; height: number };

export function mmToPoints(mm: number): number {
  return mm * POINTS_PER_MM;
}

export function pointsToMm(points: number): number {
  return points / POINTS_PER_MM;
}

// "7.8" for 78 mm. Always one decimal, as the owner asked.
export function formatCm(mm: number): string {
  return (mm / 10).toFixed(1);
}

export function formatSizeCm(widthMm: number, heightMm: number): string {
  return `${formatCm(widthMm)} × ${formatCm(heightMm)} cm`;
}

// What a person typed in cm ("7.8", "7,8", " 10 "), as whole millimetres,
// or null when it is not a size.
export function parseCmToMm(typed: string): number | null {
  const value = Number(typed.trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10);
}

// The largest rectangle with the image's proportions that fits inside
// `frame`, centred in it. Used for boxes, form pages made from images and
// full-page images alike.
export function fitInside(
  frame: Rect,
  imageWidth: number,
  imageHeight: number,
): Rect {
  const scale = Math.min(frame.width / imageWidth, frame.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: frame.x + (frame.width - width) / 2,
    y: frame.y + (frame.height - height) / 2,
    width,
    height,
  };
}

// Where a box's image lands, in millimetres from the page's top-left.
export function placedImageMm(box: ImageBox): Rect | null {
  if (!box.image) return null;
  return fitInside(
    { x: box.xMm, y: box.yMm, width: box.widthMm, height: box.heightMm },
    box.image.pixelWidth,
    box.image.pixelHeight,
  );
}

// A form page made from an image is A4, turned to landscape for a
// landscape image (the owner's choice), in points.
export function a4PageForImage(
  pixelWidth: number,
  pixelHeight: number,
): { widthPt: number; heightPt: number } {
  const { width, height } = A4_PORTRAIT_MM;
  const landscape = pixelWidth > pixelHeight;
  return {
    widthPt: mmToPoints(landscape ? height : width),
    heightPt: mmToPoints(landscape ? width : height),
  };
}

// Pages are shown at a fixed scale (so a box looks the same size on every
// page), narrowed only for pages wider than the field editor's 800px.
const PIXELS_PER_MM = 3.6;
const MAX_PAGE_PIXELS = 800;

export function pixelsPerMmFor(pageWidthMm: number): number {
  return Math.min(PIXELS_PER_MM, MAX_PAGE_PIXELS / pageWidthMm);
}

// The page's size in whole millimetres a box may use (never past an edge).
export function pageMm(page: { widthPt: number; heightPt: number }): {
  width: number;
  height: number;
} {
  // A tiny tolerance, so a 210 mm page given as 595.2756 points is 210 mm.
  return {
    width: Math.floor(pointsToMm(page.widthPt) + 1e-6),
    height: Math.floor(pointsToMm(page.heightPt) + 1e-6),
  };
}

// How large a box may be on this page: its limit, and never past the page.
export function maxBoxMm(
  box: Pick<ImageBox, "limitWidthMm" | "limitHeightMm">,
  page: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: Math.min(box.limitWidthMm, page.width),
    height: Math.min(box.limitHeightMm, page.height),
  };
}

// A box brought within its limit and onto its page: first its size, then
// its position, so a box made smaller keeps its top-left corner and a box
// made larger near an edge moves back onto the page.
export function keepBoxInBounds(
  box: ImageBox,
  page: { width: number; height: number },
): ImageBox {
  const max = maxBoxMm(box, page);
  const widthMm = Math.max(MIN_BOX_MM, Math.min(box.widthMm, max.width));
  const heightMm = Math.max(MIN_BOX_MM, Math.min(box.heightMm, max.height));
  const xMm = Math.max(0, Math.min(box.xMm, page.width - widthMm));
  const yMm = Math.max(0, Math.min(box.yMm, page.height - heightMm));
  return { ...box, xMm, yMm, widthMm, heightMm };
}

// Whether `widthMm` × `heightMm` is more than the box's limit allows.
export function overLimit(
  box: Pick<ImageBox, "limitWidthMm" | "limitHeightMm">,
  widthMm: number,
  heightMm: number,
): boolean {
  return widthMm > box.limitWidthMm || heightMm > box.limitHeightMm;
}

// Where a full-page image lands on its own A4 page, in millimetres: as
// large as it can be inside the margin, proportions kept, centred.
export function fullPageImageMm(
  pixelWidth: number,
  pixelHeight: number,
  marginMm: number,
): Rect {
  const { width, height } = A4_PORTRAIT_MM;
  return fitInside(
    {
      x: marginMm,
      y: marginMm,
      width: width - 2 * marginMm,
      height: height - 2 * marginMm,
    },
    pixelWidth,
    pixelHeight,
  );
}

// The download's suggested name: the form's name with "_completed".
export function completedFileName(formFileName: string): string {
  const base = formFileName.replace(/\.(pdf|jpe?g|png)$/i, "");
  return `${base}_completed.pdf`;
}
