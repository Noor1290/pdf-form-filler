import { z } from "zod";
import type { FieldBox, Template } from "@/types/template";

// Keywords chosen straight from the roadmap's own example ("contains
// 'amount' -> numeric"); kept short and generic on purpose — see CLAUDE.md
// on not inventing MRA-specific field structure.
const AMOUNT_NAME_KEYWORDS = ["amount", "salary", "total", "sum"];

export function inferValidationType(
  boxName: string,
): NonNullable<FieldBox["validationType"]> {
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

// Validates a Template imported from a .json file (see roadmap Step 10) —
// this is untrusted input from disk, unlike the app's own localStorage.
const fieldBoxSchema = z.object({
  id: z.string(),
  name: z.string(),
  page: z.number(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  fontSize: z.number(),
  fontFamily: z.enum(["Helvetica", "Times-Roman", "Courier"]),
  bold: z.boolean(),
  align: z.enum(["left", "center", "right"]),
  color: z.string(),
  validationType: z.enum(["text", "amount"]).optional(),
}) satisfies z.ZodType<FieldBox>;

export const templateSchema = z.object({
  id: z.string(),
  name: z.string(),
  pdfFileName: z.string(),
  pdfData: z.string(),
  boxes: z.array(fieldBoxSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Template>;
