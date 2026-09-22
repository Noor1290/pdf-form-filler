import { useRef, useState } from "react";
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
    <div className="flex w-full max-w-2xl flex-col items-center gap-4">
      <div className="flex w-full items-center justify-between">
        <h2 className="text-xl font-semibold">New template</h2>
        <Button variant="outline" onClick={onCancel}>
          Back to templates
        </Button>
      </div>

      {!file ? (
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => fileInputRef.current?.click()}>
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
        <div className="flex w-full flex-col items-center gap-4">
          <div className="flex w-full max-w-sm flex-col gap-1">
            <label htmlFor="template-name" className="text-sm font-medium">
              Template name
            </label>
            <Input
              id="template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Statement of Emoluments 2026"
            />
          </div>

          <PdfCanvas source={file} onError={setError} />

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save template"}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
