// Audit of the PDF form filler: importing people, batch export, where the
// text lands (upright and rotated pages), and how the app behaves near the
// browser's storage limit. Run with: node --test tests/audit.test.mjs
//
// It drives the real app in a throwaway browser profile and reads the
// downloaded PDFs back. TEST data only (company "TEST Co A", IDs "TST...").
//
// A test named "evidence (BUG)" passes while the bug is present and records
// exactly what the app does; it will fail once the bug is fixed. "evidence
// (MISSING)" and "evidence (LIMIT)" record something the app does not do.
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  fillStorage,
  openFillScreen,
  peopleCount,
  readStoredTemplates,
  seedTemplates,
  STANDIN_URL,
  startApp,
  waitForPdfPreview,
} from "./helpers/app.mjs";

const TIMEOUT = { timeout: 240_000 };
const STORAGE_KEY = "pdf-editor:templates";

let app;
before(async () => {
  app = await startApp();
}, TIMEOUT);
after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------- test data

async function blankForm({ rotation = 0, pages = 1 } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < pages; n++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`TEST FORM page ${n + 1} - TEST DATA ONLY`, { x: 50, y: 800, size: 12, font });
    if (rotation) page.setRotation(degrees(rotation));
  }
  return Buffer.from(await doc.save());
}

function box(id, name, x, y, width, height, style = {}) {
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

// Positions are in the page's VISUAL space (as shown on screen), in points.
// They fit inside a 595 x 595 square so the same boxes work on a page turned
// by 90 or 270 degrees, whose visible size is 842 x 595.
const BOXES = [
  box("b-company", "Company Name", 60, 80, 260, 20),
  box("b-id", "ID", 60, 120, 120, 20, { fontFamily: "Courier", fontSize: 10 }),
  box("b-surname", "Surname", 60, 160, 220, 20, { bold: true }),
  box("b-other", "Other Names", 60, 200, 220, 20, { fontFamily: "Times-Roman", fontSize: 11 }),
  box("b-basic", "Basic Salary", 60, 260, 140, 20, { align: "right", validationType: "amount" }),
  box("b-net", "Net Pay", 240, 260, 140, 20, { align: "center", validationType: "amount" }),
  box("b-tan", "TAN", 60, 300, 140, 20),
];

const PEOPLE = [
  { ID: "TST001", Surname: "TESTER", "Other Names": "Alpha", "Basic Salary": "18,750.00", "Net Pay": "18381.25", "Company Name": "TEST Co A" },
  { ID: "TST002", Surname: "TESTER", "Other Names": "Beta", "Basic Salary": "100,000.00", "Net Pay": "88400", "Company Name": "TEST Co A" },
  { ID: "TST003", Surname: "TESTER", "Other Names": "Gamma", "Basic Salary": "60,000.00", "Net Pay": "57978.43", "Company Name": "TEST Co A" },
];

function template(pdfBytes, overrides = {}) {
  return {
    id: "tpl-test-form",
    name: "TEST Form",
    pdfFileName: "test-form.pdf",
    pdfData: pdfBytes.toString("base64"),
    boxes: BOXES,
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    ...overrides,
  };
}

const entriesFor = (people, boxes = BOXES) =>
  people.map((person, index) => ({
    id: `entry-${index + 1}`,
    values: Object.fromEntries(
      boxes.filter((b) => person[b.name] !== undefined).map((b) => [b.id, person[b.name]]),
    ),
  }));

// ------------------------------------------------------------ app driving

async function openApp(templates) {
  const { context, outsideRequests } = await app.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, templates);
  await page.getByText("Your templates").waitFor();
  return { context, page, outsideRequests, pageErrors };
}

const dialog = (page) => page.getByRole("dialog").last();

async function chooseImportFile(page, name, content) {
  await page.locator('input[type="file"]').setInputFiles(app.writeTempFile(name, content));
  await dialog(page).waitFor();
}

async function importFile(page, name, content, { replace = false } = {}) {
  await chooseImportFile(page, name, content);
  if (replace) await dialog(page).getByRole("button", { name: "Add to", exact: true }).click();
  await dialog(page).getByRole("button", { name: /^Import \d+ (person|people)$/ }).click();
  if (replace) await dialog(page).getByRole("button", { name: "Replace all" }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
}

async function download(page) {
  const started = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const file = await started;
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(await file.path()) };
}

// ------------------------------------------------------ reading a PDF back

// Every piece of text in a PDF with its position as a VIEWER shows it:
// top-left origin, y downwards, after the page's own rotation is applied.
// The conversion is pdf.js's, not the app's, so it is an independent check
// of where the app put the text.
async function readVisualText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const m = pdfjs.Util.transform(viewport.transform, item.transform);
      items.push({
        text: item.str,
        x: m[4],
        y: m[5],
        width: item.width,
        // 0 when the text reads left to right as displayed.
        angle: Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI),
      });
    }
    pages.push({ rotation: page.rotate, width: viewport.width, height: viewport.height, items });
  }
  await doc.loadingTask.destroy();
  return pages;
}

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual.toFixed(2)} is not within ${tolerance} of ${expected.toFixed(2)}`);

// A value must sit inside its box: on the box's baseline band, starting,
// centred or ending where the box's alignment says.
function assertInsideBox(item, b, what) {
  assert.equal(item.angle, 0, `${what}: the text is not upright`);
  assert.ok(item.y >= b.y && item.y <= b.y + b.height, `${what}: baseline ${item.y.toFixed(2)} is outside the box (${b.y} to ${b.y + b.height})`);
  if (b.align === "left") near(item.x, b.x, 1, `${what}: left edge`);
  if (b.align === "right") near(item.x + item.width, b.x + b.width, 2, `${what}: right edge`);
  if (b.align === "center") near(item.x + item.width / 2, b.x + b.width / 2, 2, `${what}: centre`);
  assert.ok(item.x >= b.x - 1 && item.x + item.width <= b.x + b.width + 2, `${what}: the text runs outside its box`);
}

// =========================================================== import people

test(
  "import: column names are matched whatever their case, spaces, underscores and hyphens; the rest is listed; missing fields stay blank",
  TIMEOUT,
  async () => {
    const pdf = await blankForm();
    const { context, page, outsideRequests } = await openApp([template(pdf)]);
    await openFillScreen(page, "TEST Form");

    // Headers written every which way; "TAN" is not in the file at all.
    const csv = [
      "id,SURNAME,other_names,basic-salary,  Net   Pay ,COMPANY NAME,Department,Bank Account",
      "TST001,TESTER,Alpha,\"18,750.00\",18381.25,TEST Co A,Testing,000-TEST",
      "TST002,TESTER,Beta,\"100,000.00\",88400,TEST Co A,Samples,",
    ].join("\n");
    await chooseImportFile(page, "test-people.csv", csv);
    const text = await dialog(page).textContent();
    assert.ok(text.includes("2 people found in this file."), text);
    assert.ok(text.includes("2 columns had no matching field and were ignored: Department, Bank Account."), text);
    // The preview is headed by the template's own field names.
    assert.deepEqual(await dialog(page).locator("thead th").allTextContents(), ["ID", "Surname", "Other Names", "Basic Salary", "Net Pay", "Company Name"]);
    await dialog(page).getByRole("button", { name: "Import 2 people" }).click();
    await page.getByRole("dialog").first().waitFor({ state: "hidden" });

    assert.equal(await peopleCount(page), 2);
    const [stored] = await readStoredTemplates(page);
    const byName = (entry) => Object.fromEntries(BOXES.map((b) => [b.name, entry.values[b.id]]));
    assert.deepEqual(stored.entries.map(byName), [
      { "Company Name": "TEST Co A", ID: "TST001", Surname: "TESTER", "Other Names": "Alpha", "Basic Salary": "18,750.00", "Net Pay": "18381.25", TAN: undefined },
      { "Company Name": "TEST Co A", ID: "TST002", Surname: "TESTER", "Other Names": "Beta", "Basic Salary": "100,000.00", "Net Pay": "88400", TAN: undefined },
    ]);
    // Amounts are kept exactly as written in the file: nothing is reformatted.
    assert.equal(await page.getByLabel("Basic Salary", { exact: true }).inputValue(), "100,000.00");
    // The field the file does not have is blank on screen and absent from the PDF.
    assert.equal(await page.getByLabel("TAN", { exact: true }).inputValue(), "");
    const pages = await readVisualText((await download(page)).bytes);
    assert.equal(pages.length, 2);
    for (const p of pages) assert.ok(!p.items.some((i) => /undefined|null/.test(i.text)), "a missing value was printed");
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

test("import: JSON with keys written differently is matched the same way", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  const rows = [{ id: "TST001", " surname ": "TESTER", "OTHER_NAMES": "Alpha", basicSalary: 18750, "net-pay": 18381.25, companyname: "TEST Co A", Notes: "x" }];
  await chooseImportFile(page, "test-people.json", JSON.stringify(rows));
  const text = await dialog(page).textContent();
  assert.ok(text.includes("1 column had no matching field and was ignored: Notes."), text);
  await dialog(page).getByRole("button", { name: "Import 1 person" }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(stored.entries[0].values, { "b-id": "TST001", "b-surname": "TESTER", "b-other": "Alpha", "b-basic": "18750", "b-net": "18381.25", "b-company": "TEST Co A" });
  await context.close();
});

test("import: Add to keeps the people already there; Replace asks first, then swaps them", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  await importFile(page, "two.json", JSON.stringify(PEOPLE.slice(0, 2)));
  assert.equal(await peopleCount(page), 2);
  await importFile(page, "three.json", JSON.stringify(PEOPLE));
  assert.equal(await peopleCount(page), 5);

  // Replace: the confirmation says what will be lost; Cancel keeps everyone.
  await chooseImportFile(page, "one.json", JSON.stringify(PEOPLE.slice(2)));
  await dialog(page).getByRole("button", { name: "Add to", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Import 1 person" }).click();
  assert.ok((await dialog(page).textContent()).includes("This will remove the 5 people already added and replace them with the 1 from this file."));
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  // (Counted in the page itself: the list is behind the open dialog.)
  assert.equal(await page.locator("li button", { hasText: /^Person \d+$/ }).count(), 5);
  await dialog(page).getByRole("button", { name: "Import 1 person" }).click();
  await dialog(page).getByRole("button", { name: "Replace all" }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  assert.equal(await peopleCount(page), 1);
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(stored.entries.map((e) => e.values["b-id"]), ["TST003"]);
  await context.close();
});

test("import: a file with no matching column, or that is not a list of people, imports nothing and says why", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  for (const [name, content, message] of [
    ["none.csv", "Department,Email\nTesting,nobody@example.test\n", "None of the columns in this file match a field in this template"],
    ["broken.json", "{ not json", "This file doesn't look like a valid JSON file."],
    ["object.json", '{"ID":"TST001"}', "This JSON file should contain a list of entries, one per person."],
    ["header-only.csv", "ID,Surname\n", "This file only has a header row"],
  ]) {
    await chooseImportFile(page, name, content);
    assert.ok((await dialog(page).textContent()).includes(message), `${name}: ${await dialog(page).textContent()}`);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  }
  assert.equal(await peopleCount(page), 0);
  await context.close();
});

// ============================================================ batch export

for (const rotation of [0, 90, 180, 270]) {
  test(`batch export: one page per person, every value upright and inside its box, on a page saved rotated by ${rotation} degrees`, TIMEOUT, async () => {
    const pdf = await blankForm({ rotation });
    const { context, page } = await openApp([template(pdf)]);
    await openFillScreen(page, "TEST Form");
    await importFile(page, "people.json", JSON.stringify(PEOPLE));

    const file = await download(page);
    assert.equal(file.name, "TEST_Form.pdf");
    const pages = await readVisualText(file.bytes);
    assert.equal(pages.length, PEOPLE.length, "one page per person");

    pages.forEach((p, index) => {
      assert.equal(p.rotation, rotation);
      const person = PEOPLE[index];
      for (const b of BOXES) {
        const expected = person[b.name];
        const found = p.items.filter((i) => i.text === expected && Math.abs(i.y - (b.y + b.height / 2)) < b.height);
        if (expected === undefined) continue;
        assert.equal(found.length, 1, `page ${index + 1}, ${b.name}: "${expected}" drawn ${found.length} times near its box`);
        assertInsideBox(found[0], b, `page ${index + 1} (rotated ${rotation}), ${b.name}`);
      }
      // Nobody else's values are on this person's page.
      for (const other of PEOPLE.filter((_, i) => i !== index)) {
        assert.ok(!p.items.some((i) => i.text === other.ID), `page ${index + 1} also shows ${other.ID}`);
      }
    });
    await context.close();
  });
}

test("batch export: a form with two pages gives two pages per person, in order", TIMEOUT, async () => {
  const pdf = await blankForm({ pages: 2 });
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  await importFile(page, "people.json", JSON.stringify(PEOPLE.slice(0, 2)));
  const pages = await readVisualText((await download(page)).bytes);
  assert.equal(pages.length, 4);
  assert.deepEqual(
    pages.map((p) => [p.items.some((i) => i.text.includes("page 1")), p.items.find((i) => /^TST/.test(i.text))?.text ?? null]),
    [[true, "TST001"], [false, null], [true, "TST002"], [false, null]],
  );
  await context.close();
});

test("evidence (LIMIT): fields can only be placed on the first page of a form", TIMEOUT, async () => {
  const pdf = await blankForm({ pages: 2 });
  const { context, page } = await openApp([template(pdf, { boxes: [] })]);
  await page.getByRole("button", { name: /^TEST Form Last updated/ }).click();
  await page.getByRole("button", { name: "Add fields" }).click();
  await waitForPdfPreview(page);
  // One page is shown, and nothing offers a way to reach the second.
  assert.equal(await page.locator("canvas").count(), 1);
  assert.equal(await page.getByRole("button", { name: /next page|page 2|previous page/i }).count(), 0);
  await context.close();
});

// Fixed (was High). Coming back to a template used to show the last person's
// values in the form with nobody selected, and the download took that for one
// more person: a fourth page, the last person twice.
test("after leaving and coming back, the download still has one page per person, and the person left in the form is selected again", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  await importFile(page, "people.json", JSON.stringify(PEOPLE));
  assert.equal((await readVisualText((await download(page)).bytes)).length, 3);
  await readStoredTemplates(page); // gives the app time to save
  await page.getByRole("button", { name: "Back to templates" }).click();
  await openFillScreen(page, "TEST Form");
  assert.equal(await peopleCount(page), 3);
  // The form shows the third person, and the list says so.
  assert.equal(await page.getByLabel("ID", { exact: true }).inputValue(), "TST003");
  assert.equal(await page.getByRole("button", { name: "Person 3", exact: true }).getAttribute("aria-current"), "true");
  const pages = await readVisualText((await download(page)).bytes);
  assert.deepEqual(
    pages.map((p) => p.items.find((i) => /^TST/.test(i.text))?.text),
    ["TST001", "TST002", "TST003"],
  );
  // The same after a reload, and nobody was added to what is stored.
  await page.reload();
  await page.getByText("Your templates").waitFor();
  await openFillScreen(page, "TEST Form");
  assert.equal((await readVisualText((await download(page)).bytes)).length, 3);
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(stored.entries.map((e) => e.values["b-id"]), ["TST001", "TST002", "TST003"]);
  await context.close();
});

// A person typed in but not added yet is still someone new after coming
// back: they are not mistaken for a listed person, and are in the download.
test("after leaving and coming back, a person typed in but not added yet is still in the form and in the download", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf, { entries: entriesFor(PEOPLE.slice(0, 2)) })]);
  await openFillScreen(page, "TEST Form");
  await page.getByLabel("ID", { exact: true }).fill("TST009");
  await readStoredTemplates(page); // gives the app time to save
  await page.getByRole("button", { name: "Back to templates" }).click();
  await openFillScreen(page, "TEST Form");
  assert.equal(await peopleCount(page), 2);
  assert.equal(await page.getByLabel("ID", { exact: true }).inputValue(), "TST009");
  assert.equal(await page.locator('[aria-current="true"]').count(), 0);
  const pages = await readVisualText((await download(page)).bytes);
  assert.deepEqual(
    pages.map((p) => p.items.find((i) => /^TST/.test(i.text))?.text),
    ["TST001", "TST002", "TST009"],
  );
  await context.close();
});

// ================================================= a person being typed in

// Fixed (was High, docs/KNOWN_ISSUES.md item 1a). Clicking a listed person
// while a new one was typed in but not added yet threw the new one away.
test("clicking another person keeps the person being typed: they are added to the list first", TIMEOUT, async () => {
  const pdf = await blankForm();
  const employerFields = [{ id: "companyName", label: "Company Name", value: "TEST Co A" }];
  const { context, page } = await openApp([template(pdf, { employerFields })]);
  await openFillScreen(page, "TEST Form");
  const field = (name) => page.getByLabel(name, { exact: true });
  const person = (n) => page.getByRole("button", { name: `Person ${n}`, exact: true });

  await field("Surname").fill("TESTER");
  await field("ID").fill("TST001");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  assert.equal(await peopleCount(page), 1);

  // A form holding only the company details is not a person: nobody is added.
  assert.equal(await field("Company Name").inputValue(), "TEST Co A");
  await person(1).click();
  assert.equal(await peopleCount(page), 1);
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  assert.equal(await peopleCount(page), 1);

  // A second person typed in, then "Person 1" clicked before adding them.
  await field("Surname").fill("SAMPLETON");
  await field("ID").fill("TST002");
  await person(1).click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await field("ID").inputValue(), "TST001");
  assert.equal(await peopleCount(page), 2, "the person being typed was added to the list");
  await person(2).click();
  assert.deepEqual([await field("ID").inputValue(), await field("Surname").inputValue()], ["TST002", "SAMPLETON"]);

  // Clicking back and forth again adds nobody else.
  await person(1).click();
  await person(2).click();
  assert.equal(await peopleCount(page), 2);
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(stored.entries.map((e) => [e.values["b-id"], e.values["b-surname"]]), [["TST001", "TESTER"], ["TST002", "SAMPLETON"]]);
  const pages = await readVisualText((await download(page)).bytes);
  assert.deepEqual(pages.map((p) => p.items.find((i) => /^TST\d/.test(i.text))?.text), ["TST001", "TST002"]);
  await context.close();
});

// Fixed (was High, docs/KNOWN_ISSUES.md item 1b). "Clear all" removes the
// people in the list, as its confirmation says; it used to empty the form of
// a person still being typed as well.
test("Clear all removes the listed people and leaves the person being typed in the form", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  const field = (name) => page.getByLabel(name, { exact: true });
  const clearAll = async () => {
    await page.getByRole("button", { name: "Clear all" }).click();
    await dialog(page).getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  };

  await field("ID").fill("TST001");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await field("ID").fill("TST002");
  await field("Surname").fill("SAMPLETON");
  await page.getByRole("button", { name: "Clear all" }).click();
  assert.ok((await dialog(page).textContent()).includes("This will remove everyone added to this batch (1 person)."));
  await dialog(page).getByRole("button", { name: "Clear all" }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  assert.equal(await peopleCount(page), 0);
  assert.deepEqual([await field("ID").inputValue(), await field("Surname").inputValue()], ["TST002", "SAMPLETON"]);
  const pages = await readVisualText((await download(page)).bytes);
  assert.deepEqual(pages.map((p) => p.items.find((i) => /^TST\d/.test(i.text))?.text), ["TST002"]);

  // When the form shows one of the listed people, it is emptied with them.
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await page.getByRole("button", { name: "Person 1", exact: true }).click();
  assert.equal(await field("ID").inputValue(), "TST002");
  await clearAll();
  assert.equal(await peopleCount(page), 0);
  assert.equal(await field("ID").inputValue(), "");
  await context.close();
});

// ========================================================== values in boxes

// Was audit M16: nothing shrank, wrapped or warned. As agreed, the form now
// warns beside each such field; the PDF still draws the value at full size
// (shrink-to-fit would change the PDF and is left for later).
const TOO_WIDE = "Too long for its box: on the PDF it will run past the edge of the box.";
const tooWideFields = (page) =>
  page.locator("label + input").evaluateAll(
    (inputs, text) => inputs.filter((input) => input.parentElement.textContent.replace(/\s+/g, " ").includes(text)).map((input) => input.id),
    TOO_WIDE,
  );

test("a value longer than its box is said beside its field; the PDF still draws it at full size, past the box", TIMEOUT, async () => {
  const pdf = await blankForm();
  const long = "TESTER-WITH-A-VERY-LONG-DOUBLE-BARRELLED-SURNAME-INDEED";
  const { context, page } = await openApp([template(pdf, { entries: entriesFor([{ ...PEOPLE[0], Surname: long, "Basic Salary": "1,234,567,890,123,456,789.00" }]) })]);
  await openFillScreen(page, "TEST Form");
  await page.getByRole("button", { name: "Person 1", exact: true }).click();
  await page.getByText(TOO_WIDE).first().waitFor();
  assert.deepEqual((await tooWideFields(page)).sort(), ["field-b-basic", "field-b-surname"].sort());
  // Shortened, the warning goes.
  await page.getByLabel("Surname", { exact: true }).fill("TESTER");
  await page.waitForFunction((text) => [...document.querySelectorAll("p")].filter((p) => p.textContent.includes(text)).length === 1, TOO_WIDE);
  await page.getByLabel("Surname", { exact: true }).fill(long);
  const [first] = await readVisualText((await download(page)).bytes);
  const surname = first.items.find((i) => i.text === long);
  const surnameBox = BOXES.find((b) => b.name === "Surname");
  assert.ok(surname.x + surname.width > surnameBox.x + surnameBox.width + 50, "the long surname ends well outside its box");
  // A right-aligned amount that is too long starts to the LEFT of its box.
  const amount = first.items.find((i) => i.text === "1,234,567,890,123,456,789.00");
  const amountBox = BOXES.find((b) => b.name === "Basic Salary");
  assert.ok(amount.x < amountBox.x, "the long amount starts before its box");
  await context.close();
});

// Fixed (was High). One such character used to stop the whole download, for
// everyone, with "Something went wrong creating your PDF. Please try again."
test("a character the PDF fonts cannot print is replaced with \"?\" in its own field; the download finishes and the people and fields are listed", TIMEOUT, async () => {
  const pdf = await blankForm();
  // "Ł" and "ń" are outside the three built-in fonts' character set; "é" is in it.
  const people = [
    PEOPLE[0],
    { ...PEOPLE[1], Surname: "TESTER-Wroński", "Other Names": "Łukasz Renée" },
    { ...PEOPLE[2], "Other Names": "Gamma\tDelta" },
  ];
  const { context, page } = await openApp([template(pdf, { entries: entriesFor(people) })]);
  await openFillScreen(page, "TEST Form");
  await page.getByRole("button", { name: "Person 1", exact: true }).click();

  const file = await download(page);
  const pages = await readVisualText(file.bytes);
  assert.equal(pages.length, 3, "everyone is in the download");
  const texts = pages.map((p) => p.items.map((i) => i.text));
  // Only the unprintable characters are replaced, each in its own field.
  assert.ok(texts[1].includes("?ukasz Renée"), texts[1].join(" | "));
  assert.ok(texts[1].includes("TESTER-Wro?ski"), texts[1].join(" | "));
  assert.ok(texts[2].includes("Gamma Delta"), texts[2].join(" | "));
  // Everything else is exactly as before, in its box.
  for (const [index, person] of [[0, PEOPLE[0]], [1, PEOPLE[1]], [2, PEOPLE[2]]]) {
    for (const name of ["ID", "Basic Salary", "Net Pay", "Company Name"]) {
      const b = BOXES.find((candidate) => candidate.name === name);
      const found = pages[index].items.filter((i) => i.text === person[name]);
      assert.equal(found.length, 1, `page ${index + 1}, ${name}`);
      assertInsideBox(found[0], b, `page ${index + 1}, ${name}`);
    }
  }
  assert.equal(pages[0].items.filter((i) => i.text.includes("?")).length, 0);

  // Afterwards the people and fields are listed, in a dialog that waits.
  const report = dialog(page);
  await report.getByText("Some characters could not be printed").waitFor();
  assert.deepEqual(await report.locator("li").allTextContents(), [
    "Person 2, Surname: ń",
    "Person 2, Other Names: Ł",
    "Person 3, Other Names: line break or tab",
  ]);
  assert.equal(await page.locator(".notice-danger").count(), 0, "no error is shown");
  await report.getByRole("button", { name: "OK" }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  // What is stored and shown on screen is still what was typed.
  await page.getByRole("button", { name: "Person 2", exact: true }).click();
  assert.equal(await page.getByLabel("Other Names", { exact: true }).inputValue(), "Łukasz Renée");
  await context.close();
});

test("a single person typed into the form: an unprintable character is replaced and the field is named", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await openFillScreen(page, "TEST Form");
  await page.getByLabel("ID", { exact: true }).fill("TST001");
  await page.getByLabel("Other Names", { exact: true }).fill("Łukasz");
  const pages = await readVisualText((await download(page)).bytes);
  assert.equal(pages.length, 1);
  assert.ok(pages[0].items.some((i) => i.text === "?ukasz"));
  await dialog(page).getByText("Some characters could not be printed").waitFor();
  assert.deepEqual(await dialog(page).locator("li").allTextContents(), ["Other Names: Ł"]);
  await context.close();
});

// Was audit M15: an import filled only the last field drawn with that name.
test("two fields with the same name are both allowed, and an import fills both of them", TIMEOUT, async () => {
  const pdf = await blankForm();
  const boxes = [...BOXES, box("b-surname-again", "Surname", 60, 360, 220, 20)];
  const { context, page } = await openApp([template(pdf, { boxes })]);
  await openFillScreen(page, "TEST Form");
  await importFile(page, "one.json", JSON.stringify(PEOPLE.slice(0, 1)));
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(
    [stored.entries[0].values["b-surname"], stored.entries[0].values["b-surname-again"]],
    ["TESTER", "TESTER"],
  );
  const [first] = await readVisualText((await download(page)).bytes);
  assert.equal(first.items.filter((i) => i.text === "TESTER").length, 2, "the surname is printed in both boxes");
  await context.close();
});

// Was audit M14: imported people did not get the company details.
test("people who are imported get the template's company details, as people typed by hand do; a value in the file wins", TIMEOUT, async () => {
  const pdf = await blankForm();
  const employerFields = [
    { id: "companyName", label: "Company Name", value: "TEST Co A" },
    { id: "tan", label: "TAN", value: "TEST-TAN-1" },
  ];
  const { context, page } = await openApp([template(pdf, { employerFields })]);
  await openFillScreen(page, "TEST Form");
  // Typed by hand: the company details are filled in for them.
  assert.equal(await page.getByLabel("TAN", { exact: true }).inputValue(), "TEST-TAN-1");
  await page.getByLabel("Surname", { exact: true }).fill("HANDTYPED");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  // Imported from a file that has no TAN or company columns.
  // A second person whose file row has its own TAN, and a blank company name.
  const withoutCompany = PEOPLE.slice(0, 1).map(({ "Company Name": _c, ...rest }) => rest);
  const ownTan = { ...PEOPLE[1], "Company Name": "", TAN: "TEST-TAN-OWN" };
  await importFile(page, "two.json", JSON.stringify([...withoutCompany, ownTan]));
  assert.equal(await page.getByLabel("TAN", { exact: true }).inputValue(), "TEST-TAN-OWN");

  const pages = await readVisualText((await download(page)).bytes);
  assert.equal(pages.length, 3);
  assert.ok(pages[0].items.some((i) => i.text === "TEST-TAN-1"), "the hand-typed person's page has the TAN");
  assert.ok(pages[1].items.some((i) => i.text === "TEST-TAN-1"), "the imported person's page has the template's TAN");
  assert.ok(pages[1].items.some((i) => i.text === "TEST Co A"), "and its company name");
  assert.ok(pages[2].items.some((i) => i.text === "TEST-TAN-OWN"), "a TAN in the file wins");
  assert.ok(!pages[2].items.some((i) => i.text === "TEST-TAN-1"), "and replaces the template's");
  assert.ok(pages[2].items.some((i) => i.text === "TEST Co A"), "a blank company name in the file keeps the template's");
  await context.close();
});

// ================================================================= storage

test("storage: how much room a template and its people take, and how much there is", TIMEOUT, async (t) => {
  const pdf = await blankForm();
  const many = (count) => Array.from({ length: count }, (_, i) => ({ ...PEOPLE[i % 3], ID: `TST${String(i + 1).padStart(3, "0")}`, TAN: "TEST-TAN-1" }));
  const { context, page } = await openApp([template(pdf)]);
  const sizeOf = async (templates) => {
    await seedTemplates(page, templates);
    return page.evaluate((key) => localStorage.getItem(key).length, STORAGE_KEY);
  };
  const empty = await sizeOf([template(pdf, { boxes: [] })]);
  const with100 = await sizeOf([template(pdf, { entries: entriesFor(many(100)) })]);
  const with500 = await sizeOf([template(pdf, { entries: entriesFor(many(500)) })]);
  await seedTemplates(page, []);
  const quota = await fillStorage(page);

  const perPerson = Math.round((with500 - with100) / 400);
  t.diagnostic(`storage quota for the whole site in this browser: ${quota.toLocaleString("en-US")} characters`);
  t.diagnostic(`a template with a small ${pdf.length.toLocaleString("en-US")}-byte PDF: ${empty.toLocaleString("en-US")} characters (the PDF is stored as text, a third larger than the file)`);
  t.diagnostic(`the same with 100 people: ${with100.toLocaleString("en-US")}; with 500 people: ${with500.toLocaleString("en-US")}; about ${perPerson} characters per person with 7 fields`);
  t.diagnostic(`largest PDF that can be stored with nothing else on the site: about ${Math.floor((quota * 3) / 4 / 1024).toLocaleString("en-US")} KB`);

  // 100 and even 500 people are a small part of the quota; the PDFs are what fills it.
  assert.ok(with500 < quota * 0.1, "500 people take less than a tenth of the storage");
  assert.ok(quota > 5_000_000 && quota < 5_500_000, `quota ${quota}`);
  await context.close();
});

// Was audit M17: the message did not say that size was the reason.
test("a PDF too large for the browser's storage cannot be saved, and the message says that size is the reason", TIMEOUT, async () => {
  // A valid form followed by 4.5 MB of padding: stored as text it needs 6 MB, over the 5 MB limit.
  const big = Buffer.concat([await blankForm(), Buffer.from(`\n%${"x".repeat(4_500_000)}\n`)]);
  const { context, page } = await openApp([]);
  await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(app.writeTempFile("big-form.pdf", big));
  await waitForPdfPreview(page);
  await page.getByLabel("Template name").fill("TEST Big Form");
  await page.getByRole("button", { name: "Save template" }).click();
  const notice = page.locator(".notice-danger").filter({ hasText: "could not be saved" });
  await notice.waitFor();
  assert.equal(
    (await notice.textContent()).replace(/\s+/g, " ").trim(),
    "This PDF (4.3 MB) could not be saved: there is not enough room left in this browser's storage. Delete templates you no longer need, or use a smaller PDF, then try again.",
  );
  assert.deepEqual(await readStoredTemplates(page), []);
  await context.close();
});

// Fixed (was Critical). The people used to look saved, nothing warned, and a
// reload emptied the list; the refused save only reached the browser console.
test("when storage is full, imported people are marked NOT saved behind a blocking warning, and are saved once there is room", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page, pageErrors } = await openApp([template(pdf)]);
  await fillStorage(page);
  await openFillScreen(page, "TEST Form");
  // Opening the screen changes nothing, so nothing is reported yet.
  await page.waitForTimeout(1200);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByRole("alert").count(), 0);

  await importFile(page, "people.json", JSON.stringify(PEOPLE));
  // A warning opens by itself and stays until it is answered.
  const warning = page.getByRole("dialog");
  await warning.getByText("This was NOT saved").waitFor();
  assert.ok((await warning.textContent()).includes("The browser's storage for this tool is full, so your last change could not be saved."));
  await page.waitForTimeout(1200);
  assert.equal(await warning.count(), 1);
  await warning.getByRole("button", { name: "OK" }).click();
  await warning.waitFor({ state: "hidden" });

  // The people are still there to download, and marked as not saved.
  assert.equal(await peopleCount(page), 3);
  const notice = page.getByRole("alert");
  assert.ok((await notice.textContent()).startsWith("NOT saved."), await notice.textContent());
  assert.equal(await page.getByText("Not saved", { exact: true }).count(), 1);
  assert.equal((await readVisualText((await download(page)).bytes)).length, 3);
  const [stored] = await readStoredTemplates(page);
  assert.equal((stored.entries ?? []).length, 0, "nothing was stored, as the screen says");
  assert.deepEqual(pageErrors, [], "the refused save is handled, not thrown");

  // Typing more does not open the warning again; the notice stays.
  await page.getByLabel("TAN", { exact: true }).fill("TEST-TAN-1");
  await page.waitForTimeout(1200);
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await notice.count(), 1);

  // Trying again with no room says so again.
  await notice.getByRole("button", { name: "Try saving again" }).click();
  await warning.getByText("This was NOT saved").waitFor();
  await warning.getByRole("button", { name: "OK" }).click();
  await warning.waitFor({ state: "hidden" });
  assert.equal(await notice.count(), 1);

  // With room made, trying again saves everyone and the notice goes.
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("zz_test_fill_")) localStorage.removeItem(key);
  });
  await notice.getByRole("button", { name: "Try saving again" }).click();
  await notice.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await page.getByText("Not saved", { exact: true }).count(), 0);
  await page.reload();
  await page.getByText("Your templates").waitFor();
  await openFillScreen(page, "TEST Form");
  assert.equal(await peopleCount(page), 3);
  assert.equal(await page.getByLabel("TAN", { exact: true }).inputValue(), "TEST-TAN-1");
  await context.close();
});

test("when storage is full, a reload shows exactly what the screen said was saved: nobody", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await fillStorage(page);
  await openFillScreen(page, "TEST Form");
  await importFile(page, "people.json", JSON.stringify(PEOPLE));
  await page.getByRole("dialog").getByRole("button", { name: "OK" }).click();
  assert.equal(await page.getByRole("alert").count(), 1);
  await page.reload();
  await page.getByText("Your templates").waitFor();
  await openFillScreen(page, "TEST Form");
  assert.equal(await peopleCount(page), 0);
  assert.equal(await page.getByRole("alert").count(), 0);
  await context.close();
});

test("when storage is full, the other saves say so too: field positions, company details and a template's name", TIMEOUT, async () => {
  const pdf = await blankForm();
  const employerFields = [{ id: "companyName", label: "Company Name", value: "TEST Co A" }];
  const { context, page, pageErrors } = await openApp([template(pdf, { employerFields })]);
  await fillStorage(page);
  const warning = page.getByRole("dialog").filter({ hasText: "This was NOT saved" });
  const acknowledge = async () => {
    await warning.waitFor();
    await warning.getByRole("button", { name: "OK" }).click();
    await warning.waitFor({ state: "hidden" });
  };

  // A longer name does not fit: the list keeps the name that is stored.
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("TEST Form with a much longer name");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await acknowledge();
  assert.equal(await page.getByRole("button", { name: /^TEST Form Last updated/ }).count(), 1);

  // Company details: no "Saved" badge.
  await page.getByRole("button", { name: "Company details", exact: true }).click();
  await page.getByLabel("Company Name", { exact: true }).fill("TEST Co A with a much longer name");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await acknowledge();
  assert.equal(await page.getByText("Saved", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Back to templates" }).click();

  // The field editor: a new field does not fit, and "Unsaved changes" stays.
  await page.getByRole("button", { name: /^TEST Form Last updated/ }).click();
  await page.getByRole("button", { name: "Edit fields" }).click();
  await waitForPdfPreview(page);
  const canvas = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(canvas.x + 300, canvas.y + 600);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 500, canvas.y + 640, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("dialog").getByRole("textbox").fill("Extra Field");
  await page.getByRole("dialog").getByRole("button", { name: "Add field" }).click();
  await page.getByRole("button", { name: "Save template" }).click();
  await acknowledge();
  assert.equal(await page.getByText("Unsaved changes").count(), 1);

  const [stored] = await readStoredTemplates(page);
  assert.equal(stored.name, "TEST Form");
  assert.equal(stored.employerFields[0].value, "TEST Co A");
  assert.equal(stored.boxes.length, BOXES.length);
  assert.deepEqual(pageErrors, []);
  await context.close();
});

// ================================================ leaving the fill-in screen

// Fixed (docs/KNOWN_ISSUES.md item 6). Typed values and the People list are
// stored 0.4 seconds after the last change. Leaving inside that time used to
// cancel the save that was waiting, so the last change was dropped unseen.
// Nothing here waits between typing and leaving.
test("what is typed in the last moment before leaving the fill-in screen is saved: Back to templates, Edit fields and a reload", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page, pageErrors } = await openApp([template(pdf, { entries: entriesFor(PEOPLE.slice(0, 2)) })]);
  const storedNow = async () => (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY))[0];
  const field = (name) => page.getByLabel(name, { exact: true });

  // A new person's ID, then "Back to templates" at once.
  await openFillScreen(page, "TEST Form");
  await field("ID").fill("TST009");
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByText("Your templates").waitFor();
  assert.equal((await storedNow()).values?.["b-id"], "TST009", "the ID typed just before Back to templates");
  await openFillScreen(page, "TEST Form");
  assert.equal(await field("ID").inputValue(), "TST009");

  // A listed person's surname changed, then "Edit fields" at once: the
  // People list is stored too, not only the form.
  await page.getByRole("button", { name: "Person 2", exact: true }).click();
  await readStoredTemplates(page); // gives the app time to save
  await field("Surname").fill("LASTMOMENT");
  await page.getByRole("button", { name: "Edit fields" }).click();
  await page.getByRole("button", { name: "Save template" }).waitFor();
  let stored = await storedNow();
  assert.equal(stored.values["b-surname"], "LASTMOMENT", "the surname typed just before Edit fields");
  assert.deepEqual(stored.entries.map((e) => [e.values["b-id"], e.values["b-surname"]]), [["TST001", "TESTER"], ["TST002", "LASTMOMENT"], ["TST009", undefined]]);

  // A value typed, then the page reloaded at once.
  await page.getByRole("button", { name: "Back to templates" }).click();
  await openFillScreen(page, "TEST Form");
  await readStoredTemplates(page);
  await field("TAN").fill("TEST-TAN-9");
  await page.reload();
  await page.getByText("Your templates").waitFor();
  stored = await storedNow();
  assert.equal(stored.values["b-tan"], "TEST-TAN-9", "the TAN typed just before the reload");
  assert.equal(stored.entries[1].values["b-tan"], "TEST-TAN-9", "and in the listed person it was typed for");
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("when storage is full, what is typed just before \"Back to templates\" is not dropped unseen: the NOT saved warning opens and the screen stays", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page, pageErrors } = await openApp([template(pdf)]);
  await fillStorage(page);
  await openFillScreen(page, "TEST Form");
  await page.waitForTimeout(1200);
  assert.equal(await page.getByRole("dialog").count(), 0);

  await page.getByLabel("ID", { exact: true }).fill("TST009");
  // Pressed in the page itself, with no wait: a click sent the usual way first
  // watches the button for a moment, and on a busy machine that moment was
  // longer than the 0.4 seconds this test has to stay inside.
  await page.getByRole("button", { name: "Back to templates" }).evaluate((button) => button.click());
  const warning = page.getByRole("dialog");
  await warning.getByText("This was NOT saved").waitFor();
  assert.ok((await warning.textContent()).includes("you can still download the PDF now"), await warning.textContent());
  await warning.getByRole("button", { name: "OK" }).click();
  await warning.waitFor({ state: "hidden" });

  // Still on the fill-in screen, marked as not saved, and still downloadable.
  assert.equal(await page.getByLabel("ID", { exact: true }).inputValue(), "TST009");
  assert.ok((await page.getByRole("alert").textContent()).startsWith("NOT saved."));
  const pages = await readVisualText((await download(page)).bytes);
  assert.deepEqual(pages.map((p) => p.items.find((i) => /^TST\d/.test(i.text))?.text), ["TST009"]);

  // Having been told, leaving is not held back a second time.
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByText("Your templates").waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  const [stored] = await readStoredTemplates(page);
  assert.equal(stored.values?.["b-id"], undefined, "nothing was stored, as the screen said");
  assert.deepEqual(pageErrors, []);
  await context.close();
});

test("when storage is full, reloading the page in that last moment is held by the browser's own question, and the NOT saved warning is there on staying", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  await fillStorage(page);
  await openFillScreen(page, "TEST Form");
  await page.waitForTimeout(1200);

  await page.getByLabel("ID", { exact: true }).fill("TST009");
  // The browser asks whether to leave; the answer here is to stay.
  const asked = new Promise((resolve) => page.once("dialog", (question) => question.dismiss().then(() => resolve(question.type()))));
  await page.evaluate(() => setTimeout(() => location.reload(), 0));
  assert.equal(await asked, "beforeunload");
  await page.getByRole("dialog").getByText("This was NOT saved").waitFor();
  assert.equal(await page.locator("#field-b-id").inputValue(), "TST009");
  await context.close();
});

// Was "evidence (MISSING)" until 13 October 2026: there was no way to save a
// template to a file or load one. What the two buttons do is tested in
// tests/storage.test.mjs.
test("templates can be saved to a file and loaded from one: the template list offers \"Back up\" and \"Restore\"", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  const buttons = (await page.getByRole("button").allTextContents()).map((b) => b.trim());
  assert.ok(buttons.includes("Back up"), buttons.join(" | "));
  assert.ok(buttons.includes("Restore"), buttons.join(" | "));
  await context.close();
});

// Was known issue 7 (backlog batch G): while the rename dialog faded out, its
// first line read 'Choose a new name for "".', since the name was forgotten
// at once. Every frame of the fade is read here.
test("the rename dialog keeps naming the template while it fades out, after Cancel and after Save", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf)]);
  for (const button of ["Cancel", "Save"]) {
    await page.getByRole("button", { name: "Rename", exact: true }).first().click();
    await page.getByRole("dialog").getByText("Choose a new name for").waitFor();
    const seen = await page.evaluate(
      (label) =>
        new Promise((resolve) => {
          const lines = [];
          [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === label).click();
          const read = () => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return resolve(lines);
            const line = [...dialog.querySelectorAll("p")].map((p) => p.textContent).find((t) => t.startsWith("Choose a new name for"));
            if (line) lines.push(line);
            requestAnimationFrame(read);
          };
          read();
        }),
      button,
    );
    assert.ok(seen.length > 0, `the fade was seen after ${button}`);
    assert.deepEqual([...new Set(seen)], ['Choose a new name for "TEST Form".'], `after ${button}`);
  }
  await context.close();
});

// ============================================================ Date boxes

// A "Date" box prints a clear date day first, DD/MM/YYYY, whether the value
// came from the dashboard (YYYY-MM-DD) or the payroll app's PDF fill file
// (DD/MM/YYYY). Anything else prints exactly as it is, and what was imported
// is never changed: only what is printed.
const DATE_BOXES = [
  box("b-id", "ID", 60, 80, 120, 20),
  box("b-doe", "Date of Employment", 60, 120, 160, 20, { validationType: "date" }),
  box("b-start", "Start", 60, 160, 160, 20),
];
// What was filled in on each page (the blank form's own heading left out).
const pageTexts = (pages) => pages.map((p) => p.items.map((i) => i.text).filter((t) => !t.startsWith("TEST FORM page")));

test("Date box: YYYY-MM-DD and DD/MM/YYYY both print DD/MM/YYYY; anything else prints as it is; a Text box and the stored values are unchanged", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf, { boxes: DATE_BOXES })]);
  await openFillScreen(page, "TEST Form");
  const rows = [
    { ID: "TST001", "Date of employment": "2021-03-15", Start: "2021-03-15" },
    { ID: "TST002", "Date of Employment": "04/11/2019" },
    { ID: "TST003", "Date of Employment": "1/8/2026" },
    { ID: "TST004", "Date of Employment": "since 2018" },
    { ID: "TST005", "Date of Employment": "31/02/2026" },
  ];
  await importFile(page, "test-people.json", JSON.stringify(rows));
  const pages = pageTexts(await readVisualText((await download(page)).bytes));
  assert.deepEqual(pages, [
    ["TST001", "15/03/2021", "2021-03-15"],
    ["TST002", "04/11/2019"],
    ["TST003", "01/08/2026"],
    ["TST004", "since 2018"],
    ["TST005", "31/02/2026"],
  ]);
  // Only what is printed: the values imported are kept as they were.
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(
    stored.entries.map((e) => e.values["b-doe"]),
    ["2021-03-15", "04/11/2019", "1/8/2026", "since 2018", "31/02/2026"],
  );
  await context.close();
});

test("Date box: data delivered by the dashboard (YYYY-MM-DD) prints DD/MM/YYYY", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(STANDIN_URL);
  const frame = await (await page.locator("#app").elementHandle()).contentFrame();
  await frame.getByText("Your templates").waitFor();
  await seedTemplates(frame, [template(pdf, { boxes: DATE_BOXES })]);
  await frame.getByText("TEST Form").waitFor();
  await openFillScreen(frame, "TEST Form");
  await page.waitForFunction(() => window.hub.received.some((m) => m.message.type === "ready"));
  // As the dashboard sends a saved run: "Date of Employment" as it keeps it.
  await page.evaluate(() =>
    window.hub.send(
      "send-data",
      { dataType: "payroll-result", rows: [{ ID: "TST001", "Date of Employment": "2021-03-15" }], meta: { period: "2026-09" } },
      "test-date-delivery",
    ),
  );
  await frame.getByRole("dialog").waitFor();
  await frame.getByRole("dialog").last().getByRole("button", { name: /^Import 1 person$/ }).click();
  await frame.getByRole("dialog").first().waitFor({ state: "hidden" });
  const started = page.waitForEvent("download");
  await frame.getByRole("button", { name: "Download PDF" }).click();
  const file = await started;
  const pages = pageTexts(await readVisualText(fs.readFileSync(await file.path())));
  assert.deepEqual(pages, [["TST001", "15/03/2021"]]);
  await context.close();
});

test("a new box named with the word \"date\" is a Date box, as \"salary\" makes an Amount box", TIMEOUT, async () => {
  const pdf = await blankForm();
  const { context, page } = await openApp([template(pdf, { boxes: [] })]);
  await page.getByRole("button", { name: "Edit fields" }).click();
  await waitForPdfPreview(page);
  const canvas = await page.locator("canvas").first().boundingBox();
  for (const [name, at] of [
    ["Date of Employment", 300],
    ["Basic Salary", 360],
    ["Update reference", 420],
  ]) {
    await page.mouse.move(canvas.x + 60, canvas.y + at);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 200, canvas.y + at + 20, { steps: 6 });
    await page.mouse.up();
    await page.getByRole("textbox", { name: "Name this field" }).fill(name);
    await page.getByRole("button", { name: "Add field" }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "Save template" }).click();
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("pdf-editor:templates") ?? "[]")[0]?.boxes ?? []).length === 3);
  const [stored] = await readStoredTemplates(page);
  assert.deepEqual(
    Object.fromEntries(stored.boxes.map((b) => [b.name, b.validationType])),
    { "Date of Employment": "date", "Basic Salary": "amount", "Update reference": "text" },
  );
  await context.close();
});
