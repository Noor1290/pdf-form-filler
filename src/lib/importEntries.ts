import type { FieldBox } from "@/types/template";

// Thrown only with messages already safe to show a non-technical user
// directly (see CLAUDE.md: errors worded for a non-developer) — callers can
// just display `.message`.
export class ImportFileError extends Error {}

export type ParsedImport = {
  // One object per row/person, keyed by FieldBox id — same shape as a
  // manually-added TemplateEntry's `values`, so it can be used directly.
  entries: Record<string, string>[];
  matchedColumns: string[];
  unmatchedColumns: string[];
};

// Case/spacing-insensitive so "Basic Salary", "basicSalary", and
// "basic_salary" all match the same field.
export function normalizeFieldKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function buildBoxLookup(boxes: FieldBox[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const box of boxes) {
    lookup.set(normalizeFieldKey(box.name), box.id);
  }
  return lookup;
}

// Minimal RFC4180-style CSV parser — handles quoted fields (including
// embedded commas, newlines, and "" escaped quotes) and both CRLF/LF line
// endings, which is as much as a typical payroll export needs.
function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\r") {
      // Swallowed — the paired "\n" (or its absence at EOF) drives row ends.
    } else if (char === "\n") {
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows.filter((cols) => !(cols.length === 1 && cols[0] === ""));
}

function parseCsvRows(text: string): Record<string, string>[] {
  const table = parseCsvTable(text);
  if (table.length === 0) {
    throw new ImportFileError("This file doesn't have any rows to import.");
  }
  const [headerRow, ...dataRows] = table;
  if (dataRows.length === 0) {
    throw new ImportFileError(
      "This file only has a header row — add at least one person below it.",
    );
  }
  return dataRows.map((cols) => {
    const row: Record<string, string> = {};
    headerRow.forEach((header, index) => {
      row[header] = cols[index] ?? "";
    });
    return row;
  });
}

function parseJsonRows(text: string): Record<string, string>[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportFileError("This file doesn't look like a valid JSON file.");
  }
  return readRowList(data, "file");
}

// Everything a JSON import checks once the text has been parsed. Data that
// arrives already parsed (from the Payroll Hub dashboard) comes through
// here too, so it is held to exactly the same rules as a file — only the
// wording differs, since there is no file to mention.
function readRowList(
  data: unknown,
  source: "file" | "data",
): Record<string, string>[] {
  if (!Array.isArray(data)) {
    throw new ImportFileError(
      source === "file"
        ? "This JSON file should contain a list of entries, one per person."
        : "This data should contain a list of entries, one per person.",
    );
  }
  if (data.length === 0) {
    throw new ImportFileError(
      `This ${source} doesn't have any entries to import.`,
    );
  }
  return data.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new ImportFileError(
        `Entry ${index + 1} in this ${source} isn't in the right format.`,
      );
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      row[key] = value === null || value === undefined ? "" : String(value);
    }
    return row;
  });
}

function matchRowsToBoxes(
  rawRows: Record<string, string>[],
  boxes: FieldBox[],
): ParsedImport {
  const lookup = buildBoxLookup(boxes);

  const allColumns = new Set<string>();
  for (const row of rawRows) {
    for (const column of Object.keys(row)) allColumns.add(column);
  }

  const matchedColumns: string[] = [];
  const unmatchedColumns: string[] = [];
  for (const column of allColumns) {
    if (lookup.has(normalizeFieldKey(column))) matchedColumns.push(column);
    else unmatchedColumns.push(column);
  }

  const entries = rawRows.map((row) => {
    const values: Record<string, string> = {};
    for (const [column, value] of Object.entries(row)) {
      const boxId = lookup.get(normalizeFieldKey(column));
      if (boxId) values[boxId] = value;
    }
    return values;
  });

  return { entries, matchedColumns, unmatchedColumns };
}

// Picks CSV vs JSON from the file extension, falling back to sniffing the
// content for a leading "[" so a misnamed file still works.
export function parseImportFile(
  fileName: string,
  text: string,
  boxes: FieldBox[],
): ParsedImport {
  const isJson =
    /\.json$/i.test(fileName) ||
    (!/\.csv$/i.test(fileName) && text.trimStart().startsWith("["));

  const rawRows = isJson ? parseJsonRows(text) : parseCsvRows(text);
  return matchRowsToBoxes(rawRows, boxes);
}

export function readImportRows(rows: unknown): Record<string, string>[] {
  return readRowList(rows, "data");
}

export function parseImportRows(rows: unknown, boxes: FieldBox[]): ParsedImport {
  return matchRowsToBoxes(readImportRows(rows), boxes);
}
