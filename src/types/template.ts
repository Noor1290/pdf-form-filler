export type FieldBox = {
  id: string;
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: "Helvetica" | "Times-Roman" | "Courier";
  bold: boolean;
  align: "left" | "center" | "right";
  color: string; // hex
  // Older saved templates predate this field, so treat a missing value the
  // same as "text" everywhere it's read rather than assuming it's set.
  validationType?: "text" | "amount";
};

export type Template = {
  id: string;
  name: string; // e.g. "Statement of Emoluments 2026"
  pdfFileName: string;
  pdfData: string; // base64-encoded PDF bytes, so the template is self-contained in localStorage
  boxes: FieldBox[];
  // Last-typed values for this template's fields, keyed by box id — persists
  // across visits so leaving and coming back shows what was last filled in.
  // Older saved templates predate this field, so treat a missing value the
  // same as "no values yet" (empty object) everywhere it's read.
  values?: Record<string, string>;
  // People added via "Add & fill next person" for a multi-page download —
  // persists across visits so navigating away mid-batch doesn't lose them.
  // Older saved templates predate this field, so treat a missing value the
  // same as "no one added yet" (empty array) everywhere it's read.
  entries?: TemplateEntry[];
  // Company/employer details (name, address, TAN, ...) used to autofill
  // this template's matching fields — specific to this template, not shared
  // across every template. `undefined` means this template hasn't gone
  // through the one-time "copy from your existing details, or start blank"
  // choice yet (see CompanyDetailsPanel), not "no fields" — an empty array
  // is a deliberate "no fields" state after that choice is made.
  employerFields?: EmployerField[];
  createdAt: string;
  updatedAt: string;
};

export type TemplateEntry = {
  id: string;
  values: Record<string, string>;
};

// A single employer-level fact (company name, TAN, ...) that doesn't vary
// per person. The user can rename, add, and remove these freely from the
// settings screen — `id` is what matching/storage keys off, `label` is
// just what it's called on screen right now.
export type EmployerField = {
  id: string;
  label: string;
  value: string;
};
