// Cleans one scanned page away from the screen's own thread, so the page
// stays responsive while a large scan is worked on (see cleanScan.ts).
import { cleanScan } from "@/lib/formImages/cleanScan";

type Job = { pixels: Uint8ClampedArray; width: number; height: number };

self.onmessage = (event: MessageEvent<Job>) => {
  const { pixels, width, height } = event.data;
  const report = cleanScan(pixels, width, height);
  // The pixels are handed back, not copied.
  (self as unknown as Worker).postMessage({ pixels, report }, [pixels.buffer]);
};
