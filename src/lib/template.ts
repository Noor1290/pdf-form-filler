import { templateSchema } from "@/lib/validation";
import type { FieldBox, Template } from "@/types/template";

const STORAGE_KEY = "pdf-editor:templates";

function readAll(): Template[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Template[];
  } catch {
    return [];
  }
}

function writeAll(templates: Template[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function listTemplates(): Template[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTemplate(id: string): Template | undefined {
  return readAll().find((template) => template.id === id);
}

export function createTemplate(input: {
  name: string;
  pdfFileName: string;
  pdfData: string;
}): Template {
  const now = new Date().toISOString();
  const template: Template = {
    id: crypto.randomUUID(),
    name: input.name,
    pdfFileName: input.pdfFileName,
    pdfData: input.pdfData,
    boxes: [],
    createdAt: now,
    updatedAt: now,
  };

  writeAll([...readAll(), template]);
  return template;
}

export function renameTemplate(id: string, name: string): void {
  const templates = readAll().map((template) =>
    template.id === id
      ? { ...template, name, updatedAt: new Date().toISOString() }
      : template,
  );
  writeAll(templates);
}

export function deleteTemplate(id: string): void {
  writeAll(readAll().filter((template) => template.id !== id));
}

export function saveTemplateBoxes(
  id: string,
  boxes: FieldBox[],
): Template | undefined {
  let saved: Template | undefined;
  const templates = readAll().map((template) => {
    if (template.id !== id) return template;
    saved = { ...template, boxes, updatedAt: new Date().toISOString() };
    return saved;
  });
  writeAll(templates);
  return saved;
}

// The exported file is the whole Template, PDF bytes included, so it's a
// complete, self-contained backup — matching the "no backend in v1" design.
export function exportTemplateAsJson(template: Template): void {
  const json = JSON.stringify(template, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${template.name.replace(/[^a-z0-9]+/gi, "_")}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Throws if the file isn't a valid template (untrusted input from disk) —
// callers should catch and show a plain-language error.
export function importTemplateFromJson(json: string): Template {
  const parsed = templateSchema.parse(JSON.parse(json));
  const now = new Date().toISOString();
  // Always assign a fresh id so importing into a browser that already has
  // templates (e.g. sharing between the accountant and his daughter) never
  // silently collides with or overwrites an existing one.
  const imported: Template = { ...parsed, id: crypto.randomUUID(), updatedAt: now };
  writeAll([...readAll(), imported]);
  return imported;
}
