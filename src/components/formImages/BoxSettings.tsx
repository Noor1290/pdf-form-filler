import { useRef, useState } from "react";
import { ImageIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatCm,
  formatSizeCm,
  parseCmToMm,
  placedImageMm,
} from "@/lib/formImages/measure";
import type { ImageBox } from "@/types/formImages";

type BoxSettingsProps = {
  box: ImageBox;
  onChooseImage: (file: File) => void;
  // Sizes in whole millimetres, as typed (the tool keeps them in bounds).
  onSetSize: (widthMm: number, heightMm: number) => void;
  onSetLimit: (widthMm: number, heightMm: number) => void;
  onDelete: () => void;
  // Something typed is not a size.
  onNotASize: () => void;
};

// The selected box: its image, its size and its size limit, all in cm.
// Keyed by the box and its sizes by the caller, so the boxes show the
// box's current values whenever it changes.
export function BoxSettings({
  box,
  onChooseImage,
  onSetSize,
  onSetLimit,
  onDelete,
  onNotASize,
}: BoxSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(formatCm(box.widthMm));
  const [height, setHeight] = useState(formatCm(box.heightMm));
  const [limitWidth, setLimitWidth] = useState(formatCm(box.limitWidthMm));
  const [limitHeight, setLimitHeight] = useState(formatCm(box.limitHeightMm));
  const placed = placedImageMm(box);

  function apply(
    typedWidth: string,
    typedHeight: string,
    then: (widthMm: number, heightMm: number) => void,
  ) {
    const widthMm = parseCmToMm(typedWidth);
    const heightMm = parseCmToMm(typedHeight);
    if (widthMm === null || heightMm === null) onNotASize();
    else then(widthMm, heightMm);
  }

  return (
    <section className="glass flex w-full flex-col" aria-label={`${box.label} settings`}>
      <div className="card-header">
        <h3 className="card-title">
          {box.label} (page {box.page})
        </h3>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="icon-tile shrink-0 overflow-hidden">
            {box.image ? (
              <img src={box.image.url} alt="" className="size-full object-contain" />
            ) : (
              <ImageIcon className="size-5" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm text-fg">
              {box.image ? box.image.name : "No image yet."}
            </span>
            <span className="text-xs text-muted">
              {placed
                ? `Image as placed: ${formatSizeCm(placed.width, placed.height)}`
                : "Choose the image to put in this box."}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {box.image ? "Change image" : "Choose an image"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            data-testid="box-image-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onChooseImage(file);
            }}
          />
        </div>

        <CmPair
          legend="Box size (cm)"
          names={["Box width in cm", "Box height in cm"]}
          width={width}
          height={height}
          onWidth={setWidth}
          onHeight={setHeight}
          action="Set size"
          onApply={() => apply(width, height, onSetSize)}
        />
        <CmPair
          legend="Size limit (cm)"
          names={["Limit width in cm", "Limit height in cm"]}
          width={limitWidth}
          height={limitHeight}
          onWidth={setLimitWidth}
          onHeight={setLimitHeight}
          action="Set limit"
          onApply={() => apply(limitWidth, limitHeight, onSetLimit)}
        />

        <Button variant="outline" onClick={onDelete}>
          <Trash2Icon className="text-danger" />
          Delete box
        </Button>
      </div>
    </section>
  );
}

function CmPair({
  legend,
  names,
  width,
  height,
  onWidth,
  onHeight,
  action,
  onApply,
}: {
  legend: string;
  // What a screen reader (and a test) calls each box.
  names: [string, string];
  width: string;
  height: string;
  onWidth: (value: string) => void;
  onHeight: (value: string) => void;
  action: string;
  onApply: () => void;
}) {
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") onApply();
  };
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Width
          <Input
            aria-label={names[0]}
            inputMode="decimal"
            value={width}
            onChange={(event) => onWidth(event.target.value)}
            onKeyDown={onEnter}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
          Height
          <Input
            aria-label={names[1]}
            inputMode="decimal"
            value={height}
            onChange={(event) => onHeight(event.target.value)}
            onKeyDown={onEnter}
          />
        </label>
        <Button variant="outline" onClick={onApply}>
          {action}
        </Button>
      </div>
    </fieldset>
  );
}
