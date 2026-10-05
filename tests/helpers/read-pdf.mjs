// Reads the text back out of a generated PDF: what is drawn, on which page,
// where, and in which font and size. Positions and sizes are rounded to
// 0.5pt so the comparison is about placement, not floating-point noise.
// PDF bytes are never compared (they can contain timestamps).
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const half = (value) => Math.round(value * 2) / 2;

export async function readPdfText(bytes) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    verbosity: 0,
  }).promise;

  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const [x0, y0, x1, y1] = page.view;
    // Font objects are only resolved once the page's drawing commands have
    // been read, which is what gives us the real font name.
    await page.getOperatorList();
    const content = await page.getTextContent();

    const items = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [a, b, , , e, f] = item.transform;
      let font = item.fontName;
      try {
        font = page.commonObjs.get(item.fontName)?.name ?? font;
      } catch {
        // keep pdf.js's internal id if the font can't be resolved
      }
      items.push({
        text: item.str,
        x: half(e),
        y: half(f),
        size: half(Math.hypot(a, b)),
        // 0 for upright text; non-zero when the text is counter-rotated
        // for a page saved with /Rotate.
        angle: Math.round((Math.atan2(b, a) * 180) / Math.PI),
        font,
      });
    }
    pages.push({
      page: number,
      rotation: page.rotate,
      width: half(x1 - x0),
      height: half(y1 - y0),
      items,
    });
  }
  await doc.loadingTask.destroy();
  return pages;
}
