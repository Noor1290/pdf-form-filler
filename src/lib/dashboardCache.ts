import type { TemplateRow } from "@/lib/hubWire";

// The last copy of a company's templates this browser loaded from the
// dashboard, kept so they can still be opened, read-only, when the
// dashboard cannot be reached. One copy per company, replaced each time
// that company's templates are loaded.
//
// It holds what the dashboard holds: the templates' fields and company
// details and their PDF files. Never the values typed into a form or the
// People list, which have their own key and never leave this browser.
//
// A copy that cannot be stored (the browser's storage is full) is simply
// not kept: an older copy of that company is removed rather than left to
// pass for the latest, and no offline copy is offered for it.

const PREFIX = "pdf-editor:dashboard-cache:";

export type CachedCopy = {
  brn: string;
  label: string;
  // When it was loaded from the dashboard, as an ISO date and time.
  loadedAt: string;
  templates: TemplateRow[];
  // sha256 -> the PDF file, as base64.
  files: Record<string, string>;
};

export type CachedCopySummary = Pick<
  CachedCopy,
  "brn" | "label" | "loadedAt"
> & {
  templates: number;
};

const keyFor = (brn: string) => `${PREFIX}${brn.trim().toUpperCase()}`;

function isCopy(value: unknown): value is CachedCopy {
  const copy = value as Partial<CachedCopy> | null;
  return (
    typeof copy === "object" &&
    copy !== null &&
    typeof copy.brn === "string" &&
    typeof copy.label === "string" &&
    typeof copy.loadedAt === "string" &&
    !Number.isNaN(Date.parse(copy.loadedAt)) &&
    Array.isArray(copy.templates) &&
    typeof copy.files === "object" &&
    copy.files !== null
  );
}

// Says whether the copy was stored.
export function writeCachedCopy(copy: CachedCopy): boolean {
  const key = keyFor(copy.brn);
  try {
    localStorage.setItem(key, JSON.stringify(copy));
    return true;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Nothing more can be done; the copy is not offered if it cannot be read.
    }
    return false;
  }
}

export function readCachedCopy(brn: string): CachedCopy | null {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(keyFor(brn)) ?? "null",
    );
    return isCopy(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Every company this browser has a copy for, newest first.
export function listCachedCopies(): CachedCopySummary[] {
  const found: CachedCopySummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const copy = readCachedCopy(key.slice(PREFIX.length));
      if (!copy) continue;
      found.push({
        brn: copy.brn,
        label: copy.label,
        loadedAt: copy.loadedAt,
        templates: copy.templates.length,
      });
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => b.loadedAt.localeCompare(a.loadedAt));
}

// "13 October 2026 at 18:22", in this computer's own time.
export function formatLoadedAt(loadedAt: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(loadedAt));
}
