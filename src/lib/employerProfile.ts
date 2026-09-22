import type { EmployerProfile } from "@/types/template";

const STORAGE_KEY = "pdf-editor:employer-profile";

const EMPTY_PROFILE: EmployerProfile = {
  companyName: "",
  address: "",
  tan: "",
};

export function getEmployerProfile(): EmployerProfile {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY_PROFILE;
  try {
    return { ...EMPTY_PROFILE, ...JSON.parse(raw) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export function saveEmployerProfile(profile: EmployerProfile): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

// Common ways an accountant might name a box for one of these fields —
// "exact or mapped match" per the roadmap. Kept short and conservative;
// an unmatched box name just means no autofill, never a guess at content.
const FIELD_NAME_ALIASES: Record<keyof EmployerProfile, string[]> = {
  companyName: ["company name", "employer name", "employer", "company"],
  address: ["address", "employer address", "company address"],
  tan: ["tan", "t.a.n", "t.a.n.", "tax account number"],
};

export function matchEmployerField(
  boxName: string,
): keyof EmployerProfile | null {
  const normalized = boxName.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(FIELD_NAME_ALIASES) as Array<
    [keyof EmployerProfile, string[]]
  >) {
    if (aliases.includes(normalized)) return field;
  }
  return null;
}
