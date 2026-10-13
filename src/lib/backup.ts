import {
  type BrowserData,
  type ReplaceResult,
  BROWSER_DATA_KEYS,
  readBrowserData,
  replaceBrowserData,
} from "@/lib/browserData";
import { EMPLOYER_STORAGE_KEYS } from "@/lib/employerProfile";
import { TEMPLATES_STORAGE_KEY } from "@/lib/template";

// Full backup of everything this tool keeps in the browser, as one JSON
// file: every template with its PDF, fields, company details, the values
// last typed and the People list, plus the company details saved before
// they became per-template.
//
// It exists because the browser is the only place this data lives:
// clearing site data, a new computer or a new browser loses it.
//
// Nothing is tidied on the way out or on the way in: the file holds what is
// stored, and a restore stores what the file holds. A backup therefore
// holds whatever was typed into the forms, people's details included.

export const BACKUP_APP_ID = "pdf-form-filler-backup";
export const BACKUP_VERSION = 1;

export type Backup = {
  _meta: { app: typeof BACKUP_APP_ID; version: number; exportedAt?: string };
  // { storage key: the value stored under it }
  stored: Record<string, unknown>;
  // { storage key: the stored text } for anything that is not JSON, or not
  // written the way the tool writes it: carried along as it is, not dropped.
  unreadable: Record<string, string>;
};

export type BackupSummary = {
  exportedAt: string | null;
  templates: { id: string; name: string; fields: number; people: number }[];
  // Company details saved before they became per-template.
  hasEarlierCompanyDetails: boolean;
  unreadableCount: number;
};

export type ParsedBackup =
  | { valid: true; backup: Backup }
  | { valid: false; error: string };

const NOT_A_BACKUP =
  'This file is not a backup of this tool. Choose a file saved with "Back up".';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseStored(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Builds the backup from what the browser holds right now.
export function buildBackup(now: Date = new Date()): Backup {
  const backup: Backup = {
    _meta: {
      app: BACKUP_APP_ID,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
    },
    stored: {},
    unreadable: {},
  };
  for (const [key, text] of Object.entries(readBrowserData())) {
    const value = parseStored(text);
    // Only text that reads back to exactly itself is kept as a value; the
    // rest is kept as text, so a restore always stores what was stored.
    if (value === undefined || JSON.stringify(value) !== text) {
      backup.unreadable[key] = text;
    } else {
      backup.stored[key] = value;
    }
  }
  return backup;
}

export function buildBackupFilename(now: Date = new Date()): string {
  return `pdf-form-filler-backup-${now.toISOString().slice(0, 10)}.json`;
}

// Triggers a normal browser file download of the backup.
export function downloadBackup(backup: Backup, filename: string) {
  const blob = new Blob([JSON.stringify(backup)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function checkTemplates(templates: unknown): string | null {
  if (!Array.isArray(templates)) return "its templates are not a list";
  for (const template of templates) {
    if (!isObject(template)) return "one of its templates is not in the expected form";
    if (typeof template.id !== "string" || template.id === "") {
      return "one of its templates has no id";
    }
    if (typeof template.name !== "string") {
      return "one of its templates has no name";
    }
    if (typeof template.pdfData !== "string" || template.pdfData === "") {
      return `the template "${template.name}" has no PDF`;
    }
    if (!Array.isArray(template.boxes)) {
      return `the template "${template.name}" has no list of fields`;
    }
  }
  return null;
}

function checkKeys(backup: Backup): string | null {
  const keys = [...Object.keys(backup.stored), ...Object.keys(backup.unreadable)];
  if (keys.some((key) => !BROWSER_DATA_KEYS.includes(key))) {
    return "it holds something this tool does not keep";
  }
  if (Object.values(backup.unreadable).some((text) => typeof text !== "string")) {
    return "it is not in the expected form";
  }
  if (TEMPLATES_STORAGE_KEY in backup.stored) {
    return checkTemplates(backup.stored[TEMPLATES_STORAGE_KEY]);
  }
  return null;
}

// Reads and checks the text of a chosen file. The error is worded for the
// person choosing the file.
export function parseBackupText(text: string): ParsedBackup {
  const parsed = parseStored(text);
  if (!isObject(parsed) || !isObject(parsed._meta)) {
    return { valid: false, error: NOT_A_BACKUP };
  }
  const meta = parsed._meta;
  if (meta.app !== BACKUP_APP_ID) return { valid: false, error: NOT_A_BACKUP };
  if (meta.version !== BACKUP_VERSION) {
    return {
      valid: false,
      error:
        "This backup was made by a different version of this tool and cannot be restored here. Nothing was changed.",
    };
  }

  const stored = parsed.stored ?? {};
  const unreadable = parsed.unreadable ?? {};
  if (!isObject(stored) || !isObject(unreadable)) {
    return {
      valid: false,
      error:
        "This backup cannot be restored: it is not in the expected form. Nothing was changed.",
    };
  }
  const backup: Backup = {
    _meta: {
      app: BACKUP_APP_ID,
      version: BACKUP_VERSION,
      exportedAt:
        typeof meta.exportedAt === "string" ? meta.exportedAt : undefined,
    },
    stored,
    unreadable: unreadable as Record<string, string>,
  };

  const problem = checkKeys(backup);
  if (problem) {
    return {
      valid: false,
      error: `This backup cannot be restored: ${problem}. Nothing was changed.`,
    };
  }
  if (
    Object.keys(backup.stored).length === 0 &&
    Object.keys(backup.unreadable).length === 0
  ) {
    return {
      valid: false,
      error: "This backup is empty: it holds no templates. Nothing was changed.",
    };
  }
  return { valid: true, backup };
}

export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { valid: false, error: "Could not read that file." };
  }
  return parseBackupText(text);
}

// What a backup holds, for showing before anything is replaced.
export function summarizeBackup(backup: Backup): BackupSummary {
  const templates = backup.stored[TEMPLATES_STORAGE_KEY];
  const list = Array.isArray(templates) ? templates : [];
  return {
    exportedAt: backup._meta.exportedAt ?? null,
    templates: list.filter(isObject).map((template) => ({
      id: String(template.id),
      name: String(template.name),
      fields: Array.isArray(template.boxes) ? template.boxes.length : 0,
      people: Array.isArray(template.entries) ? template.entries.length : 0,
    })),
    hasEarlierCompanyDetails: Object.keys(backup.stored).some((key) =>
      (EMPLOYER_STORAGE_KEYS as readonly string[]).includes(key),
    ),
    unreadableCount: Object.keys(backup.unreadable).length,
  };
}

// The same summary for what this browser holds right now.
export function summarizeBrowser(): BackupSummary {
  return summarizeBackup(buildBackup());
}

// When a backup was saved, in this computer's own time:
// "13 October 2026 at 10:15". Null when the file does not say.
export function formatSavedAt(exportedAt: string | null): string | null {
  const date = exportedAt ? new Date(exportedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

// Replaces everything in this browser with the backup. All or nothing: see
// replaceBrowserData for what comes back.
export function restoreBackup(backup: Backup): ReplaceResult {
  const next: BrowserData = { ...backup.unreadable };
  for (const [key, value] of Object.entries(backup.stored)) {
    next[key] = JSON.stringify(value);
  }
  return replaceBrowserData(next);
}
