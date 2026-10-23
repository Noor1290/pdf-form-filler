import { useEffect, useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import {
  BeforeAfterDialog,
  type BeforeAndAfter,
} from "@/components/formImages/BeforeAfterDialog";
import { Button } from "@/components/ui/button";
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
  // Switched on: until it is switched off, every image that would print
  // under about 300 dpi is sharpened, in a box or on a full page.
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

// The image before and after sharpening (as it goes into the PDF).
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
  const [shown, setShown] = useState<BeforeAndAfter | null>(null);
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
      setShown({ name: use.image.name, beforeUrl: use.image.url, afterUrl: url });
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

  return <BeforeAfterDialog open={use !== null} shown={shown} onClose={onClose} />;
}
