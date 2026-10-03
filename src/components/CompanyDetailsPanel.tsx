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
import { DEFAULT_FIELDS, getLegacyEmployerFields } from "@/lib/employerProfile";
import { saveTemplateEmployerFields } from "@/lib/template";
import type { EmployerField, Template } from "@/types/template";

type CompanyDetailsPanelProps = {
  template: Template;
  onBack: () => void;
};

// Each template has its own company details now, not one set shared by
// every template — the first time a template is opened here (its
// `employerFields` is still unset), offer to copy whatever was saved before
// this change as a starting point, rather than silently picking for the
// user. A template that already has its own fields (even an empty list, a
// deliberate "no fields" choice) skips straight to the editor.
export function CompanyDetailsPanel({
  template,
  onBack,
}: CompanyDetailsPanelProps) {
  const [fields, setFields] = useState<EmployerField[] | null>(
    () => template.employerFields ?? null,
  );
  const [saved, setSaved] = useState(false);
  const [deletingField, setDeletingField] = useState<EmployerField | null>(
    null,
  );
  const originalLabelsById = useRef(
    new Map((template.employerFields ?? []).map((field) => [field.id, field.label])),
  );

  const legacyFields = getLegacyEmployerFields();
  const hasLegacyData = legacyFields.some((field) => field.value.trim());

  function startFromLegacy() {
    setFields(legacyFields);
  }

  function startBlank() {
    setFields(DEFAULT_FIELDS);
  }

  function updateLabel(id: string, label: string) {
    setFields((current) =>
      (current ?? []).map((field) =>
        field.id === id ? { ...field, label } : field,
      ),
    );
    setSaved(false);
  }

  function updateValue(id: string, value: string) {
    setFields((current) =>
      (current ?? []).map((field) =>
        field.id === id ? { ...field, value } : field,
      ),
    );
    setSaved(false);
  }

  function handleAddField() {
    setFields((current) => [
      ...(current ?? []),
      { id: crypto.randomUUID(), label: "", value: "" },
    ]);
    setSaved(false);
  }

  function confirmDeleteField() {
    if (!deletingField) return;
    setFields((current) =>
      (current ?? []).filter((field) => field.id !== deletingField.id),
    );
    setDeletingField(null);
    setSaved(false);
  }

  function handleSave() {
    const cleaned = (fields ?? []).map((field) => {
      if (field.label.trim()) return field;
      const original = originalLabelsById.current.get(field.id);
      return original ? { ...field, label: original } : field;
    });
    saveTemplateEmployerFields(template.id, cleaned);
    setFields(cleaned);
    originalLabelsById.current = new Map(
      cleaned.map((field) => [field.id, field.label]),
    );
    setSaved(true);
  }

  if (fields === null) {
    return (
      <div className="flex w-full max-w-md flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Company details for "{template.name}"
          </h2>
          <p className="text-sm text-muted-foreground">
            {hasLegacyData
              ? "You have company details saved from before. Start this template from those, or start blank?"
              : "Fill in company details for this template — filled in automatically wherever a field matches."}
          </p>
        </div>

        {hasLegacyData ? (
          <div className="flex flex-col gap-2">
            <Button onClick={startFromLegacy}>
              Copy my existing company details
            </Button>
            <Button variant="outline" onClick={startBlank}>
              Start blank
            </Button>
          </div>
        ) : (
          <Button onClick={startBlank}>Get started</Button>
        )}

        <Button variant="outline" onClick={onBack}>
          Back to templates
        </Button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Company details
          </h2>
          <p className="text-sm text-muted-foreground">
            For "{template.name}" — filled in automatically wherever a field
            matches.
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
