// How light and how coloured a scanned pixel is, shared by the cleaning
// steps (cleanScan.ts, whitenPaper.ts, scanFooter.ts).

export const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

export const saturation = (r: number, g: number, b: number) =>
  Math.max(r, g, b) - Math.min(r, g, b);

export const lightAt = (data: Uint8ClampedArray, i: number) =>
  luminance(data[i], data[i + 1], data[i + 2]);

export const colourAt = (data: Uint8ClampedArray, i: number) =>
  saturation(data[i], data[i + 1], data[i + 2]);
