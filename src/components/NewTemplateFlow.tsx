import { useRef, useState } from "react";
import { CircleAlertIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PdfCanvas } from "@/components/PdfCanvas";
import { fileToBase64, isPdfFile } from "@/lib/pdf";
import { createTemplate } from "@/lib/template";
import type { Template } from "@/types/template";

type NewTemplateFlowProps = {
  onCreated: (template: Template) => void;
  onCancel: () => void;
};

export function NewTemplateFlow({
  onCreated,
  onCancel,
}: NewTemplateFlowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;

    if (!(await isPdfFile(selected))) {
      setError("This file doesn't look like a PDF.");
      setFile(null);
      return;
    }

    setError(null);
    setFile(selected);
    setName((current) => current || selected.name.replace(/\.pdf$/i, ""));
  }

  async function handleSave() {
    if (!file) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give this template a name before saving.");
      return;
    }

    setSaving(true);
    try {
      const pdfData = await fileToBase64(file);
      const template = createTemplate({
        name: trimmedName,
        pdfFileName: file.name,
        pdfData,
      });
      onCreated(template);
    } catch {
      setError(
        "Something went wrong saving this template. Please try again.",
      );
      setSaving(false);
    }
  }

  return (
    <div
      className={`flex w-full flex-col gap-5 ${file ? "max-w-296" : "max-w-4xl"}`}
    >
      <div className="flex w-full animate-rise flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">
          New template
        </h2>
        <Button variant="outline" onClick={onCancel}>
          Back to templates
        </Button>
      </div>

      {/* Directly under the title, so it is seen at once at any window
          width, not below a tall preview. */}
      {error && (
        <p className="notice-panel notice-danger w-full">
          <CircleAlertIcon />
          {error}
        </p>
      )}

      {!file ? (
        <div className="glass flex w-full animate-rise flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="icon-tile">
            <UploadIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-fg">Upload a blank PDF</p>
            <p className="text-sm text-muted">
              You'll draw fields on it in the next step.
            </p>
          </div>
          <Button className="mt-1" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon />
            Upload a PDF
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      ) : (
        // The name and Save button sit beside the preview on a wide window,
        // and above it on a narrow one (so they are not below a tall page).
        <div className="flex w-full flex-col items-start gap-5 xl:flex-row-reverse xl:justify-between">
          <section className="glass flex w-full shrink-0 animate-rise flex-col gap-4 p-4 xl:w-80">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="template-name"
                className="text-sm font-medium text-fg"
              >
                Template name
              </label>
              <Input
                id="template-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Statement of Emoluments 2026"
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save template"}
            </Button>
          </section>

          <div className="preview-frame max-w-full p-4">
            <PdfCanvas source={file} onError={setError} />
          </div>
        </div>
      )}
    </div>
  );
}
