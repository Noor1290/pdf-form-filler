import { EMPLOYER_STORAGE_KEYS } from "@/lib/employerProfile";
import { TEMPLATES_STORAGE_KEY } from "@/lib/template";

// Everything this tool keeps in the browser, exactly as it is stored: the
// templates (with their PDFs, fields, company details, typed values and
// people) and the company details saved before they became per-template.
// The light/dark choice is a display preference and is not part of it.
//
// Used by the full backup (see backup.ts), which reads all of it and can
// replace all of it.
export const BROWSER_DATA_KEYS: readonly string[] = [
  TEMPLATES_STORAGE_KEY,
  ...EMPLOYER_STORAGE_KEYS,
];

export type BrowserData = Record<string, string>;

export type ReplaceResult =
  // Replaced.
  | { ok: true }
  // Refused, and the browser holds what it held before.
  | { ok: false; unchanged: true }
  // Refused, and what was there before could not be put back either.
  | { ok: false; unchanged: false };

export function readBrowserData(): BrowserData {
  const data: BrowserData = {};
  for (const key of BROWSER_DATA_KEYS) {
    const text = localStorage.getItem(key);
    if (text !== null) data[key] = text;
  }
  return data;
}

function writeOnly(data: BrowserData) {
  for (const key of BROWSER_DATA_KEYS) localStorage.removeItem(key);
  for (const [key, text] of Object.entries(data)) {
    localStorage.setItem(key, text);
  }
}

// All or nothing: if the browser refuses any write (its storage is full),
// what was there before is put back, so a failed restore never leaves half
// of one set of templates and half of another.
export function replaceBrowserData(next: BrowserData): ReplaceResult {
  if (Object.keys(next).some((key) => !BROWSER_DATA_KEYS.includes(key))) {
    return { ok: false, unchanged: true };
  }

  const before = readBrowserData();
  try {
    writeOnly(next);
    return { ok: true };
  } catch {
    // Falls through to putting the earlier data back.
  }

  try {
    writeOnly(before);
    return { ok: false, unchanged: true };
  } catch {
    return { ok: false, unchanged: false };
  }
}
