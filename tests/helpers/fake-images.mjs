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

// A fake scanned form, A4 at 150 dpi (1240 × 1754), drawn in the test
// browser and saved as a JPEG, as a phone scanning app would: yellowed,
// unevenly lit paper; a title, form lines and filled boxes; a red stamp, a
// pale blue stamp, a signature and an emblem; a footer "Page 1." whose full
// stop sits near the edge but next to text; and what cleaning should
// remove: isolated specks near the edges and a scanner's shadow down the
// left edge. Returns the JPEG and where each thing is, in pixels.
//
// With `extras`: a lightly shaded header band (the form's own, to keep), a
// form frame with a speck just outside it in the margin, a short stray
// line in the top-left margin and a thin line just inside the right edge
// (to remove). With `footer`, at the bottom left instead of the shadow:
//   "camscanner"  CamScanner's "Scanned with CamScanner" footer, drawn in
//                 its style (a grey "CS" badge and grey words), to remove;
//   "lookalike"   the same badge with other grey words, to keep;
//   "black"       the CamScanner words and badge in black ink, to keep.
export async function makeFakeScan(page, { extras = false, footer = null } = {}) {
  const where = {
    paper: [[600, 250], [300, 1000], [1000, 1400], [620, 1650]],
    // On each stamp's ring.
    redStamp: [[1000, 1290], [930, 1220], [860, 1290]],
    paleStamp: [[396, 1340], [340, 1284], [284, 1340]],
    specks: [[700, 30], [1200, 900], [500, 1720]],
    shadow: footer ? [] : [[6, 300], [6, 900], [6, 1500]],
    footerStop: [[1124, 1712]],
    // Inside the shaded band, away from its words.
    shading: extras ? [[700, 1130], [900, 1150], [1050, 1160]] : [],
    marginSpeck: extras ? [[1078, 520]] : [],
    marginLine: extras ? [[70, 73], [100, 73], [130, 73]] : [],
    edgeLine: extras ? [[1235, 1005], [1235, 1015], [1235, 1025]] : [],
    // Around the footer: left, top, right, bottom.
    footerBox: footer ? [0, 1700, 330, 1754] : null,
  };
  const base64 = await page.evaluate(async ({ where, extras, footer }) => {
    const canvas = new OffscreenCanvas(1240, 1754);
    const c = canvas.getContext("2d");
    const paper = c.createLinearGradient(0, 0, 1240, 1754);
    paper.addColorStop(0, "rgb(236, 228, 202)");
    paper.addColorStop(1, "rgb(206, 198, 168)");
    c.fillStyle = paper;
    c.fillRect(0, 0, 1240, 1754);

    c.fillStyle = "rgb(25, 25, 30)";
    c.font = "bold 44px sans-serif";
    c.fillText("FAKE APPLICATION FORM (TEST)", 150, 180);
    c.font = "26px sans-serif";
    for (const [index, text] of [
      "1. Name of applicant: FAKECO TEST LTD",
      "2. Address: 1 Sample Street, Testville",
      "3. Representation of the mark:",
    ].entries()) {
      c.fillText(text, 150, 330 + index * 110);
    }
    c.fillRect(150, 350, 940, 3);
    c.fillRect(150, 460, 940, 3);
    c.fillRect(150, 570, 940, 3);
    for (let i = 0; i < 4; i++) c.fillRect(150 + i * 60, 620, 24, 24);
    // A dark frame for the mark.
    c.lineWidth = 3;
    c.strokeRect(150, 680, 600, 380);

    // The emblem: a filled shield in grey and gold.
    c.fillStyle = "rgb(120, 110, 60)";
    c.beginPath();
    c.arc(1000, 820, 70, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "rgb(60, 60, 70)";
    c.fillRect(985, 760, 30, 120);

    // A red stamp, a pale blue stamp, a dark blue signature.
    c.lineWidth = 10;
    c.strokeStyle = "rgb(190, 30, 40)";
    c.beginPath();
    c.arc(930, 1290, 70, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgb(150, 175, 225)";
    c.beginPath();
    c.arc(340, 1340, 56, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 4;
    c.strokeStyle = "rgb(20, 30, 110)";
    c.beginPath();
    c.moveTo(500, 1500);
    c.bezierCurveTo(560, 1420, 620, 1560, 700, 1480);
    c.stroke();

    // The footer, near the bottom edge: "Page 1" and its full stop.
    c.fillStyle = "rgb(25, 25, 30)";
    c.font = "24px sans-serif";
    c.fillText("Page 1", 1040, 1716);
    c.beginPath();
    c.arc(...where.footerStop[0], 3, 0, Math.PI * 2);
    c.fill();

    // To be removed: specks near the edges, the scanner's shadow.
    c.fillStyle = "rgb(30, 30, 30)";
    for (const [x, y] of where.specks) {
      c.beginPath();
      c.arc(x, y, 2.5, 0, Math.PI * 2);
      c.fill();
    }
    if (!footer) {
      c.fillStyle = "rgb(70, 70, 70)";
      c.fillRect(0, 0, 14, 1754);
    }

    if (extras) {
      // The form's own shading: a light green-grey band, 10 mm tall, with
      // a section header in it.
      c.fillStyle = "rgba(60, 90, 40, 0.08)";
      c.fillRect(150, 1110, 940, 60);
      c.fillStyle = "rgb(25, 25, 30)";
      c.font = "bold 26px sans-serif";
      c.fillText("4. IDENTIFICATION OF THE MARK", 165, 1150);
      // A frame line down the right of the form, and a speck in the
      // margin just outside it (2.3 mm away).
      c.fillRect(1060, 260, 3, 390);
      c.fillStyle = "rgb(30, 30, 30)";
      c.beginPath();
      c.arc(...where.marginSpeck[0], 2.5, 0, Math.PI * 2);
      c.fill();
      // A stray pen line in the top-left margin, 14 mm long; a thin line
      // 1 mm inside the right edge (the paper's edge caught by the scan).
      c.fillRect(58, 70, 82, 6);
      c.fillStyle = "rgb(90, 90, 90)";
      c.fillRect(1234, 1000, 3, 30);
    }

    if (footer) {
      // As CamScanner prints it: a badge 3% of the page's width at the
      // very bottom left, the words beside it, centred on it.
      const grey = footer === "black" ? "rgb(25, 25, 30)" : "rgb(155, 155, 155)";
      const size = 37;
      const [x, y] = [6, 1754 - 6 - size];
      c.strokeStyle = grey;
      c.fillStyle = grey;
      c.lineWidth = 2.5;
      c.beginPath();
      c.roundRect(x, y, size, size, 6);
      c.stroke();
      c.fillRect(x, y + size - 7, size, 7);
      c.font = "bold 15px sans-serif";
      c.fillText("CS", x + 8, y + 22);
      c.font = "22px sans-serif";
      const words = footer === "lookalike" ? "Scanned with HP Smart" : "Scanned with CamScanner";
      c.fillText(words, x + size + 7, y + size / 2 + 8);
    }

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    let binary = "";
    for (const byte of new Uint8Array(await blob.arrayBuffer())) binary += String.fromCharCode(byte);
    return btoa(binary);
  }, { where, extras, footer });
  return { jpeg: Buffer.from(base64, "base64"), where };
}

// A PDF whose first page is that scan filling an A4 page (as scanning
// apps save it, with an invisible searchable text layer), and whose second
// page is a real text page.
export async function buildScannedPdf(scanJpeg) {
  const { setTextRenderingMode, TextRenderingMode } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const scan = doc.addPage(A4);
  scan.drawImage(await doc.embedJpg(scanJpeg), { x: 0, y: 0, width: A4[0], height: A4[1] });
  scan.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
  scan.drawText("FAKE APPLICATION FORM (TEST)", { x: 72, y: 760, size: 20, font });
  const text = doc.addPage(A4);
  text.drawText("FAKE FORM page 2: real text", { x: 72, y: 760, size: 14, font });
  return Buffer.from(await doc.save());
}
