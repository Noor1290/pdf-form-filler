// Turning the chosen form into pages: a PDF keeps its own pages and their
// sizes; each image becomes one A4 page.
import { isPdfFile, loadPdfDocument, type PdfDocument } from "@/lib/pdf";
import { forgetImage, loadImageFile } from "@/lib/formImages/imageFiles";
import { a4PageForImage } from "@/lib/formImages/measure";
import type { LoadedForm } from "@/types/formImages";

// Worded for the person who chose the files; shown as it is.
export class FormFileError extends Error {}

export type OpenedForm = { form: LoadedForm; pdf: PdfDocument | null };

export async function openForm(files: File[]): Promise<OpenedForm> {
  if (files.length === 0) throw new FormFileError("No file was chosen.");
  const pdfs = await Promise.all(files.map(isPdfFile));

  if (pdfs.some(Boolean)) {
    if (files.length > 1) {
      throw new FormFileError(
        "Choose one PDF, or one or more images (JPG or PNG), not both.",
      );
    }
    return openPdfForm(files[0]);
  }
  return openImageForm(files);
}

async function openPdfForm(file: File): Promise<OpenedForm> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pdf: PdfDocument;
  try {
    pdf = await loadPdfDocument(bytes);
  } catch {
    throw new FormFileError("This file doesn't look like a PDF.");
  }
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    // The size as shown, which for a page saved turned (/Rotate) is its
    // turned size: boxes are drawn on what the person sees.
    const viewport = (await pdf.getPage(number)).getViewport({ scale: 1 });
    pages.push({ number, widthPt: viewport.width, heightPt: viewport.height });
  }
  return {
    form: { kind: "pdf", fileName: file.name, pdfBytes: bytes, pages },
    pdf,
  };
}

async function openImageForm(files: File[]): Promise<OpenedForm> {
  const pages = [];
  for (const [index, file] of files.entries()) {
    let image;
    try {
      image = await loadImageFile(file);
    } catch {
      // The pages read so far won't be shown: let go of their previews.
      for (const page of pages) forgetImage(page.image);
      throw new FormFileError(
        `"${file.name}" isn't a PDF or an image this tool can use (JPG or PNG).`,
      );
    }
    pages.push({
      number: index + 1,
      ...a4PageForImage(image.pixelWidth, image.pixelHeight),
      image,
    });
  }
  return {
    form: { kind: "images", fileName: files[0].name, pages },
    pdf: null,
  };
}
