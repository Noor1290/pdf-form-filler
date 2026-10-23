import { useRef, useState } from "react";
import { SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type BeforeAndAfter = {
  // What is compared, shown in quotes: an image's file name, or a page.
  name: string;
  beforeUrl: string;
  // Null while the "after" side is still being made.
  afterUrl: string | null;
};

const ZOOMS = [
  { label: "Whole image", factor: 1 },
  { label: "2×", factor: 2 },
  { label: "4×", factor: 4 },
];

// Two versions of an image side by side, at the same size, zoomed and
// scrolled together: a sharpened image, or a cleaned scan.
export function BeforeAfterDialog({
  open,
  shown,
  onClose,
}: {
  open: boolean;
  // Kept by the caller after closing, so the dialog still shows it while
  // it fades out.
  shown: BeforeAndAfter | null;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const panes = useRef<(HTMLDivElement | null)[]>([]);

  // Scrolling one side scrolls the other the same way.
  function follow(from: number) {
    const source = panes.current[from];
    const other = panes.current[1 - from];
    if (!source || !other) return;
    other.scrollLeft = source.scrollLeft;
    other.scrollTop = source.scrollTop;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setZoom(1);
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader icon={<SparklesIcon />}>
          <DialogTitle>Before and after</DialogTitle>
          <DialogDescription>
            {shown ? `"${shown.name}"` : ""} Zoom in to see the difference;
            both sides move together.
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
        {shown?.afterUrl ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              { title: "Before", url: shown.beforeUrl },
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
