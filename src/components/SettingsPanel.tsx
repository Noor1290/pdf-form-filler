import { useRef, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getEmployerFields, saveEmployerFields } from "@/lib/employerProfile";
import type { EmployerField } from "@/types/template";

type SettingsPanelProps = {
  onBack: () => void;
};

export function SettingsPanel({ onBack }: SettingsPanelProps) {
  const [fields, setFields] = useState<EmployerField[]>(() =>
    getEmployerFields(),
  );
  const [saved, setSaved] = useState(false);
  const [deletingField, setDeletingField] = useState<EmployerField | null>(
    null,
  );
  // So Save can avoid accidentally blanking out a label the user already
  // had — only a genuinely brand-new field is allowed to save with no name.
  const originalLabelsById = useRef(
    new Map(fields.map((field) => [field.id, field.label])),
  );

  function updateLabel(id: string, label: string) {
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, label } : field)),
    );
    setSaved(false);
  }

  function updateValue(id: string, value: string) {
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, value } : field)),
    );
    setSaved(false);
  }

  function handleAddField() {
    setFields((current) => [
      ...current,
      { id: crypto.randomUUID(), label: "", value: "" },
    ]);
    setSaved(false);
  }

  function confirmDeleteField() {
    if (!deletingField) return;
    setFields((current) =>
      current.filter((field) => field.id !== deletingField.id),
    );
    setDeletingField(null);
    setSaved(false);
  }

  function handleSave() {
    const cleaned = fields.map((field) => {
      if (field.label.trim()) return field;
      const original = originalLabelsById.current.get(field.id);
      return original ? { ...field, label: original } : field;
    });
    saveEmployerFields(cleaned);
    setFields(cleaned);
    originalLabelsById.current = new Map(
      cleaned.map((field) => [field.id, field.label]),
    );
    setSaved(true);
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Employer details
          </h2>
          <p className="text-sm text-muted-foreground">
            Filled in automatically wherever a field matches.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Back to templates
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <div
            key={field.id}
            className="relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
          >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove field "${field.label || "(unnamed field)"}"`}
              className="absolute top-3 right-3 text-muted-foreground hover:text-destructive"
              onClick={() => setDeletingField(field)}
            >
              <Trash2Icon />
            </Button>

            <div className="flex flex-col gap-1 pr-8">
              <label
                htmlFor={`employer-label-${field.id}`}
                className="text-xs font-medium text-muted-foreground"
              >
                Field name
              </label>
              <Input
                id={`employer-label-${field.id}`}
                value={field.label}
                onChange={(event) =>
                  updateLabel(field.id, event.target.value)
                }
                className="h-7 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor={`employer-value-${field.id}`}
                className="text-sm font-medium"
              >
                {field.label || "(unnamed field)"}
              </label>
              <Input
                id={`employer-value-${field.id}`}
                value={field.value}
                onChange={(event) =>
                  updateValue(field.id, event.target.value)
                }
              />
            </div>
          </div>
        ))}
      </div>

      <Button variant="outline" onClick={handleAddField}>
        Add field
      </Button>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>Save</Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>

      <Dialog
        open={deletingField !== null}
        onOpenChange={(open) => !open && setDeletingField(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this field?</DialogTitle>
            <DialogDescription>
              This will remove "{deletingField?.label || "(unnamed field)"}"
              and delete its saved value. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingField(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteField}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
