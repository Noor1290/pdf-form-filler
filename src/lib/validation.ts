import { z } from "zod";
import type { FieldBox } from "@/types/template";

// Keywords chosen straight from the roadmap's own example ("contains
// 'amount' -> numeric"); kept short and generic on purpose — see CLAUDE.md
// on not inventing MRA-specific field structure.
const AMOUNT_NAME_KEYWORDS = ["amount", "salary", "total", "sum"];

// A box whose name has the word "date" ("Date of Employment", "Date
// joined") is a Date box: it prints its date as DD/MM/YYYY (see dates.ts).
const DATE_NAME_WORD = /\bdate\b/i;

export function inferValidationType(
  boxName: string,
): NonNullable<FieldBox["validationType"]> {
  if (DATE_NAME_WORD.test(boxName)) return "date";
  const normalized = boxName.toLowerCase();
  return AMOUNT_NAME_KEYWORDS.some((keyword) => normalized.includes(keyword))
    ? "amount"
    : "text";
}

// Accepts plain numbers, negatives, decimals, and thousands separators
// (e.g. "1,234.56") — deliberately permissive since this only warns, never
// blocks or reformats (see CLAUDE.md: amounts stay exactly what was typed).
const amountSchema = z
  .string()
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value.replace(/,/g, "")), {
    message: "This doesn't look like a number.",
  });

// Returns a plain-language warning, or null if the value is fine (including
// when it's empty — an unfilled field isn't "invalid", just incomplete).
export function validateFieldValue(
  validationType: FieldBox["validationType"],
  value: string,
): string | null {
  if (validationType !== "amount") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const result = amountSchema.safeParse(trimmed);
  return result.success ? null : result.error.issues[0].message;
}
