import type { EmployerField, FieldBox } from "@/types/template";

// How a person in the People list is named on screen: by what was typed in
// their name boxes ("Surname", "Other Names", "Employee name"...), so the
// list says "Person 2: SAMPLETON Alex" rather than only "Person 2". The
// number stays: it is the person's page in the downloaded PDF.

const NAME_WORD = /\bsurname\b|\bnames?\b/i;
// "Company Name", "Name of employer": a name, but not the person's.
const NOT_THE_PERSON = /\b(company|employer|business|trade|trading)\b/i;

// The boxes that hold the person's name, in the order given (the form's
// order, top to bottom). A box filled from the company details is never one.
export function personNameBoxes(
  boxes: readonly FieldBox[],
  employerFields: readonly EmployerField[],
): FieldBox[] {
  const companyLabels = new Set(
    employerFields.map((field) => field.label.trim().toLowerCase()),
  );
  return boxes.filter(
    (box) =>
      NAME_WORD.test(box.name) &&
      !NOT_THE_PERSON.test(box.name) &&
      !companyLabels.has(box.name.trim().toLowerCase()),
  );
}

// "Person 2: SAMPLETON Alex", or "Person 2" when no name box is filled.
export function personLabel(
  nameBoxes: readonly FieldBox[],
  values: Record<string, string>,
  index: number,
): string {
  const name = nameBoxes
    .map((box) => (values[box.id] ?? "").replace(/\s+/g, " ").trim())
    .filter((part) => part !== "")
    .join(" ");
  return name === "" ? `Person ${index + 1}` : `Person ${index + 1}: ${name}`;
}

// The people with at least one value too wide for its box, in page order.
// `measure` gives a printed value's width in PDF points.
export function peopleWithTooLongValues(
  boxes: readonly FieldBox[],
  peopleValues: readonly Record<string, string>[],
  measure: (box: FieldBox, value: string) => number,
  printed: (box: FieldBox, value: string) => string,
): number[] {
  const found: number[] = [];
  peopleValues.forEach((values, index) => {
    const tooLong = boxes.some(
      (box) => measure(box, printed(box, values[box.id] ?? "")) > box.width,
    );
    if (tooLong) found.push(index);
  });
  return found;
}
