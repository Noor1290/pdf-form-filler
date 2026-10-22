import { useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dpiAt, MAX_ENLARGEMENT, needsSharpening, TARGET_DPI } from "@/lib/formImages/resolution";
import { sharpenedPng, type Enlarged } from "@/lib/formImages/sharpen";
import type { LoadedImage } from "@/types/formImages";

// Where an image's sharpening stands. No entry: not started (or not
// needed).
export type SharpenState =
  | { status: "working"; progress: number }
  | { status: "done"; result: Enlarged };

// One use of an image: in a box, or as a full-page image.
export type ImageUse = {
  image: LoadedImage;
  printedWidthMm: number;
  // Sharpening is on unless switched off (full-page images), or off
  // unless switched on (images in boxes), as the owner asked.
  on: boolean;
};

// The dpi after sharpening: 300, or four times the original if that is
// less.
function sharpenedDpi(use: ImageUse): number {
  return Math.round(
    Math.min(TARGET_DPI, dpiAt(use.image.pixelWidth * MAX_ENLARGEMENT, use.printedWidthMm)),
  );
}

// Under an image: how sharp it will print, the switch, and how sharpening
// went.
export function SharpenInfo({
  use,
  state,
  onSwitch,
  onCompare,
}: {
  use: ImageUse;
  state: SharpenState | undefined;
  onSwitch: (on: boolean) => void;
  onCompare: () => void;
}) {
  const dpi = Math.round(dpiAt(use.image.pixelWidth, use.printedWidthMm));
  if (!needsSharpening(use.image.pixelWidth, use.printedWidthMm)) {
    return <p className="text-xs text-muted">{dpi} dpi at this size: sharp enough.</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={use.on}
          onChange={(event) => onSwitch(event.target.checked)}
        />
        Sharpen with AI ({dpi} dpi at this size)
      </label>
      {use.on && (
        <p className="text-xs text-muted" role="status">
          {describe(use, state)}
        </p>
      )}
      {use.on && state?.status === "done" && (
        <Button variant="outline" size="xs" className="self-start" onClick={onCompare}>
          <SparklesIcon />
          Compare before and after
        </Button>
      )}
    </div>
  );
}

function describe(use: ImageUse, state: SharpenState | undefined): string {
  if (!state) return "Waiting to be sharpened…";
  if (state.status === "working") return `Sharpening… ${Math.round(state.progress * 100)}%`;
  const prints = sharpenedDpi(use);
  if (state.result.method === "ai") return `Sharpened with AI: prints at ${prints} dpi.`;
  const why =
    state.result.why === "slow"
      ? "AI sharpening would take too long on this computer"
      : "AI sharpening didn't work on this computer";
  return `${why}, so it was enlarged with smooth resizing and gentle sharpening instead: prints at ${prints} dpi.`;
}

const ZOOMS = [
  { label: "Whole image", factor: 1 },
  { label: "2×", factor: 2 },
  { label: "4×", factor: 4 },
];

// The image before and after sharpening, side by side at the same size,
// zoomed and scrolled together.
export function CompareDialog({
  use,
  result,
  onClose,
}: {
  use: ImageUse | null;
  result: Enlarged | null;
  onClose: () => void;
}) {
  // What the dialog was opened for, kept while it fades out.
  const [shown, setShown] = useState<{ use: ImageUse; afterUrl: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const afterUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!use || !result) return;
    let cancelled = false;
    void sharpenedPng(use.image, result, use.printedWidthMm).then(({ bytes }) => {
      if (cancelled) return;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
      // The previous "after" image is let go of once this one replaces it
      // (not on closing: it is still shown while the dialog fades out).
      if (afterUrl.current) URL.revokeObjectURL(afterUrl.current);
      afterUrl.current = url;
      setZoom(1);
      setShown({ use, afterUrl: url });
    });
    return () => {
      cancelled = true;
    };
  }, [use, result]);
  useEffect(
    () => () => {
      if (afterUrl.current) URL.revokeObjectURL(afterUrl.current);
    },
    [],
  );

  // Scrolling one side scrolls the other the same way.
  function follow(from: number) {
    const source = panes.current[from];
    const other = panes.current[1 - from];
    if (!source || !other) return;
    other.scrollLeft = source.scrollLeft;
    other.scrollTop = source.scrollTop;
  }

  const open = use !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader icon={<SparklesIcon />}>
          <DialogTitle>Before and after</DialogTitle>
          <DialogDescription>
            {shown ? `"${shown.use.image.name}"` : ""} Zoom in to see the
            difference; both sides move together.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Zoom">
          {ZOOMS.map(({ label, factor }) => (
            <Button
              key={factor}
              size="sm"
              variant={zoom === factor ? "default" : "outline"}
              aria-pressed={zoom === factor}
              onClick={() => setZoom(factor)}
            >
              {label}
            </Button>
          ))}
        </div>
        {shown ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: "Before", url: shown.use.image.url },
              { title: "After", url: shown.afterUrl },
            ].map(({ title, url }, index) => (
              <figure key={title} className="flex min-w-0 flex-col gap-1">
                <figcaption className="text-sm font-medium text-fg">{title}</figcaption>
                <div
                  ref={(element) => {
                    panes.current[index] = element;
                  }}
                  onScroll={() => follow(index)}
                  className="on-paper h-[55vh] overflow-auto rounded-lg ring-1 ring-line"
                >
                  <img
                    src={url}
                    alt=""
                    className="max-w-none"
                    style={{ width: `${zoom * 100}%` }}
                  />
                </div>
              </figure>
            ))}
          </div>
        ) : (
          <div aria-hidden="true" className="skeleton h-[55vh] rounded-lg" />
        )}
      </DialogContent>
    </Dialog>
  );
}
