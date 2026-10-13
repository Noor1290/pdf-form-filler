import { IMPORTED_KEY } from "@/lib/browserData";
import {
  connectDashboard,
  dashboardCompany,
  dashboardStore,
  describePdf,
  ensureFileThere,
  heldRevision,
  keepLocalValues,
  wireBody,
} from "@/lib/dashboardStore";
import {
  type SavedRow,
  type TemplateRow,
  MAX_PDF_BYTES,
  askHub,
  base64Bytes,
  sendHub,
} from "@/lib/hubWire";
import { listTemplates as listBrowserTemplates } from "@/lib/template";
import type { Template } from "@/types/template";

// The one-time import of the templates kept in this browser into the
// dashboard, for the company selected there. Started by the user, never by
// itself. One template at a time; each is checked after it is stored, and
// only then noted as imported. The browser's own copy is never changed: it
// stays as the fallback, and is what the tool uses when opened on its own.

// Which of this browser's templates were imported, where to, and when.
// Names, ids and dates only: nothing from a form.
export type ImportedNote = {
  dashboardId: string;
  brn: string;
  company: string;
  name: string;
  revision: number;
  importedAt: string;
};
type ImportedNotes = Record<string, ImportedNote>;

export function readImported(): ImportedNotes {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(IMPORTED_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ImportedNotes)
      : {};
  } catch {
    return {};
  }
}

function noteImported(browserId: string, note: ImportedNote): boolean {
  try {
    localStorage.setItem(
      IMPORTED_KEY,
      JSON.stringify({ ...readImported(), [browserId]: note }),
    );
    return true;
  } catch {
    return false;
  }
}

export type ImportChoice = "import" | "replace" | "skip";

export type ImportItem = {
  template: Template;
  bytes: number;
  // Over the dashboard's 5 MB limit: cannot be imported.
  tooLarge: boolean;
  // The dashboard already has a template of this name for this company.
  nameTaken: boolean;
};

// The browser's templates that have not been imported yet.
export function templatesNotImported(): Template[] {
  const imported = readImported();
  return listBrowserTemplates().filter(
    (template) => !(template.id in imported),
  );
}

// What an import would do. Reads only: nothing is written anywhere.
export function planImport(): ImportItem[] {
  const names = new Set(
    dashboardStore
      .listTemplates()
      .map((template) => template.name.toLowerCase()),
  );
  return templatesNotImported().map((template) => {
    const bytes = base64Bytes(template.pdfData);
    return {
      template,
      bytes,
      tooLarge: bytes > MAX_PDF_BYTES,
      nameTaken: names.has(template.name.trim().toLowerCase()),
    };
  });
}

export const defaultChoice = (item: ImportItem): ImportChoice =>
  item.tooLarge || item.nameTaken ? "skip" : "import";

export type ImportOutcome =
  { ok: true; name: string } | { ok: false; name: string; reason: string };

// Imports one template: its file, then the template, then a check that
// what the dashboard now holds is what this browser holds.
export async function importOne(
  item: ImportItem,
  choice: ImportChoice,
): Promise<ImportOutcome> {
  const { template } = item;
  const name = template.name.trim();
  const no = (reason: string): ImportOutcome => ({ ok: false, name, reason });
  const company = dashboardCompany();
  if (!company) return no("The dashboard is not connected.");
  if (choice === "skip") return no("Left as it is.");
  if (item.tooLarge) return no("Its PDF is larger than 5 MB.");

  let described: Awaited<ReturnType<typeof describePdf>>;
  try {
    described = await describePdf(template.pdfData);
  } catch {
    return no("Its PDF could not be read.");
  }
  const file = await ensureFileThere(template.pdfData, described.sha256);
  if (!file.ok) return no(file.error);

  // Replacing saves over the dashboard's template of that name, as its next
  // revision; otherwise it is a new template.
  const existing =
    choice === "replace"
      ? dashboardStore
          .listTemplates()
          .find((held) => held.name.toLowerCase() === name.toLowerCase())
      : undefined;
  const id = existing?.id ?? crypto.randomUUID();
  const expected = existing ? (heldRevision(existing.id) ?? 0) : 0;
  const body = wireBody(template);

  const sent = await sendHub<SavedRow>("pdf-template", {
    action: "save",
    brn: company.brn,
    template_id: id,
    name,
    body,
    expected_revision: expected,
    pdf_sha256: described.sha256,
    pdf_file_name: template.pdfFileName,
    pdf_bytes: described.bytes,
    pdf_pages: described.pages,
  });
  const uncertain =
    !sent.ok && (sent.code === "unavailable" || sent.code === "no-answer");
  if (!sent.ok && !uncertain) return no(sent.error);

  // The check: load it back and compare, field by field and file by hash.
  const back = await askHub<TemplateRow>("pdf-template", {
    action: "load",
    template_id: id,
    brn: company.brn,
  });
  const row = back.ok ? back.rows[0] : undefined;
  if (!row) {
    return no(
      back.ok || back.code === "not-found"
        ? "The dashboard did not store it."
        : back.error,
    );
  }
  const same =
    row.name === name &&
    row.pdf_sha256 === described.sha256 &&
    JSON.stringify(row.body) === JSON.stringify(body);
  if (!same) {
    return no(
      "What the dashboard stored is not the same as this browser's copy. This browser's copy is still the one to use.",
    );
  }

  // The values last typed and the People list stay in this browser, now
  // also under the dashboard template's id.
  keepLocalValues(id, template.values, template.entries);
  const noted = noteImported(template.id, {
    dashboardId: id,
    brn: company.brn,
    company: company.label,
    name,
    revision: row.revision,
    importedAt: new Date().toISOString(),
  });
  if (!noted) {
    return no(
      "It is in the dashboard, but this browser's storage is full, so it could not be noted as imported here.",
    );
  }
  return { ok: true, name };
}

// Runs the chosen imports one after the other, then loads the dashboard's
// templates again so the list shows what is there now.
export async function runImport(
  items: ImportItem[],
  choices: Record<string, ImportChoice>,
  onProgress?: (done: number) => void,
): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  for (const item of items) {
    const choice = choices[item.template.id] ?? defaultChoice(item);
    if (choice !== "skip") outcomes.push(await importOne(item, choice));
    onProgress?.(outcomes.length);
  }
  await connectDashboard();
  return outcomes;
}
