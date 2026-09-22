import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FieldBox } from "@/types/template";

type BoxStyleDialogProps = {
  box: FieldBox | null;
  onChange: (updated: FieldBox) => void;
  onClose: () => void;
};

const FONT_FAMILIES: FieldBox["fontFamily"][] = [
  "Helvetica",
  "Times-Roman",
  "Courier",
];
const ALIGNMENTS: FieldBox["align"][] = ["left", "center", "right"];
const VALIDATION_TYPES: {
  value: NonNullable<FieldBox["validationType"]>;
  label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "amount", label: "Amount" },
];

// Changes apply immediately to the box (same as dragging/resizing) — the
// existing "Save template" / "Reset to template" flow already covers
// committing or discarding them, so this dialog doesn't need its own.
export function BoxStyleDialog({ box, onChange, onClose }: BoxStyleDialogProps) {
  if (!box) return null;

  function update<K extends keyof FieldBox>(key: K, value: FieldBox[K]) {
    onChange({ ...box, [key]: value } as FieldBox);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Field settings — {box.name}</DialogTitle>
          <DialogDescription>
            Controls how this field's text looks on the PDF, and whether we
            check it looks right while filling it in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Field type</span>
            <div className="flex gap-1">
              {VALIDATION_TYPES.map((type) => (
                <Button
                  key={type.value}
                  type="button"
                  size="sm"
                  variant={
                    (box.validationType ?? "text") === type.value
                      ? "default"
                      : "outline"
                  }
                  onClick={() => update("validationType", type.value)}
                >
                  {type.label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              "Amount" gently warns if what's typed doesn't look like a
              number — it never changes what you typed.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Font</span>
            <div className="flex gap-1">
              {FONT_FAMILIES.map((family) => (
                <Button
                  key={family}
                  type="button"
                  size="sm"
                  variant={box.fontFamily === family ? "default" : "outline"}
                  onClick={() => update("fontFamily", family)}
                >
                  {family}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="box-font-size" className="text-sm font-medium">
              Font size
            </label>
            <Input
              id="box-font-size"
              type="number"
              min={6}
              max={72}
              value={box.fontSize}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (Number.isFinite(parsed) && parsed > 0) {
                  update("fontSize", parsed);
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Alignment</span>
            <div className="flex gap-1">
              {ALIGNMENTS.map((align) => (
                <Button
                  key={align}
                  type="button"
                  size="sm"
                  variant={box.align === align ? "default" : "outline"}
                  onClick={() => update("align", align)}
                >
                  {align[0].toUpperCase() + align.slice(1)}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Bold</span>
            <Button
              type="button"
              size="sm"
              variant={box.bold ? "default" : "outline"}
              onClick={() => update("bold", !box.bold)}
            >
              {box.bold ? "Bold on" : "Bold off"}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="box-color" className="text-sm font-medium">
              Text color
            </label>
            <input
              id="box-color"
              type="color"
              value={box.color}
              onChange={(event) => update("color", event.target.value)}
              className="h-8 w-14 cursor-pointer rounded border border-input"
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
