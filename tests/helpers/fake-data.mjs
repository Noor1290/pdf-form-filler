// Everything in here is invented for testing. No real employee, employer or
// form appears anywhere in this repository (see CLAUDE.md).
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";

export const COMPANY = {
  name: "Fakeco Test Ltd",
  brn: "C00000001",
  tan: "T00000001",
  address: "1 Sample Street, Testville",
};

// Same shape as the payroll export the dashboard forwards: one object per
// person, company fields repeated on every row. Amounts are deliberately
// written in different styles, because the app must never reformat them.
export const PAYROLL_ROWS = [
  {
    ID: "E001",
    Surname: "Testperson",
    "Other Names": "Alpha",
    "Basic Salary": "50,000.00",
    "Net Pay": "43250.75",
    "Company Name": COMPANY.name,
    BRN: COMPANY.brn,
  },
  {
    ID: "E002",
    Surname: "Sampleton",
    "Other Names": "Beta Gamma",
    "Basic Salary": "61250.50",
    "Net Pay": "52,000",
    "Company Name": COMPANY.name,
    BRN: COMPANY.brn,
  },
  {
    ID: "E003",
    Surname: "Placeholder",
    "Other Names": "Delta",
    "Basic Salary": "7000",
    "Net Pay": "6,650.00",
    "Company Name": COMPANY.name,
    BRN: COMPANY.brn,
  },
];

export const OTHER_PAYROLL_ROWS = [
  {
    ID: "E101",
    Surname: "Mockwell",
    "Other Names": "Epsilon",
    "Basic Salary": "30,500.00",
    "Net Pay": "27000",
    "Company Name": "Otherfake Holdings Ltd",
    BRN: "C99999999",
  },
  {
    ID: "E102",
    Surname: "Dummyford",
    "Other Names": "Zeta",
    "Basic Salary": "45000",
    "Net Pay": "39,875.25",
    "Company Name": "Otherfake Holdings Ltd",
    BRN: "C99999999",
  },
];

// The same people as a CSV, with headers written differently on purpose
// (case, spaces, underscores) to exercise the column matching.
export const PAYROLL_CSV = [
  "id,SURNAME,other_names,basic-salary,Net Pay,Department",
  'E201,Csvperson,"Eta, Theta","12,345.00",11000,Testing',
  "E202,Rowley,Iota,9000,8100.50,Samples",
  "",
].join("\n");

function field(id, name, x, y, width, height, style = {}) {
  return {
    id,
    name,
    page: 1,
    x,
    y,
    width,
    height,
    fontSize: 12,
    fontFamily: "Helvetica",
    bold: false,
    align: "left",
    color: "#000000",
    validationType: "text",
    ...style,
  };
}

// One field of every kind the app can draw: each font, bold and regular,
// each alignment, a colour, and both field types.
export const FIELDS = [
  field("f-company", "Company Name", 150, 90, 300, 18, { fontSize: 9 }),
  field("f-tan", "TAN", 150, 115, 150, 18, {
    fontFamily: "Courier",
    bold: true,
    fontSize: 10,
  }),
  field("f-surname", "Surname", 150, 150, 200, 20),
  field("f-other", "Other Names", 150, 180, 200, 20, {
    fontFamily: "Times-Roman",
    fontSize: 11,
  }),
  field("f-basic", "Basic Salary", 150, 240, 120, 18, {
    fontFamily: "Courier",
    fontSize: 10,
    align: "right",
    validationType: "amount",
  }),
  field("f-net", "Net Pay", 300, 240, 120, 18, {
    bold: true,
    align: "center",
    color: "#1a3c8f",
    validationType: "amount",
  }),
];

export const COMPANY_DETAILS = [
  { id: "companyName", label: "Company Name", value: COMPANY.name },
  { id: "address", label: "Address", value: COMPANY.address },
  { id: "tan", label: "TAN", value: COMPANY.tan },
  { id: "custom-brn", label: "BRN", value: COMPANY.brn },
];

// A blank made-up form. `rotated` saves the page with /Rotate 90, the case
// the export code has special coordinate handling for.
export async function buildSamplePdf({ rotated = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("SAMPLE FORM - TEST DATA ONLY", { x: 50, y: 800, size: 14, font });
  page.drawText("Employer:", { x: 50, y: 745, size: 10, font });
  page.drawText("Employee:", { x: 50, y: 680, size: 10, font });
  page.drawText("Amounts:", { x: 50, y: 590, size: 10, font });
  if (rotated) page.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

export function makeTemplate(pdfBytes, overrides = {}) {
  return {
    id: "tpl-fake-form",
    name: "Fake Form",
    pdfFileName: "fake-form.pdf",
    pdfData: pdfBytes.toString("base64"),
    boxes: FIELDS,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}
