export type FieldBox = {
  id: string;
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: "Helvetica" | "Times-Roman" | "Courier";
  bold: boolean;
  align: "left" | "center" | "right";
  color: string; // hex
  // Older saved templates predate this field, so treat a missing value the
  // same as "text" everywhere it's read rather than assuming it's set.
  validationType?: "text" | "amount";
};

export type Template = {
  id: string;
  name: string; // e.g. "Statement of Emoluments 2026"
  pdfFileName: string;
  pdfData: string; // base64-encoded PDF bytes, so the template is self-contained in localStorage
  boxes: FieldBox[];
  createdAt: string;
  updatedAt: string;
};

export type EmployerProfile = {
  companyName: string;
  address: string;
  tan: string;
};
