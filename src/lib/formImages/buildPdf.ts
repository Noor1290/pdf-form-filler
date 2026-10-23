// Builds the one PDF the "Form & images" tool downloads: the form's pages,
// the image in each box, then one A4 page per full-page image.
//
// Images are embedded at full resolution: a JPEG's original bytes go in
// unchanged, a PNG is stored losslessly. A phone photo that is stored
// sideways (EXIF orientation) is turned by where it is drawn, never by
// re-encoding it.
import {
  PDFDocument,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  A4_PORTRAIT_MM,
  a4PageForImage,
  fitInside,
  fullPageImageMm,
  mmToPoints,
  placedImageMm,
  type Rect,
} from "@/lib/formImages/measure";
import type { SharpenedImage } from "@/lib/formImages/sharpen";
import type { ImageBox, LoadedForm, LoadedImage } from "@/types/formImages";

export type CompletedPdfInput = {
  form: LoadedForm;
  boxes: ImageBox[];
  fullPageImages: LoadedImage[];
  marginMm: number;
  // Images sharpened for this PDF, by image id: a PNG at 300 dpi for the
  // size it is printed, already turned upright. It is placed exactly where
  // the original would be.
  sharpened?: Map<string, SharpenedImage>;
  // Scanned pages cleaned for this PDF, by page number: a PNG of the whole
  // page as it is seen, which takes the place of the scan.
  cleanedPages?: Map<number, Uint8Array>;
};

// An affine transform [a b c d e f]: (x, y) → (a·x + c·y + e, b·x + d·y + f),
// the same form as the PDF "cm" operator.
type Matrix = [number, number, number, number, number, number];

// `first`, then `second`.
function then(first: Matrix, second: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

// A PDF image fills the unit square as it is stored. This turns that
// square so the picture shows the way up its EXIF orientation says.
const ORIENTATION: Record<number, Matrix> = {
  1: [1, 0, 0, 1, 0, 0],
  2: [-1, 0, 0, 1, 1, 0],
  3: [-1, 0, 0, -1, 1, 1],
  4: [1, 0, 0, -1, 0, 1],
  5: [0, -1, -1, 0, 1, 1],
  6: [0, -1, 1, 0, 0, 1],
  7: [0, 1, 1, 0, 0, 0],
  8: [0, 1, -1, 0, 1, 0],
};

// From the page as seen (origin bottom-left, y up) to the page's own
// content space, which differs when the page is saved turned (/Rotate)
// or its visible area does not start at 0,0. Same turns as
// visualPointToContentSpace in lib/pdf.ts.
function seenToContent(page: PDFPage): {
  matrix: Matrix;
  seenHeight: number;
} {
  const box = page.getCropBox();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  const turn: Record<number, Matrix> = {
    0: [1, 0, 0, 1, 0, 0],
    90: [0, 1, -1, 0, box.width, 0],
    180: [-1, 0, 0, -1, box.width, box.height],
    270: [0, -1, 1, 0, 0, box.height],
  };
  const shift: Matrix = [1, 0, 0, 1, box.x, box.y];
  return {
    matrix: then(turn[angle] ?? turn[0], shift),
    seenHeight: angle === 90 || angle === 270 ? box.width : box.height,
  };
}

// Draws `image` filling `rect` exactly (points from the top-left of the
// page as seen). `rect` already has the image's proportions.
function drawImageInRect(
  page: PDFPage,
  embedded: PDFImage,
  orientation: number,
  rect: Rect,
): void {
  const { matrix: toContent, seenHeight } = seenToContent(page);
  const placeOnPage: Matrix = [
    rect.width,
    0,
    0,
    rect.height,
    rect.x,
    seenHeight - rect.y - rect.height,
  ];
  const [a, b, c, d, e, f] = then(
    then(ORIENTATION[orientation] ?? ORIENTATION[1], placeOnPage),
    toContent,
  );
  const name = page.node.newXObject("Image", embedded.ref);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(a, b, c, d, e, f),
    drawObject(name),
    popGraphicsState(),
  );
}

const mmRectToPoints = (rect: Rect): Rect => ({
  x: mmToPoints(rect.x),
  y: mmToPoints(rect.y),
  width: mmToPoints(rect.width),
  height: mmToPoints(rect.height),
});

export async function buildCompletedPdf({
  form,
  boxes,
  fullPageImages,
  marginMm,
  sharpened = new Map(),
  cleanedPages = new Map(),
}: CompletedPdfInput): Promise<Uint8Array> {
  const output = await PDFDocument.create();

  // One embedded copy per image, however often it is used.
  const embedded = new Map<string, PDFImage>();
  async function embed(image: LoadedImage): Promise<PDFImage> {
    const known = embedded.get(image.id);
    if (known) return known;
    const sharp = sharpened.get(image.id);
    const made = sharp
      ? await output.embedPng(sharp.bytes)
      : image.format === "jpeg"
        ? await output.embedJpg(image.bytes)
        : await output.embedPng(image.bytes);
    embedded.set(image.id, made);
    return made;
  }

  // 1. The form's pages.
  if (form.kind === "pdf" && form.pdfBytes) {
    // As in exportFilledPdf: a PDF with owner restrictions (but no open
    // password) is only read here, never changed in that respect.
    const source = await PDFDocument.load(form.pdfBytes, {
      ignoreEncryption: true,
    });
    // Pages copied as they are, except cleaned scans: a new page of the
    // same size (as seen) with the cleaned picture filling it.
    const kept = source.getPageIndices().filter((index) => !cleanedPages.has(index + 1));
    const copied = await output.copyPages(source, kept);
    for (const formPage of form.pages) {
      const cleaned = cleanedPages.get(formPage.number);
      if (!cleaned) {
        output.addPage(copied.shift());
        continue;
      }
      const page = output.addPage([formPage.widthPt, formPage.heightPt]);
      const { width, height } = page.getSize();
      drawImageInRect(page, await output.embedPng(cleaned), 1, { x: 0, y: 0, width, height });
    }
  } else {
    for (const formPage of form.pages) {
      const image = formPage.image;
      if (!image) continue;
      const { widthPt, heightPt } = a4PageForImage(
        image.pixelWidth,
        image.pixelHeight,
      );
      const page = output.addPage([widthPt, heightPt]);
      const rect = fitInside(
        { x: 0, y: 0, width: widthPt, height: heightPt },
        image.pixelWidth,
        image.pixelHeight,
      );
      // A cleaned scan is the image as seen (already upright), cleaned.
      const cleaned = cleanedPages.get(formPage.number);
      if (cleaned) drawImageInRect(page, await output.embedPng(cleaned), 1, rect);
      else drawImageInRect(page, await embed(image), image.orientation, rect);
    }
  }

  // A sharpened image is already upright.
  const orientationOf = (image: LoadedImage) =>
    sharpened.has(image.id) ? 1 : image.orientation;

  // 2. The image in each box. A box without an image adds nothing.
  for (const box of boxes) {
    const placed = placedImageMm(box);
    if (!box.image || !placed) continue;
    const page = output.getPage(box.page - 1);
    drawImageInRect(
      page,
      await embed(box.image),
      orientationOf(box.image),
      mmRectToPoints(placed),
    );
  }

  // 3. One portrait A4 page per full-page image, filled with the colour of
  // the image's own edges.
  for (const image of fullPageImages) {
    const width = mmToPoints(A4_PORTRAIT_MM.width);
    const height = mmToPoints(A4_PORTRAIT_MM.height);
    const page = output.addPage([width, height]);
    const [r, g, b] = sharpened.get(image.id)?.edgeColor ?? image.edgeColor;
    page.drawRectangle({
      x: 0,
      y: 0,
      width,
      height,
      color: rgb(r / 255, g / 255, b / 255),
    });
    const rect = fullPageImageMm(image.pixelWidth, image.pixelHeight, marginMm);
    drawImageInRect(page, await embed(image), orientationOf(image), mmRectToPoints(rect));
  }

  return output.save();
}
