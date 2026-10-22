// Reads where each image is drawn in a PDF, and with what fill colour each
// page is painted, the way a PDF viewer does: by following the page's own
// drawing instructions (pdf.js), never by trusting what the app meant to
// draw. Positions are in millimetres from the top-left of the page as it
// is seen (a page saved turned is measured turned), so they compare
// directly with what the screen says in cm.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

const MM_PER_POINT = 25.4 / 72;

function multiply([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  // `[a1..f1]` applied after `[a2..f2]`, as the PDF "cm" operator does.
  return [
    a2 * a1 + b2 * c1,
    a2 * b1 + b2 * d1,
    c2 * a1 + d2 * c1,
    c2 * b1 + d2 * d1,
    e2 * a1 + f2 * c1 + e1,
    e2 * b1 + f2 * d1 + f1,
  ];
}

const apply = ([a, b, c, d, e, f], [x, y]) => [a * x + c * y + e, b * x + d * y + f];

export async function readPdfImages(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const { fnArray, argsArray } = await page.getOperatorList();

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    const images = [];
    const fills = [];
    for (let i = 0; i < fnArray.length; i++) {
      const op = fnArray[i];
      const args = argsArray[i];
      if (op === pdfjs.OPS.save) stack.push(ctm);
      else if (op === pdfjs.OPS.restore) ctm = stack.pop() ?? ctm;
      else if (op === pdfjs.OPS.transform) ctm = multiply(ctm, args);
      else if (op === pdfjs.OPS.setFillRGBColor) fills.push(colourOf(args));
      else if (op === pdfjs.OPS.paintImageXObject) {
        // The unit square, through the drawing transform, then onto the
        // page as seen.
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map((corner) =>
          viewport.convertToViewportPoint(...apply(ctm, corner)),
        );
        const xs = corners.map(([x]) => x);
        const ys = corners.map(([, y]) => y);
        // Where the image's own top-left pixel lands, to tell which way up
        // it is drawn.
        const [topLeftX, topLeftY] = viewport.convertToViewportPoint(...apply(ctm, [0, 1]));
        images.push({
          edgeColour: edgeColourOf(await new Promise((resolve) => page.objs.get(args[0], resolve))),
          x: Math.min(...xs) * MM_PER_POINT,
          y: Math.min(...ys) * MM_PER_POINT,
          width: (Math.max(...xs) - Math.min(...xs)) * MM_PER_POINT,
          height: (Math.max(...ys) - Math.min(...ys)) * MM_PER_POINT,
          pixelWidth: args[1],
          pixelHeight: args[2],
          topLeftPixelAt: [topLeftX * MM_PER_POINT, topLeftY * MM_PER_POINT],
        });
      }
    }
    pages.push({
      page: number,
      widthMm: viewport.width * MM_PER_POINT,
      heightMm: viewport.height * MM_PER_POINT,
      images,
      fills,
    });
  }
  await doc.loadingTask.destroy();
  return pages;
}

// The middle value of red, green and blue over a band 1% wide all round
// the image's own pixels, as the PDF holds them (pdf.js decodes them).
function edgeColourOf(decoded) {
  const { width, height, data, kind } = decoded ?? {};
  const channels = kind === 3 ? 4 : kind === 2 ? 3 : 0;
  if (!channels || !data) return null;
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.01));
  const values = [[], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && y >= band && x < width - band && y < height - band) continue;
      const at = (y * width + x) * channels;
      for (let c = 0; c < 3; c++) values[c].push(data[at + c]);
    }
  }
  return values.map((list) => list.sort((a, b) => a - b)[Math.floor(list.length / 2)]);
}

// pdf.js gives a fill colour as "#rrggbb" or as three numbers.
function colourOf(args) {
  if (typeof args[0] === "string") {
    const hex = args[0].replace("#", "");
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  if (args.length >= 3) return args.slice(0, 3).map((v) => Math.round(v <= 1 ? v * 255 : v));
  return args;
}

// Every image stored in the PDF, as it is stored: its filter (DCTDecode is
// a JPEG kept as it was), its size in pixels, and its raw bytes.
export async function readStoredImages(bytes) {
  const doc = await PDFDocument.load(bytes);
  const images = [...doc.context.enumerateIndirectObjects()].filter(
    ([, object]) =>
      object instanceof PDFRawStream &&
      object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
  );
  // A PNG's transparency is stored as a second, grey image (its SMask).
  const masks = new Set(
    images
      .map(([, object]) => object.dict.get(PDFName.of("SMask"))?.toString())
      .filter(Boolean),
  );
  return images.map(([ref, object]) => ({
    filter: object.dict.get(PDFName.of("Filter"))?.toString(),
    width: object.dict.get(PDFName.of("Width"))?.asNumber(),
    height: object.dict.get(PDFName.of("Height"))?.asNumber(),
    isTransparencyMask: masks.has(ref.toString()),
    bytes: Buffer.from(object.contents),
  }));
}
