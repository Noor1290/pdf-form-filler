// Types of the "Form & images" tool. Nothing here is ever stored: the form
// and the images live in the browser's memory while the screen is open.

// An image the user chose (JPG or PNG), with its original bytes kept so it
// can be embedded unchanged.
export type LoadedImage = {
  id: string;
  name: string;
  bytes: Uint8Array;
  format: "jpeg" | "png";
  // Size as the image is meant to be seen, after the phone's "which way is
  // up" note (EXIF orientation) is applied.
  pixelWidth: number;
  pixelHeight: number;
  // The EXIF orientation (1 to 8; 1 = stored upright). The bytes are never
  // turned: the PDF turns the picture where it is drawn.
  orientation: number;
  // For showing it on screen (an object URL).
  url: string;
  // The colour of the image's own edges, as 0-255 red, green, blue: what
  // fills the rest of a full-page image's page.
  edgeColor: [number, number, number];
};

// One page of the form, as seen on screen (a rotated PDF page is given
// with its turned size). Sizes are in PDF points (1/72 inch).
export type FormPage = {
  number: number;
  widthPt: number;
  heightPt: number;
  // Only for a form made from images: the picture filling this page.
  image?: LoadedImage;
  // Whether the page is a scan, which is cleaned: every page made from an
  // image, and a PDF page that is one picture with no visible text.
  scan: boolean;
  // For a PDF page that is a scan: how many pixels per point to draw it
  // at to keep the scan's own resolution.
  scanScale?: number;
};

export type LoadedForm = {
  kind: "pdf" | "images";
  // The first file's name, for the download's name.
  fileName: string;
  // The PDF's bytes, for a form that is a PDF.
  pdfBytes?: Uint8Array;
  pages: FormPage[];
};

// A box drawn on a page, holding one image. Everything is in whole
// millimetres from the page's top-left corner, so what the screen says in
// cm is exactly what the PDF has.
export type ImageBox = {
  id: string;
  // "Box 1", "Box 2"… in the order they were drawn.
  label: string;
  page: number;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  limitWidthMm: number;
  limitHeightMm: number;
  image: LoadedImage | null;
};
