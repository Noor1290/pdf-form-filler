import { PDFDocument } from "pdf-lib";
import { DASHBOARD_VALUES_KEY } from "@/lib/browserData";
import {
  type CachedCopy,
  readCachedCopy,
  writeCachedCopy,
} from "@/lib/dashboardCache";
import { getLegacyEmployerFields } from "@/lib/employerProfile";
import {
  type HubFailure,
  type HubMeta,
  type SavedRow,
  type TemplateRow,
  type TemplateSummaryRow,
  MAX_PDF_BYTES,
  askHub,
  base64Bytes,
  base64ToBytes,
  sameJson,
  sendHub,
  sha256Hex,
} from "@/lib/hubWire";
import type { TemplateStore } from "@/lib/templateStore";
import type {
  EmployerField,
  FieldBox,
  Template,
  TemplateEntry,
} from "@/types/template";

// The second store (see templateStore.ts): templates kept in the Payroll
// Hub dashboard's database, their PDF files in its Storage bucket, for the
// company selected there. Used only inside the dashboard.
//
// Screens read and save at once, as they do with the browser store: the
// templates are held in memory here, loaded once when the tool opens. A
// change is shown immediately and sent to the dashboard a moment later:
// one save after the last change, never one per key, and never two at once
// for the same template. `dashboardStatus` says how that is going: Saved,
// Saving, or NOT saved (and why).
//
// NOT sent to the dashboard: the values last typed into a form and the
// People list. They stay in this browser, under their own key, so what is
// typed about people never leaves the computer through this tool.

// How long after the last change a save goes out.
const SAVE_AFTER_MS = 1000;

type Held = {
  template: Template;
  // The revision the dashboard last confirmed; 0 while it has never been saved there.
  revision: number;
  // The PDF's hash and page count, worked out once when first needed.
  sha256: string | null;
  pages: number | null;
  // What the dashboard holds, as text, to know whether anything changed.
  saved: string | null;
};

export type SaveProblem = HubFailure & {
  templateId: string;
  templateName: string;
  // What was being done when it failed.
  doing: "save" | "delete";
};

export type DashboardStatus = {
  state: "saved" | "saving" | "not-saved";
  problems: SaveProblem[];
};

export type LoadProblem = { name: string; reason: string };

let company: HubMeta | null = null;
const held = new Map<string, Held>();
// Files already known to be in the dashboard's bucket for this company.
const filesThere = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Set<string>();
const changedMeanwhile = new Set<string>();
const problems = new Map<string, SaveProblem>();
// Templates deleted here whose delete has not been confirmed yet.
const deleting = new Map<string, Held>();
let loadProblems: LoadProblem[] = [];

// ---------- status, for the screens ----------

let status: DashboardStatus = { state: "saved", problems: [] };
const listeners = new Set<() => void>();

function publish() {
  const busy = timers.size > 0 || inFlight.size > 0;
  status = {
    state: problems.size > 0 ? "not-saved" : busy ? "saving" : "saved",
    problems: [...problems.values()],
  };
  for (const listener of [...listeners]) listener();
}

export const dashboardStatus = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => status,
};

export const dashboardCompany = () => company;
export const dashboardLoadProblems = () => loadProblems;

// ---------- values and people: this browser only ----------

type LocalValues = Record<
  string,
  { values?: Record<string, string>; entries?: TemplateEntry[] }
>;

function readLocalValues(): LocalValues {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(DASHBOARD_VALUES_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as LocalValues)
      : {};
  } catch {
    return {};
  }
}

function writeLocalValues(all: LocalValues): boolean {
  try {
    localStorage.setItem(DASHBOARD_VALUES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

// Puts values and people under a dashboard template's id (the import does
// this once, from the browser's own copy of the template).
export function keepLocalValues(
  templateId: string,
  values: Record<string, string> | undefined,
  entries: TemplateEntry[] | undefined,
): boolean {
  const all = readLocalValues();
  all[templateId] = {
    ...(values ? { values } : {}),
    ...(entries ? { entries } : {}),
  };
  return writeLocalValues(all);
}

// ---------- what crosses the bridge ----------

export function wireBody(template: Template): Record<string, unknown> {
  return {
    boxes: template.boxes,
    ...(template.employerFields !== undefined
      ? { employerFields: template.employerFields }
      : {}),
  };
}

const wireText = (template: Template) =>
  JSON.stringify({ name: template.name, body: wireBody(template) });

function templateOf(
  row: TemplateRow,
  pdfData: string,
  local: LocalValues[string] | undefined,
): Template {
  const body = row.body as {
    boxes?: FieldBox[];
    employerFields?: EmployerField[];
  };
  return {
    id: row.template_id,
    name: row.name,
    pdfFileName: row.pdf_file_name,
    pdfData,
    boxes: Array.isArray(body.boxes) ? body.boxes : [],
    ...(Array.isArray(body.employerFields)
      ? { employerFields: body.employerFields }
      : {}),
    ...(local?.values ? { values: local.values } : {}),
    ...(local?.entries ? { entries: local.entries } : {}),
    createdAt: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// A PDF's hash and number of pages. Throws when it is not a readable PDF.
export async function describePdf(
  pdfData: string,
): Promise<{ sha256: string; pages: number; bytes: number }> {
  const bytes = base64ToBytes(pdfData);
  const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    sha256: await sha256Hex(bytes),
    pages: document.getPageCount(),
    bytes: bytes.length,
  };
}

// ---------- loading ----------

// Loads the selected company's templates and their PDF files from the
// dashboard into memory. Whatever was held before is dropped, unsaved
// changes included, so only call it at the start or when the user asks.
export function connectDashboard(): Promise<
  { ok: true; company: HubMeta } | HubFailure
> {
  // One load at a time: asked twice in the same moment, both get the same answer.
  connecting ??= loadEverything().finally(() => {
    connecting = null;
  });
  return connecting;
}

let connecting: ReturnType<typeof loadEverything> | null = null;

async function loadEverything(): Promise<
  { ok: true; company: HubMeta } | HubFailure
> {
  const list = await askHub<TemplateSummaryRow>("pdf-template", {
    action: "list",
  });
  if (!list.ok) return list;

  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  changedMeanwhile.clear();
  problems.clear();
  deleting.clear();
  held.clear();
  filesThere.clear();
  company = list.meta;
  loadProblems = [];

  const local = readLocalValues();
  const files = new Map<string, string>();
  const loadedRows: TemplateRow[] = [];
  for (const summary of list.rows) {
    const loaded = await askHub<TemplateRow>("pdf-template", {
      action: "load",
      template_id: summary.template_id,
      brn: company.brn,
    });
    if (!loaded.ok || !loaded.rows[0]) {
      loadProblems.push({
        name: summary.name,
        reason: loaded.ok ? "The dashboard no longer has it." : loaded.error,
      });
      continue;
    }
    const row = loaded.rows[0];

    let pdfData = files.get(row.pdf_sha256);
    if (pdfData === undefined) {
      const file = await askHub<{ data: string }>("pdf-file", {
        action: "download",
        sha256: row.pdf_sha256,
        brn: company.brn,
      });
      const data = file.ok ? file.rows[0]?.data : undefined;
      // Never use a file that is not the one the template names.
      const usable =
        typeof data === "string" &&
        (await sha256Hex(base64ToBytes(data))) === row.pdf_sha256;
      if (!usable) {
        loadProblems.push({
          name: row.name,
          reason:
            !file.ok && file.code !== "not-found"
              ? file.error
              : "Its PDF file is missing from the dashboard.",
        });
        continue;
      }
      pdfData = data;
      files.set(row.pdf_sha256, pdfData);
      filesThere.add(row.pdf_sha256);
    }

    loadedRows.push(row);
    const template = templateOf(row, pdfData, local[row.template_id]);
    held.set(template.id, {
      template,
      revision: row.revision,
      sha256: row.pdf_sha256,
      pages: row.pdf_pages,
      saved: wireText(template),
    });
  }
  // Kept for when the dashboard cannot be reached (see dashboardCache.ts). If the
  // browser has no room for it, there is simply no offline copy of this company.
  writeCachedCopy({
    brn: company.brn,
    label: company.label,
    loadedAt: new Date().toISOString(),
    templates: loadedRows,
    files: Object.fromEntries(files),
  });
  publish();
  return { ok: true, company };
}

// ---------- saving ----------

function schedule(id: string) {
  const waiting = timers.get(id);
  if (waiting) clearTimeout(waiting);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void saveNow(id);
    }, SAVE_AFTER_MS),
  );
  publish();
}

const fail = (code: HubFailure["code"], error: string): HubFailure => ({
  ok: false,
  code,
  error,
});

// Makes sure the dashboard has the template's PDF file. Asks first whether
// it is there, so a file is sent once however many templates use it, and an
// upload that went unanswered is not sent again if it did arrive.
export async function ensureFileThere(
  pdfData: string,
  sha256: string,
): Promise<{ ok: true } | HubFailure> {
  if (!company) return fail("unavailable", "The dashboard is not connected.");
  if (filesThere.has(sha256)) return { ok: true };
  if (base64Bytes(pdfData) > MAX_PDF_BYTES) {
    return fail(
      "too-large",
      "This PDF is larger than 5 MB, the largest the dashboard stores.",
    );
  }

  const isThere = async () => {
    const answer = await askHub<{ exists: boolean }>("pdf-file", {
      action: "exists",
      sha256,
      brn: company!.brn,
    });
    return answer.ok ? answer.rows[0]?.exists === true : answer;
  };

  const before = await isThere();
  if (before === true) {
    filesThere.add(sha256);
    return { ok: true };
  }
  if (before !== false) return before;

  const sent = await sendHub("pdf-file", {
    action: "upload",
    brn: company.brn,
    sha256,
    data: pdfData,
  });
  if (!sent.ok) {
    // No clear answer: it may have arrived all the same. Look before saying no.
    const uncertain = sent.code === "unavailable" || sent.code === "no-answer";
    if (!uncertain || (await isThere()) !== true) return sent;
  }
  filesThere.add(sha256);
  return { ok: true };
}

// One save of one template, start to finish.
async function saveOnce(item: Held): Promise<{ ok: true } | HubFailure> {
  if (!company) return fail("unavailable", "The dashboard is not connected.");
  const sending = structuredClone({
    name: item.template.name,
    body: wireBody(item.template),
  });
  const text = JSON.stringify(sending);
  if (text === item.saved) return { ok: true };

  if (item.sha256 === null || item.pages === null) {
    try {
      const described = await describePdf(item.template.pdfData);
      item.sha256 = described.sha256;
      item.pages = described.pages;
    } catch {
      return fail("invalid", "This PDF could not be read.");
    }
  }
  const file = await ensureFileThere(item.template.pdfData, item.sha256);
  if (!file.ok) return file;

  const expected = item.revision;
  const sent = await sendHub<SavedRow>("pdf-template", {
    action: "save",
    brn: company.brn,
    template_id: item.template.id,
    name: sending.name,
    body: sending.body,
    expected_revision: expected,
    pdf_sha256: item.sha256,
    pdf_file_name: item.template.pdfFileName,
    pdf_bytes: base64Bytes(item.template.pdfData),
    pdf_pages: item.pages,
  });
  if (sent.ok) {
    item.revision = sent.result.revision;
    item.saved = text;
    return { ok: true };
  }

  // No clear answer, or "someone saved since": it may be this very save
  // that was stored. Look at what the dashboard holds before deciding.
  const uncertain =
    sent.code === "unavailable" ||
    sent.code === "no-answer" ||
    sent.code === "stale";
  if (!uncertain) return sent;

  const now = await askHub<TemplateRow>("pdf-template", {
    action: "load",
    template_id: item.template.id,
    brn: company.brn,
  });
  if (!now.ok) {
    // A new template that is not there was simply not stored.
    return now.code === "not-found" && expected === 0 ? sent : now;
  }
  const row = now.rows[0];
  if (!row) return sent;
  const theirsIsMine = sameJson({ name: row.name, body: row.body }, sending);
  if (row.revision > expected && theirsIsMine) {
    item.revision = row.revision;
    item.saved = text;
    return { ok: true };
  }
  if (row.revision === expected) return sent;
  return fail(
    "stale",
    "Someone else changed this template in the dashboard since you opened it.",
  );
}

async function saveNow(id: string): Promise<void> {
  if (inFlight.has(id)) {
    changedMeanwhile.add(id);
    return;
  }
  const item = held.get(id);
  if (!item) return;

  inFlight.add(id);
  publish();
  const outcome = await saveOnce(item);
  inFlight.delete(id);

  if (outcome.ok) problems.delete(id);
  else if (held.has(id)) {
    problems.set(id, {
      ...outcome,
      templateId: id,
      templateName: item.template.name,
      doing: "save",
    });
  }
  // Changed again while that save was on its way: one more, with the latest.
  if (changedMeanwhile.delete(id) && outcome.ok && held.has(id)) schedule(id);
  publish();
}

function changed(
  id: string,
  change: (template: Template) => Template,
): boolean {
  const item = held.get(id);
  if (!item) return false;
  item.template = change(item.template);
  schedule(id);
  return true;
}

const stamped = (template: Template): Template => ({
  ...template,
  updatedAt: new Date().toISOString(),
});

async function deleteNow(id: string, item: Held): Promise<void> {
  if (!company) return;
  inFlight.add(id);
  publish();
  const sent =
    item.revision === 0
      ? ({ ok: true } as const)
      : await sendHub("pdf-template", {
          action: "delete",
          brn: company.brn,
          template_id: id,
          expected_revision: item.revision,
        });
  inFlight.delete(id);
  deleting.delete(id);
  if (!sent.ok && sent.code !== "not-found") {
    // Not deleted: it comes back, with the reason.
    held.set(id, item);
    problems.set(id, {
      ...sent,
      templateId: id,
      templateName: item.template.name,
      doing: "delete",
    });
  }
  publish();
}

// ---------- what the screens call ----------

export const dashboardStore: TemplateStore = {
  listTemplates: () =>
    [...held.values()]
      .map((item) => item.template)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

  getTemplate: (id) => held.get(id)?.template,

  createTemplate(input) {
    if (base64Bytes(input.pdfData) > MAX_PDF_BYTES) {
      throw new Error(
        "This PDF is larger than 5 MB, the largest the dashboard stores.",
      );
    }
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
    held.set(template.id, {
      template,
      revision: 0,
      sha256: null,
      pages: null,
      saved: null,
    });
    schedule(template.id);
    return template;
  },

  renameTemplate: (id, name) =>
    changed(id, (template) => stamped({ ...template, name })),

  deleteTemplate(id) {
    const item = held.get(id);
    if (!item) return true;
    const waiting = timers.get(id);
    if (waiting) clearTimeout(waiting);
    timers.delete(id);
    held.delete(id);
    problems.delete(id);
    changedMeanwhile.delete(id);
    deleting.set(id, item);
    void (async () => {
      // A save still on its way has to land first, or its revision is not known.
      while (inFlight.has(id)) await new Promise((r) => setTimeout(r, 50));
      await deleteNow(id, item);
    })();
    publish();
    return true;
  },

  saveTemplateBoxes: (id, boxes) =>
    changed(id, (template) => stamped({ ...template, boxes })),

  saveTemplateEmployerFields: (id, employerFields) =>
    changed(id, (template) => stamped({ ...template, employerFields })),

  // Values and people stay in this browser (see the top of this file).
  saveTemplateValues(id, values) {
    const item = held.get(id);
    if (!item) return false;
    item.template = { ...item.template, values };
    const all = readLocalValues();
    all[id] = { ...all[id], values };
    return writeLocalValues(all);
  },

  saveTemplateEntries(id, entries) {
    const item = held.get(id);
    if (!item) return false;
    item.template = { ...item.template, entries };
    const all = readLocalValues();
    all[id] = { ...all[id], entries };
    return writeLocalValues(all);
  },

  getLegacyEmployerFields,
};

// ---------- what the status notice offers ----------

// "Try saving again": everything that is not saved yet, now.
export async function retrySaving(): Promise<void> {
  const waiting = [...problems.values()];
  for (const problem of waiting) {
    problems.delete(problem.templateId);
    if (problem.doing === "delete") {
      const item = held.get(problem.templateId);
      if (item) dashboardStore.deleteTemplate(problem.templateId);
    } else {
      await saveNow(problem.templateId);
    }
  }
  publish();
}

// After "someone else changed this template": keep what is on this screen,
// and save it as the newest revision, over theirs.
export async function keepMine(templateId: string): Promise<void> {
  const item = held.get(templateId);
  if (!item || !company) return;
  const now = await askHub<TemplateRow>("pdf-template", {
    action: "load",
    template_id: templateId,
    brn: company.brn,
  });
  if (now.ok && now.rows[0]) item.revision = now.rows[0].revision;
  problems.delete(templateId);
  await saveNow(templateId);
}

// After "someone else changed this template": drop what is on this screen
// and take the dashboard's version.
export async function takeTheirs(templateId: string): Promise<void> {
  const item = held.get(templateId);
  if (!item || !company) return;
  const now = await askHub<TemplateRow>("pdf-template", {
    action: "load",
    template_id: templateId,
    brn: company.brn,
  });
  if (!now.ok || !now.rows[0]) return;
  const row = now.rows[0];
  if (row.pdf_sha256 !== item.sha256) {
    // A different form altogether: load everything again.
    await connectDashboard();
    return;
  }
  const template = templateOf(row, item.template.pdfData, {
    values: item.template.values,
    entries: item.template.entries,
  });
  held.set(templateId, {
    ...item,
    template,
    revision: row.revision,
    saved: wireText(template),
  });
  const waiting = timers.get(templateId);
  if (waiting) clearTimeout(waiting);
  timers.delete(templateId);
  problems.delete(templateId);
  publish();
}

// ---------- copy to another company ----------

export type OtherCompany = { brn: string; name: string };

export async function otherCompanies(): Promise<OtherCompany[]> {
  if (!company) return [];
  const answer = await askHub<OtherCompany>("pdf-template", {
    action: "companies",
    brn: company.brn,
  });
  return answer.ok ? answer.rows : [];
}

export async function copyToCompany(
  templateId: string,
  toBrn: string,
  name: string,
): Promise<{ ok: true; company: string } | HubFailure> {
  const item = held.get(templateId);
  if (!item || !company)
    return fail("not-found", "This template is not loaded.");
  // What is copied is what the dashboard holds: save anything waiting first.
  const waiting = timers.get(templateId);
  if (waiting) {
    clearTimeout(waiting);
    timers.delete(templateId);
  }
  await saveNow(templateId);
  const problem = problems.get(templateId);
  if (problem) return problem;

  const sent = await sendHub<{ to_company: string }>("pdf-template", {
    action: "copy-to-company",
    brn: company.brn,
    template_id: templateId,
    to_brn: toBrn,
    new_template_id: crypto.randomUUID(),
    name,
  });
  return sent.ok ? { ok: true, company: sent.result.to_company } : sent;
}

// ---------- for the one-time import (dashboardImport.ts) ----------

export const heldRevision = (templateId: string) =>
  held.get(templateId)?.revision;

export { bytesToBase64 };

// ---------- a template's history ----------

export type RevisionSummary = {
  revision: number;
  name: string;
  saved_at: string;
  saved_by_you: boolean;
};

// The kept revisions of a template, newest first.
export async function templateHistory(
  templateId: string,
): Promise<
  { ok: true; revisions: RevisionSummary[]; current: number } | HubFailure
> {
  const item = held.get(templateId);
  if (!item || !company)
    return fail("not-found", "This template is not loaded.");
  const answer = await askHub<RevisionSummary>("pdf-template", {
    action: "history",
    template_id: templateId,
    brn: company.brn,
  });
  if (!answer.ok) return answer;
  return { ok: true, revisions: answer.rows, current: item.revision };
}

// One kept revision as a template that can be drawn: its fields on its PDF.
// Reading it changes nothing, here or in the dashboard.
export async function loadRevision(
  templateId: string,
  revision: number,
): Promise<{ ok: true; template: Template } | HubFailure> {
  const item = held.get(templateId);
  if (!item || !company)
    return fail("not-found", "This template is not loaded.");
  const answer = await askHub<TemplateRow & { saved_at?: string }>(
    "pdf-template",
    { action: "load", template_id: templateId, revision, brn: company.brn },
  );
  if (!answer.ok) return answer;
  const row = answer.rows[0];
  if (!row) {
    return fail("not-found", "The dashboard no longer has this revision.");
  }

  // An earlier revision may be drawn on an earlier PDF.
  let pdfData = item.template.pdfData;
  if (row.pdf_sha256 !== item.sha256) {
    const file = await askHub<{ data: string }>("pdf-file", {
      action: "download",
      sha256: row.pdf_sha256,
      brn: company.brn,
    });
    const data = file.ok ? file.rows[0]?.data : undefined;
    if (
      typeof data !== "string" ||
      (await sha256Hex(base64ToBytes(data))) !== row.pdf_sha256
    ) {
      return fail(
        "not-found",
        "The PDF of this revision is missing from the dashboard.",
      );
    }
    pdfData = data;
  }
  return {
    ok: true,
    template: templateOf(
      { ...row, updated_at: row.saved_at ?? row.updated_at ?? "" },
      pdfData,
      undefined,
    ),
  };
}

// Makes an earlier revision the newest one. Nothing is deleted or rewritten:
// the dashboard saves it as a new revision, and every earlier one stays.
export async function restoreRevision(
  templateId: string,
  revision: number,
): Promise<{ ok: true; revision: number } | HubFailure> {
  const item = held.get(templateId);
  if (!item || !company)
    return fail("not-found", "This template is not loaded.");
  // The restore names the revision last seen: save anything waiting first.
  const waiting = timers.get(templateId);
  if (waiting) {
    clearTimeout(waiting);
    timers.delete(templateId);
  }
  await saveNow(templateId);
  const problem = problems.get(templateId);
  if (problem) return problem;

  const sent = await sendHub<SavedRow>("pdf-template", {
    action: "restore",
    brn: company.brn,
    template_id: templateId,
    revision,
    expected_revision: item.revision,
  });
  if (!sent.ok) return sent;

  // Show what the dashboard now holds.
  const restored = await loadRevision(templateId, sent.result.revision);
  if (restored.ok) {
    const template: Template = {
      ...restored.template,
      values: item.template.values,
      entries: item.template.entries,
      createdAt: item.template.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const samePdf = restored.template.pdfData === item.template.pdfData;
    held.set(templateId, {
      template,
      revision: sent.result.revision,
      sha256: samePdf ? item.sha256 : null,
      pages: samePdf ? item.pages : null,
      saved: wireText(template),
    });
  } else {
    await connectDashboard();
  }
  publish();
  return { ok: true, revision: sent.result.revision };
}

// ---------- the offline copy: read-only ----------

let offline: { copy: CachedCopy; templates: Map<string, Template> } | null =
  null;

// Opens this browser's last copy of a company's templates. Null when there
// is none (it was never loaded here, or the browser had no room to keep it).
export function openOfflineCopy(
  brn: string,
): { label: string; loadedAt: string } | null {
  const copy = readCachedCopy(brn);
  if (!copy) return null;
  const local = readLocalValues();
  const templates = new Map<string, Template>();
  for (const row of copy.templates) {
    const pdfData = copy.files[row.pdf_sha256];
    if (typeof pdfData !== "string") continue;
    templates.set(
      row.template_id,
      templateOf(row, pdfData, local[row.template_id]),
    );
  }
  offline = { copy, templates };
  return { label: copy.label, loadedAt: copy.loadedAt };
}

// Values and people are kept in this browser, as always.
function keepOffline(
  id: string,
  change: Pick<Template, "values"> | Pick<Template, "entries">,
): boolean {
  const template = offline?.templates.get(id);
  if (!offline || !template) return false;
  offline.templates.set(id, { ...template, ...change });
  const all = readLocalValues();
  all[id] = { ...all[id], ...change };
  return writeLocalValues(all);
}

// The store behind the offline copy. It can be read and filled in. Nothing
// about a template itself can be changed: every such save answers "not
// stored", and the screens do not offer it.
export const offlineStore: TemplateStore = {
  listTemplates: () =>
    [...(offline?.templates.values() ?? [])].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  getTemplate: (id) => offline?.templates.get(id),
  createTemplate() {
    throw new Error("The offline copy is read-only.");
  },
  renameTemplate: () => false,
  deleteTemplate: () => false,
  saveTemplateBoxes: () => false,
  saveTemplateEmployerFields: () => false,
  saveTemplateValues: (id, values) => keepOffline(id, { values }),
  saveTemplateEntries: (id, entries) => keepOffline(id, { entries }),
  getLegacyEmployerFields,
};
