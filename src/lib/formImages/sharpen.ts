// Sharpening an image with AI upscaling, in this browser: Real-ESRGAN's
// realesr-general-x4v3 (BSD-3-Clause; see the README) run by ONNX Runtime
// Web, on the graphics card where the browser allows it (WebGPU), else on
// the processor (WebAssembly).
//
// The model and the runtime are downloaded once, from this app's own site,
// and kept in the browser's cache storage; nothing else is ever fetched,
// and the image never leaves the browser.
//
// When the model can't run, or this computer would take too long, the
// image is enlarged with high-quality resizing and a gentle sharpening
// instead, and the caller is told which.
import type { InferenceSession, Tensor } from "onnxruntime-web";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import {
  MAX_ENLARGEMENT,
  sharpenedSize,
} from "@/lib/formImages/resolution";
import { edgeColorOf } from "@/lib/formImages/imageFiles";
import type { LoadedImage } from "@/types/formImages";

const MODEL_URL = `${import.meta.env.BASE_URL}models/realesr-general-x4v3.onnx`;
const CACHE_NAME = "pdf-form-filler-sharpening-v1";
// Longer than this on this computer, and the image is resized instead.
const TOO_SLOW_SECONDS = 120;
// Pieces of the image run through the model one at a time, with a margin
// that is cut off again so the seams don't show.
const TILE = 128;
const TILE_MARGIN = 8;

export type Enlarged = {
  // "ai": by the model; "resize": by high-quality resizing and gentle
  // sharpening, because the model was too slow here or did not work.
  method: "ai" | "resize";
  why?: "slow" | "failed";
  // The model's result, four times the original's size (only for "ai").
  canvas?: OffscreenCanvas;
};

export class SharpeningStopped extends Error {}

// ------------------------------------------------------------ download

// A file from this app's own site, from the browser's cache storage after
// the first time. Without cache storage (a private window can refuse it)
// it is simply fetched.
async function cachedBytes(url: string): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const kept = await cache.match(url);
    if (kept) return new Uint8Array(await kept.arrayBuffer());
  } catch {
    cache = null;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    await cache?.put(url, new Response(bytes as BlobPart));
  } catch {
    // Not kept: it is downloaded again next time, nothing else changes.
  }
  return bytes;
}

type Ort = typeof import("onnxruntime-web");
let sessionPromise: Promise<{ ort: Ort; session: InferenceSession }> | null = null;

// The runtime and the model, loaded once per page.
function loadModel(): Promise<{ ort: Ort; session: InferenceSession }> {
  sessionPromise ??= (async () => {
    const ort = await import("onnxruntime-web/webgpu");
    ort.env.wasm.wasmBinary = await cachedBytes(wasmUrl);
    // Several threads need a page set up for them (cross-origin
    // isolation), which GitHub Pages can't do; one thread works anywhere.
    if (!globalThis.crossOriginIsolated) ort.env.wasm.numThreads = 1;
    const model = await cachedBytes(MODEL_URL);
    const session = await ort.InferenceSession.create(model, {
      executionProviders: ["webgpu", "wasm"],
    });
    return { ort, session };
  })();
  // A failure is not kept: the next image tries again.
  sessionPromise.catch(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

// ------------------------------------------------------------- pixels

// The image as it is meant to be seen (turned per its EXIF orientation),
// at its own size or resized.
async function decoded(
  image: LoadedImage,
  size?: { width: number; height: number },
): Promise<ImageBitmap> {
  const blob = new Blob([image.bytes as BlobPart], { type: `image/${image.format}` });
  return createImageBitmap(blob, {
    imageOrientation: "from-image",
    ...(size && {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    }),
  });
}

function pixelsOf(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

// ----------------------------------------------------------- the model

// Runs the model over the image piece by piece. `onProgress` gets 0 to 1;
// `stopped` is asked between pieces. Throws SharpeningStopped when
// stopped, and TooSlow when the first pieces show it would take too long.
class TooSlow extends Error {}

async function enlargeWithModel(
  image: LoadedImage,
  onProgress: (done: number) => void,
  stopped: () => boolean,
): Promise<OffscreenCanvas> {
  const { ort, session } = await loadModel();
  const source = pixelsOf(await decoded(image));
  const { width, height } = source;
  const scale = MAX_ENLARGEMENT;
  const output = new OffscreenCanvas(width * scale, height * scale);
  const outputContext = output.getContext("2d")!;

  const tiles: { x: number; y: number; w: number; h: number }[] = [];
  for (let y = 0; y < height; y += TILE) {
    for (let x = 0; x < width; x += TILE) {
      tiles.push({ x, y, w: Math.min(TILE, width - x), h: Math.min(TILE, height - y) });
    }
  }

  const started = performance.now();
  for (const [index, tile] of tiles.entries()) {
    if (stopped()) throw new SharpeningStopped();
    // The piece with its margin, kept inside the image.
    const x0 = Math.max(0, tile.x - TILE_MARGIN);
    const y0 = Math.max(0, tile.y - TILE_MARGIN);
    const x1 = Math.min(width, tile.x + tile.w + TILE_MARGIN);
    const y1 = Math.min(height, tile.y + tile.h + TILE_MARGIN);
    const w = x1 - x0;
    const h = y1 - y0;

    const input = new Float32Array(3 * w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = ((y0 + y) * width + (x0 + x)) * 4;
        const to = y * w + x;
        input[to] = source.data[from] / 255;
        input[w * h + to] = source.data[from + 1] / 255;
        input[2 * w * h + to] = source.data[from + 2] / 255;
      }
    }
    const result = await session.run({
      image: new ort.Tensor("float32", input, [1, 3, h, w]),
    });
    const enlarged = (result.upscaled as Tensor).data as Float32Array;

    // Only the piece itself goes into the result, not its margin.
    const W = w * scale;
    const H = h * scale;
    const pieceW = tile.w * scale;
    const pieceH = tile.h * scale;
    const offsetX = (tile.x - x0) * scale;
    const offsetY = (tile.y - y0) * scale;
    const piece = new ImageData(pieceW, pieceH);
    for (let y = 0; y < pieceH; y++) {
      for (let x = 0; x < pieceW; x++) {
        const from = (offsetY + y) * W + (offsetX + x);
        const to = (y * pieceW + x) * 4;
        piece.data[to] = clampToByte(enlarged[from]);
        piece.data[to + 1] = clampToByte(enlarged[W * H + from]);
        piece.data[to + 2] = clampToByte(enlarged[2 * W * H + from]);
        piece.data[to + 3] = 255;
      }
    }
    outputContext.putImageData(piece, tile.x * scale, tile.y * scale);
    onProgress((index + 1) / tiles.length);

    // After the second piece (the first includes getting started), how
    // long the rest would take is known well enough.
    if (index === 1 && tiles.length > 2) {
      const perTile = (performance.now() - started) / 2 / 1000;
      if (perTile * tiles.length > TOO_SLOW_SECONDS) throw new TooSlow();
    }
    // Lets the screen show the progress between pieces.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  await keepTransparency(image, output);
  return output;
}

function clampToByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

// The model only knows colours: a transparent part of a PNG gets its
// transparency back from the original, resized to the result's size.
async function keepTransparency(image: LoadedImage, output: OffscreenCanvas): Promise<void> {
  if (image.format !== "png") return;
  const alpha = pixelsOf(await decoded(image, { width: output.width, height: output.height }));
  if (alpha.data.every((value, i) => i % 4 !== 3 || value === 255)) return;
  const context = output.getContext("2d")!;
  const colours = context.getImageData(0, 0, output.width, output.height);
  for (let i = 3; i < colours.data.length; i += 4) colours.data[i] = alpha.data[i];
  context.putImageData(colours, 0, 0);
}

// Enlarges `image` with the model, or says why it was not. Never throws
// except SharpeningStopped.
export async function enlarge(
  image: LoadedImage,
  onProgress: (done: number) => void,
  stopped: () => boolean,
): Promise<Enlarged> {
  try {
    return { method: "ai", canvas: await enlargeWithModel(image, onProgress, stopped) };
  } catch (problem) {
    if (problem instanceof SharpeningStopped) throw problem;
    return { method: "resize", why: problem instanceof TooSlow ? "slow" : "failed" };
  }
}

// ------------------------------------------------------- the result

// A gentle unsharp mask: each pixel pushed a little away from the average
// of its neighbours, which brings back edges softened by resizing.
function gentlySharpen(pixels: ImageData): void {
  const { width, height, data } = pixels;
  const original = new Uint8ClampedArray(data);
  const AMOUNT = 0.5;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const at = (dx: number, dy: number) => original[((y + dy) * width + x + dx) * 4 + c];
        const blurred =
          (4 * at(0, 0) + 2 * (at(-1, 0) + at(1, 0) + at(0, -1) + at(0, 1)) +
            at(-1, -1) + at(1, -1) + at(-1, 1) + at(1, 1)) / 16;
        data[(y * width + x) * 4 + c] = at(0, 0) + AMOUNT * (at(0, 0) - blurred);
      }
    }
  }
}

export type SharpenedImage = {
  // A PNG, which is lossless.
  bytes: Uint8Array;
  width: number;
  height: number;
  // Its own edge colour: sharpening changes the shade very slightly, and a
  // full-page image's page is filled with the shade its edges now have.
  edgeColor: [number, number, number];
};

// The sharpened image as it goes into the PDF, for an image printed
// `printedWidthMm` wide: 300 dpi at that size (at most four times the
// original).
export async function sharpenedPng(
  image: LoadedImage,
  enlarged: Enlarged,
  printedWidthMm: number,
): Promise<SharpenedImage> {
  const size = sharpenedSize(image.pixelWidth, image.pixelHeight, printedWidthMm);
  const resized = enlarged.canvas
    ? await createImageBitmap(enlarged.canvas, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: "high",
      })
    : await decoded(image, size);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(resized, 0, 0);
  if (enlarged.method === "resize") {
    const pixels = context.getImageData(0, 0, size.width, size.height);
    gentlySharpen(pixels);
    context.putImageData(pixels, 0, 0);
  }
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    ...size,
    edgeColor: edgeColorOf(canvas, size.width, size.height),
  };
}
