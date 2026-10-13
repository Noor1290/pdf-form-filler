// The messages this tool exchanges with the Payroll Hub dashboard about its
// templates and PDF files (hub_docs/INTEGRATION.md, "PDF form filler:
// templates in the dashboard"). Everything goes through the copied bridge
// file; nothing here talks to a server.

export type HubFailureCode =
  | "stale"
  | "forbidden"
  | "wrong-company"
  | "invalid"
  | "not-found"
  | "too-large"
  | "unavailable"
  // The dashboard did not answer at all (the bridge gave up waiting).
  | "no-answer"
  // An older dashboard that does not know these data types yet.
  | "not-supported";

export type HubFailure = { ok: false; code: HubFailureCode; error: string };

export type HubMeta = { brn: string; label: string; role: "admin" | "member" };

export type HubAnswer<Row> =
  { ok: true; rows: Row[]; meta: HubMeta } | HubFailure;
export type HubSaved<Result> = { ok: true; result: Result } | HubFailure;

export type TemplateSummaryRow = {
  template_id: string;
  name: string;
  revision: number;
  pdf_sha256: string;
  pdf_file_name: string;
  pdf_bytes: number;
  pdf_pages: number;
  updated_at: string;
  updated_by_you: boolean;
};
export type TemplateRow = TemplateSummaryRow & {
  body: Record<string, unknown>;
};
export type SavedRow = { template_id: string; name: string; revision: number };

const KNOWN_CODES: readonly string[] = [
  "stale",
  "forbidden",
  "wrong-company",
  "invalid",
  "not-found",
  "too-large",
  "unavailable",
];

function failureOf(reply: { error?: unknown; code?: unknown }): HubFailure {
  const error = typeof reply.error === "string" ? reply.error : "";
  if (typeof reply.code === "string" && KNOWN_CODES.includes(reply.code)) {
    return { ok: false, code: reply.code as HubFailureCode, error };
  }
  // The dashboard turns a data type it does not know away before looking at
  // it, with a sentence and no code.
  if (/not registered/i.test(error)) {
    return { ok: false, code: "not-supported", error };
  }
  if (/did not answer in time/i.test(error)) {
    return { ok: false, code: "no-answer", error };
  }
  return { ok: false, code: "unavailable", error };
}

function readMeta(meta: unknown): HubMeta | null {
  const { brn, label, role } = (meta ?? {}) as Record<string, unknown>;
  if (typeof brn !== "string" || brn === "") return null;
  return {
    brn,
    label: typeof label === "string" ? label : "",
    role: role === "admin" ? "admin" : "member",
  };
}

export async function askHub<Row>(
  dataType: "pdf-template" | "pdf-file",
  params: Record<string, unknown>,
): Promise<HubAnswer<Row>> {
  const reply = (await window.PayrollHubBridge.sendToDashboard("request-data", {
    dataType,
    params,
  })) as Record<string, unknown>;
  if (reply.ok !== true) return failureOf(reply);
  const meta = readMeta(reply.meta);
  if (!meta || !Array.isArray(reply.rows)) {
    return {
      ok: false,
      code: "unavailable",
      error: "The dashboard's answer could not be read.",
    };
  }
  return { ok: true, rows: reply.rows as Row[], meta };
}

export async function sendHub<Result>(
  dataType: "pdf-template" | "pdf-file",
  row: Record<string, unknown>,
): Promise<HubSaved<Result>> {
  const reply = (await window.PayrollHubBridge.sendToDashboard("send-data", {
    dataType,
    rows: [row],
  })) as Record<string, unknown>;
  if (reply.ok !== true) return failureOf(reply);
  return { ok: true, result: (reply.result ?? {}) as Result };
}

// ---------- bytes, base64 and the hash a file is named by ----------

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// The largest PDF the dashboard stores.
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

// The size in bytes of a file held as base64 text.
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// Whether two JSON values hold the same thing. The database does not keep
// the order of an object's properties (it returns them in its own order),
// so what comes back is compared by content, never as text.
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && sameJson(left[key], right[key]))
  );
}
