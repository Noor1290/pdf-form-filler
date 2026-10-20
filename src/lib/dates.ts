import type { FieldBox } from "@/types/template";

// A "Date" box prints its date day first, DD/MM/YYYY, the Mauritian way —
// whether the value came from the dashboard ("2026-08-01", how it keeps
// dates) or from the payroll app's PDF fill file ("01/08/2026"). Only a
// value that is clearly a date is changed; anything else prints exactly as
// it is, and what was typed or imported is never changed, only what is
// printed (on the preview and in the PDF).

const pad = (n: number) => String(n).padStart(2, "0");

// A real calendar date, as DD/MM/YYYY, or null.
function dayFirst(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${pad(day)}/${pad(month)}/${year}`;
}

// "2026-08-01", "01/08/2026", "1/8/2026", "01-08-2026" or "01.08.2026" as
// "01/08/2026"; null for anything that is not clearly one date.
export function formatDateDayFirst(value: string): string | null {
  const text = value.trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return dayFirst(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(text);
  if (match) return dayFirst(Number(match[4]), Number(match[3]), Number(match[1]));
  return null;
}

// What a box prints for a value: a Date box's clear date as DD/MM/YYYY,
// everything else exactly as it is.
export function printedValue(box: FieldBox, value: string): string {
  if (box.validationType !== "date") return value;
  return formatDateDayFirst(value) ?? value;
}
