import { useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ImagePlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  A4_PORTRAIT_MM,
  fullPageImageMm,
} from "@/lib/formImages/measure";
import type { LoadedImage } from "@/types/formImages";

type FullPageImagesPanelProps = {
  images: LoadedImage[];
  // The page number the first full-page image gets.
  firstPageNumber: number;
  marginMm: number;
  onAdd: (files: File[]) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (image: LoadedImage) => void;
  onMargin: (marginMm: number) => void;
  onNotAMargin: () => void;
};

// The largest margin that still leaves room for an image on A4.
const MAX_MARGIN_MM = 50;

export function FullPageImagesPanel({
  images,
  firstPageNumber,
  marginMm,
  onAdd,
  onMove,
  onRemove,
  onMargin,
  onNotAMargin,
}: FullPageImagesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [margin, setMargin] = useState(String(marginMm));

  function applyMargin() {
    const value = Number(margin.trim().replace(",", "."));
    if (!Number.isInteger(value) || value < 0 || value > MAX_MARGIN_MM) {
      onNotAMargin();
      setMargin(String(marginMm));
      return;
    }
    onMargin(value);
  }

  return (
    <section className="glass flex w-full flex-col">
      <div className="card-header">
        <h3 className="card-title">Full-page images (added at the end)</h3>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted">
          Each image gets its own A4 page after the form's last page, as large
          as it fits, with the space around it in the colour of the image's
          edges.
        </p>

        {images.length > 0 && (
          <ol className="flex flex-col gap-1.5">
            {images.map((image, index) => (
              <li
                key={image.id}
                className="flex items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-2"
              >
                <img
                  src={image.url}
                  alt=""
                  className="size-8 shrink-0 rounded object-contain"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-fg">{image.name}</span>
                  <span className="text-xs text-muted">
                    Page {firstPageNumber + index}
                  </span>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move "${image.name}" up`}
                    disabled={index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move "${image.name}" down`}
                    disabled={index === images.length - 1}
                    onClick={() => onMove(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove "${image.name}"`}
                    onClick={() => onRemove(image)}
                  >
                    <Trash2Icon className="text-danger" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <ImagePlusIcon />
          Add full-page images
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          data-testid="full-page-images-input"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length > 0) onAdd(files);
          }}
        />

        <div className="flex flex-col gap-1">
          <label
            htmlFor="full-page-margin"
            className="text-sm font-medium text-fg"
          >
            Margin around each image (mm)
          </label>
          <div className="flex gap-2">
            <Input
              id="full-page-margin"
              inputMode="numeric"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applyMargin();
              }}
            />
            <Button variant="outline" onClick={applyMargin}>
              Set margin
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

// A full-page image's page as it will be in the PDF.
export function FullPagePreview({
  image,
  pageNumber,
  pageCount,
  marginMm,
  pixelsPerMm,
}: {
  image: LoadedImage;
  pageNumber: number;
  pageCount: number;
  marginMm: number;
  pixelsPerMm: number;
}) {
  const placed = fullPageImageMm(image.pixelWidth, image.pixelHeight, marginMm);
  const [r, g, b] = image.edgeColor;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-muted">
        Page {pageNumber} of {pageCount} (full-page image)
      </figcaption>
      <div
        className="on-paper relative shrink-0 overflow-hidden rounded-lg ring-1 ring-line"
        style={{
          width: A4_PORTRAIT_MM.width * pixelsPerMm,
          height: A4_PORTRAIT_MM.height * pixelsPerMm,
          background: `rgb(${r} ${g} ${b})`,
        }}
      >
        <img
          src={image.url}
          alt=""
          className="absolute max-w-none"
          style={{
            left: placed.x * pixelsPerMm,
            top: placed.y * pixelsPerMm,
            width: placed.width * pixelsPerMm,
            height: placed.height * pixelsPerMm,
          }}
        />
      </div>
    </figure>
  );
}
