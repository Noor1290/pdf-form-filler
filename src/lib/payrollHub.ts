import { matchEmployerField } from "@/lib/employerProfile";
import { normalizeFieldKey, readImportRows } from "@/lib/importEntries";
import type { EmployerField } from "@/types/template";

// Payroll results handed over by the Payroll Hub dashboard, waiting to be
// imported into a template. Only ever held in React state: never written to
// any browser storage, so a page reload clears it (see hub_docs/INTEGRATION.md).
export type DashboardPayroll = {
  id: string; // tells one delivery from the next, even with identical rows
  rows: Record<string, string>[];
  period?: string; // "YYYY-MM"
};

// Throws an Error whose message is safe to show as-is, both here and on
// the dashboard (which reports it as "Not delivered: <message>").
export function readDashboardPayroll(payload: {
  dataType?: string;
  rows?: unknown;
  meta?: { period?: string };
}): DashboardPayroll {
  if (payload.dataType !== "payroll-result") {
    throw new Error("This app can only use payroll results.");
  }
  const period = payload.meta?.period;
  return {
    id: crypto.randomUUID(),
    rows: readImportRows(payload.rows),
    period: typeof period === "string" && period ? period : undefined,
  };
}

function distinctValues(
  rows: Record<string, string>[],
  column: string,
): string[] {
  const wanted = normalizeFieldKey(column);
  const values = new Set<string>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (normalizeFieldKey(key) === wanted && value.trim()) {
        values.add(value.trim());
      }
    }
  }
  return Array.from(values);
}

export function companyNamesIn(rows: Record<string, string>[]): string[] {
  return distinctValues(rows, "Company Name");
}

export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );
}

const COMPANY_COLUMNS = [
  { column: "Company Name", description: "company name" },
  { column: "BRN", description: "BRN" },
];

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// One plain-language warning per company detail the incoming rows disagree
// with. A detail this template has no value for can't disagree, so it is
// skipped rather than reported.
export function findCompanyMismatches(
  rows: Record<string, string>[],
  employerFields: EmployerField[],
): string[] {
  const warnings: string[] = [];
  for (const { column, description } of COMPANY_COLUMNS) {
    const saved = matchEmployerField(column, employerFields)?.value.trim();
    if (!saved) continue;

    const different = distinctValues(rows, column).filter(
      (value) => !sameText(value, saved),
    );
    if (different.length === 0) continue;

    const incoming = different.map((value) => `"${value}"`).join(", ");
    warnings.push(
      `The ${description} in this data is ${incoming}, but this template's company details say "${saved}".`,
    );
  }
  return warnings;
}
