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

// Doesn't bump updatedAt — this fires on every debounced keystroke while
// filling in a form, and reordering the template list mid-typing would be
// disruptive. updatedAt stays reserved for structural changes (boxes/name).
export function saveTemplateValues(
  id: string,
  values: Record<string, string>,
): void {
  const templates = readAll().map((template) =>
    template.id === id ? { ...template, values } : template,
  );
  writeAll(templates);
}

// Doesn't bump updatedAt, same reasoning as saveTemplateValues above — this
// fires on every debounced change while filling in a batch of people.
export function saveTemplateEntries(
  id: string,
  entries: TemplateEntry[],
): void {
  const templates = readAll().map((template) =>
    template.id === id ? { ...template, entries } : template,
  );
  writeAll(templates);
}

export function saveTemplateEmployerFields(
  id: string,
  employerFields: EmployerField[],
): void {
  const templates = readAll().map((template) =>
    template.id === id
      ? { ...template, employerFields, updatedAt: new Date().toISOString() }
      : template,
  );
  writeAll(templates);
}
