import type { EmployerField } from "@/types/template";

const FIELDS_STORAGE_KEY = "pdf-editor:employer-fields";
// Predate the free-form field list below — read once to migrate anyone's
// existing saved data, then never written to again.
const LEGACY_PROFILE_KEY = "pdf-editor:employer-profile";
const LEGACY_LABELS_KEY = "pdf-editor:employer-field-labels";

const DEFAULT_FIELDS: EmployerField[] = [
  { id: "companyName", label: "Company Name", value: "" },
  { id: "address", label: "Address", value: "" },
  { id: "tan", label: "TAN", value: "" },
];

function migrateLegacyFields(): EmployerField[] | null {
  const legacyProfileRaw = localStorage.getItem(LEGACY_PROFILE_KEY);
  const legacyLabelsRaw = localStorage.getItem(LEGACY_LABELS_KEY);
  if (!legacyProfileRaw && !legacyLabelsRaw) return null;

  try {
    const profile = legacyProfileRaw ? JSON.parse(legacyProfileRaw) : {};
    const labels = legacyLabelsRaw ? JSON.parse(legacyLabelsRaw) : {};
    return DEFAULT_FIELDS.map((field) => ({
      id: field.id,
      label: labels[field.id] ?? field.label,
      value: profile[field.id] ?? "",
    }));
  } catch {
    return null;
  }
}

export function getEmployerFields(): EmployerField[] {
  const raw = localStorage.getItem(FIELDS_STORAGE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return DEFAULT_FIELDS;
    }
  }

  return migrateLegacyFields() ?? DEFAULT_FIELDS;
}

export function saveEmployerFields(fields: EmployerField[]): void {
  localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify(fields));
  // Once saved in the new format there's nothing left to migrate from.
  localStorage.removeItem(LEGACY_PROFILE_KEY);
  localStorage.removeItem(LEGACY_LABELS_KEY);
}

// Common ways an accountant might name a box for one of the three fields
// every template starts with — "exact or mapped match" per the roadmap.
// Fields the user adds themselves have no built-in aliases; they only match
// by their current label, same as a renamed default field would.
const FIELD_NAME_ALIASES: Record<string, string[]> = {
  companyName: ["company name", "employer name", "employer", "company"],
  address: ["address", "employer address", "company address"],
  tan: ["tan", "t.a.n", "t.a.n.", "tax account number"],
};

export function matchEmployerField(
  boxName: string,
  fields: EmployerField[],
): EmployerField | null {
  const normalized = boxName.trim().toLowerCase();
  for (const field of fields) {
    const aliases = FIELD_NAME_ALIASES[field.id] ?? [];
    if (aliases.includes(normalized)) return field;
    if (field.label.trim().toLowerCase() === normalized) return field;
  }
  return null;
}
