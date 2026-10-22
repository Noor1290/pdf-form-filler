// Fake forms and fake images for the "Form & images" tests. Everything is
// made here, from nothing: no real form, logo or photo is ever used.
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";

export const A4 = [595.2756, 841.8898];
export const LETTER = [612, 792];

// A form with one page per entry of `pages` ({ size, rotate }), each
// saying which page it is, so the download can be checked page by page.
export async function buildFakeForm(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, { size = A4, rotate = 0 }] of pages.entries()) {
    const page = doc.addPage(size);
    page.setRotation(degrees(rotate));
    page.drawText(`FAKE FORM page ${index + 1}`, { x: 60, y: size[1] - 80, size: 14, font });
    page.drawRectangle({ x: 60, y: 200, width: 200, height: 120, borderWidth: 1 });
  }
  return Buffer.from(await doc.save());
}

// An image drawn in the test browser: `edge` all round, a block of
// `middle` in the centre half. JPEG or PNG, as the browser encodes them.
export async function makeImage(
  page,
  { width, height, edge = "#1b2a4a", middle = "#f0c419", type = "png", quality = 0.92 },
) {
  const base64 = await page.evaluate(
    async ({ width, height, edge, middle, type, quality }) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = edge;
      context.fillRect(0, 0, width, height);
      context.fillStyle = middle;
      context.fillRect(width / 4, height / 4, width / 2, height / 2);
      const blob = await canvas.convertToBlob({ type: `image/${type}`, quality });
      let binary = "";
      for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height, edge, middle, type, quality },
  );
  return Buffer.from(base64, "base64");
}

// The same JPEG with a phone's "which way is up" note (EXIF orientation)
// put in straight after the start marker. The picture data is untouched.
export function withExifOrientation(jpeg, orientation) {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF, first directory at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, count 1
    0x00, orientation, 0x00, 0x00, // the value
    0x00, 0x00, 0x00, 0x00, // no next directory
  ]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

export function file(name, buffer) {
  const mimeType = name.endsWith(".pdf")
    ? "application/pdf"
    : name.endsWith(".png")
      ? "image/png"
      : "image/jpeg";
  return { name, mimeType, buffer };
}
