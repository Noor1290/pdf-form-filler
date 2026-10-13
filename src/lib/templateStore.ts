import { getLegacyEmployerFields } from "@/lib/employerProfile";
import * as browserTemplates from "@/lib/template";
import type {
  EmployerField,
  FieldBox,
  Template,
  TemplateEntry,
} from "@/types/template";

// The one way the app reads and saves its templates.
//
// Screens never touch the browser's storage themselves: they call the
// operations below, and a "store" carries them out. Today there is one
// store, the browser (template.ts and employerProfile.ts), so the tool
// behaves exactly as it always has. When it later saves through the Payroll
// Hub dashboard, that is a second store with the same operations, chosen
// here, and no screen has to change.
//
// Every save answers whether it was stored. A refused save must never pass
// for a saved one (see SaveFailedDialog).
export type TemplateStore = {
  listTemplates(): Template[];
  getTemplate(id: string): Template | undefined;
  // Throws when the template could not be stored.
  createTemplate(input: {
    name: string;
    pdfFileName: string;
    pdfData: string;
  }): Template;
  renameTemplate(id: string, name: string): boolean;
  deleteTemplate(id: string): boolean;
  saveTemplateBoxes(id: string, boxes: FieldBox[]): boolean;
  saveTemplateValues(id: string, values: Record<string, string>): boolean;
  saveTemplateEntries(id: string, entries: TemplateEntry[]): boolean;
  saveTemplateEmployerFields(id: string, fields: EmployerField[]): boolean;
  // The company details saved before they became per-template; offered once
  // as a starting point (see CompanyDetailsPanel).
  getLegacyEmployerFields(): EmployerField[];
};

export const STORE_OPERATIONS = [
  "listTemplates",
  "getTemplate",
  "createTemplate",
  "renameTemplate",
  "deleteTemplate",
  "saveTemplateBoxes",
  "saveTemplateValues",
  "saveTemplateEntries",
  "saveTemplateEmployerFields",
  "getLegacyEmployerFields",
] as const satisfies readonly (keyof TemplateStore)[];

export const browserStore: TemplateStore = {
  listTemplates: browserTemplates.listTemplates,
  getTemplate: browserTemplates.getTemplate,
  createTemplate: browserTemplates.createTemplate,
  renameTemplate: browserTemplates.renameTemplate,
  deleteTemplate: browserTemplates.deleteTemplate,
  saveTemplateBoxes: browserTemplates.saveTemplateBoxes,
  saveTemplateValues: browserTemplates.saveTemplateValues,
  saveTemplateEntries: browserTemplates.saveTemplateEntries,
  saveTemplateEmployerFields: browserTemplates.saveTemplateEmployerFields,
  getLegacyEmployerFields,
};

let current: TemplateStore = browserStore;

// Chooses the store every later call goes to, and returns the one it
// replaces so it can be put back. A store that lacks an operation is
// refused here, not later in the middle of someone's work.
export function setTemplateStore(store: TemplateStore): TemplateStore {
  const missing = STORE_OPERATIONS.filter(
    (name) => typeof store?.[name] !== "function",
  );
  if (missing.length > 0) {
    throw new Error(
      `This store cannot be used: it has no ${missing.join(", ")}.`,
    );
  }
  const previous = current;
  current = store;
  return previous;
}

// Back to the browser, the store the tool starts with.
export function resetTemplateStore(): TemplateStore {
  return setTemplateStore(browserStore);
}

// What the screens call. Each call goes to whichever store is chosen at
// that moment.
export const templateStore: TemplateStore = {
  listTemplates: () => current.listTemplates(),
  getTemplate: (id) => current.getTemplate(id),
  createTemplate: (input) => current.createTemplate(input),
  renameTemplate: (id, name) => current.renameTemplate(id, name),
  deleteTemplate: (id) => current.deleteTemplate(id),
  saveTemplateBoxes: (id, boxes) => current.saveTemplateBoxes(id, boxes),
  saveTemplateValues: (id, values) => current.saveTemplateValues(id, values),
  saveTemplateEntries: (id, entries) =>
    current.saveTemplateEntries(id, entries),
  saveTemplateEmployerFields: (id, fields) =>
    current.saveTemplateEmployerFields(id, fields),
  getLegacyEmployerFields: () => current.getLegacyEmployerFields(),
};
