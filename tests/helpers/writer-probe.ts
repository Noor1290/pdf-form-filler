// Test-only. Loaded into the running app by the safety-net test so it can
// record exactly what the app hands to the PDF writer (pdf-lib's drawText):
// the text, where it goes, and in which font, size and colour. It forwards
// every call untouched, so the generated PDF is the same with or without it.
// Nothing in src/ imports this file, so it is never part of a build.
import { PDFPage } from "pdf-lib";

type DrawTextOptions = NonNullable<Parameters<PDFPage["drawText"]>[1]>;

type RecordedCall = {
  page: number;
  text: string;
  x: number | undefined;
  y: number | undefined;
  size: number | undefined;
  font: string | undefined;
  color: unknown;
  rotate: unknown;
};

let calls: RecordedCall[] | null = null;
const originalDrawText = PDFPage.prototype.drawText;

PDFPage.prototype.drawText = function (text: string, options?: DrawTextOptions) {
  if (calls) {
    calls.push({
      page: this.doc.getPages().indexOf(this) + 1,
      text,
      x: options?.x,
      y: options?.y,
      size: options?.size,
      font: options?.font?.name,
      color: options?.color,
      rotate: options?.rotate,
    });
  }
  return originalDrawText.call(this, text, options);
};

const probe = {
  start() {
    calls = [];
  },
  stop(): RecordedCall[] {
    const recorded = calls ?? [];
    calls = null;
    return recorded;
  },
};

(window as unknown as { __writerProbe: typeof probe }).__writerProbe = probe;

export default probe;
