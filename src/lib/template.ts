import type {
  EmployerField,
  FieldBox,
  Template,
  TemplateEntry,
} from "@/types/template";

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

// Says whether the write went through. The browser refuses it when its
// storage for this site is full, and a refused save must never pass for a
// saved one: every function below hands this answer back to its caller.
function writeAll(templates: Template[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return true;
  } catch {
    return false;
  }
}

export function listTemplates(): Template[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getTemplate(id: string): Template | undefined {
  return readAll().find((template) => template.id === id);
}

// Throws when the template could not be stored, so the caller never goes on
// with a template that does not exist.
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

  if (!writeAll([...readAll(), template])) {
    throw new Error("The template could not be stored.");
  }
  return template;
}

export function renameTemplate(id: string, name: string): boolean {
  const templates = readAll().map((template) =>
    template.id === id
      ? { ...template, name, updatedAt: new Date().toISOString() }
      : template,
  );
  return writeAll(templates);
}

export function deleteTemplate(id: string): boolean {
  return writeAll(readAll().filter((template) => template.id !== id));
}

export function saveTemplateBoxes(id: string, boxes: FieldBox[]): boolean {
  const templates = readAll().map((template) =>
    template.id === id
      ? { ...template, boxes, updatedAt: new Date().toISOString() }
      : template,
  );
  return writeAll(templates);
}

// Doesn't bump updatedAt — this fires on every debounced keystroke while
// filling in a form, and reordering the template list mid-typing would be
// disruptive. updatedAt stays reserved for structural changes (boxes/name).
export function saveTemplateValues(
  id: string,
  values: Record<string, string>,
): boolean {
  const templates = readAll().map((template) =>
    template.id === id ? { ...template, values } : template,
  );
  return writeAll(templates);
}

// Doesn't bump updatedAt, same reasoning as saveTemplateValues above — this
// fires on every debounced change while filling in a batch of people.
export function saveTemplateEntries(
  id: string,
  entries: TemplateEntry[],
): boolean {
  const templates = readAll().map((template) =>
    template.id === id ? { ...template, entries } : template,
  );
  return writeAll(templates);
}

export function saveTemplateEmployerFields(
  id: string,
  employerFields: EmployerField[],
): boolean {
  const templates = readAll().map((template) =>
    template.id === id
      ? { ...template, employerFields, updatedAt: new Date().toISOString() }
      : template,
  );
  return writeAll(templates);
}
