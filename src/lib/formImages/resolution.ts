// How sharp an image will print: its resolution (dots per inch) at the
// size it is placed, and the size it should have to print at 300 dpi.

export const TARGET_DPI = 300;
// "Under about 300 dpi": an image a little under 300 prints as well as one
// at 300, so only images clearly under it are sharpened.
export const SHARPEN_BELOW_DPI = 280;
// The model makes an image four times as large; it is never enlarged more.
export const MAX_ENLARGEMENT = 4;

const MM_PER_INCH = 25.4;

// The resolution of an image `pixelWidth` pixels wide printed
// `printedWidthMm` wide.
export function dpiAt(pixelWidth: number, printedWidthMm: number): number {
  return pixelWidth / (printedWidthMm / MM_PER_INCH);
}

export function needsSharpening(pixelWidth: number, printedWidthMm: number): boolean {
  return dpiAt(pixelWidth, printedWidthMm) < SHARPEN_BELOW_DPI;
}

// The pixel size a sharpened image is embedded at: 300 dpi at its printed
// size, never more than four times the original, keeping its proportions.
export function sharpenedSize(
  pixelWidth: number,
  pixelHeight: number,
  printedWidthMm: number,
): { width: number; height: number } {
  const wanted = Math.round((printedWidthMm / MM_PER_INCH) * TARGET_DPI);
  const width = Math.min(wanted, pixelWidth * MAX_ENLARGEMENT);
  return {
    width,
    height: Math.max(1, Math.round((pixelHeight * width) / pixelWidth)),
  };
}
