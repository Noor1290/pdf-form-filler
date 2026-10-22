// Reading the images the user chooses: what kind of file it is, its size
// in pixels, which way is up, and the colour of its edges. The bytes are
// kept exactly as chosen, so the PDF can embed the original.
import type { LoadedImage } from "@/types/formImages";

export class NotAnImageError extends Error {}

// The browser's reported file type is unreliable on Windows (see isPdfFile
// in lib/pdf.ts), so the file's own first bytes decide.
export function imageFormat(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, i) => bytes[i] === byte)) return "png";
  return null;
}

// The size stored in the file, in pixels, before any turning.
function storedSize(
  bytes: Uint8Array,
  format: "jpeg" | "png",
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "png") {
    if (bytes.length < 24) return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  // JPEG: walk the markers to the frame header (SOF0-SOF15, except the
  // DHT, JPG and DAC markers that share that range).
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = view.getUint16(offset + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

// The phone's "which way is up" note (EXIF orientation, 1 to 8) in a
// JPEG's APP1 segment; 1 when there is none.
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const length = view.getUint16(offset + 2);
    // The image data starts at SOS: no EXIF after that.
    if (marker === 0xda) return 1;
    const isExif =
      marker === 0xe1 &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === "Exif";
    if (isExif) return orientationInTiff(view, offset + 10);
    offset += 2 + length;
  }
  return 1;
}

function orientationInTiff(view: DataView, tiff: number): number {
  try {
    const little = view.getUint16(tiff) === 0x4949;
    const firstDirectory = tiff + view.getUint32(tiff + 4, little);
    const entries = view.getUint16(firstDirectory, little);
    for (let i = 0; i < entries; i++) {
      const entry = firstDirectory + 2 + i * 12;
      if (view.getUint16(entry, little) === 0x0112) {
        const value = view.getUint16(entry + 8, little);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
  } catch {
    // A damaged EXIF block: treat the image as stored upright.
  }
  return 1;
}

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new NotAnImageError());
    image.src = url;
  });
}

// The colour of an image's own edges: the middle value (median) of each of
// red, green and blue over a thin band all round it, with any transparent
// part counted as white paper. The median, not the average, so a few
// stray pixels (a logo touching the edge) don't tint the result.
export function edgeColorOf(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
): [number, number, number] {
  const longest = Math.max(imageWidth, imageHeight);
  const scale = Math.min(1, 256 / longest);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [255, 255, 255];
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);

  const band = Math.max(1, Math.round(Math.min(width, height) * 0.01));
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onEdge =
        x < band || y < band || x >= width - band || y >= height - band;
      if (!onEdge) continue;
      const i = (y * width + x) * 4;
      channels[0].push(data[i]);
      channels[1].push(data[i + 1]);
      channels[2].push(data[i + 2]);
    }
  }
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  return [median(channels[0]), median(channels[1]), median(channels[2])];
}

// Reads a chosen file as an image. Throws NotAnImageError for anything
// that is not a JPG or PNG the browser can show.
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = imageFormat(bytes);
  const stored = format ? storedSize(bytes, format) : null;
  if (!format || !stored) throw new NotAnImageError();

  const orientation = format === "jpeg" ? jpegOrientation(bytes) : 1;
  // Orientations 5 to 8 are a quarter turn: width and height swap.
  const turned = orientation >= 5;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: `image/${format}` }));
  try {
    const decoded = await decode(url);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      bytes,
      format,
      pixelWidth: turned ? stored.height : stored.width,
      pixelHeight: turned ? stored.width : stored.height,
      orientation,
      url,
      edgeColor: edgeColorOf(decoded, decoded.naturalWidth, decoded.naturalHeight),
    };
  } catch (problem) {
    URL.revokeObjectURL(url);
    throw problem instanceof NotAnImageError ? problem : new NotAnImageError();
  }
}

export function forgetImage(image: LoadedImage): void {
  URL.revokeObjectURL(image.url);
}
