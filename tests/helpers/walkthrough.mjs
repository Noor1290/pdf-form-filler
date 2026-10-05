// One walk through every screen and dialog of the app, with fake data.
// Shared by the visible-text check (which records the words at each stop)
// and the accessibility check (which measures contrast at each stop).
import {
  STANDIN_URL,
  openFillScreen,
  reloadApp,
  seedTemplates,
  waitForPdfPreview,
} from "./app.mjs";
import {
  COMPANY_DETAILS,
  OTHER_PAYROLL_ROWS,
  PAYROLL_ROWS,
  buildSamplePdf,
  makeTemplate,
} from "./fake-data.mjs";

const LEGACY_COMPANY_DETAILS = {
  "pdf-editor:employer-fields": JSON.stringify(COMPANY_DETAILS),
};

// Visits every screen and dialog with fake data, calling `visit(target,
// name)` at each one. `target` is the page (or, inside the stand-in
// dashboard, the app's frame).
export async function walkThrough(app, visit) {
  const seen = new Set();
  const pdf = await buildSamplePdf();

  async function snap(target, name) {
    if (seen.has(name)) throw new Error(`Two states are both called "${name}"`);
    seen.add(name);
    await visit(target, name);
  }
  const dialog = (target) => target.getByRole("dialog").last();
  const inDialog = (target, name) =>
    dialog(target).getByRole("button", { name, exact: true }).click();
  const closed = (target) =>
    target.getByRole("dialog").first().waitFor({ state: "hidden" });
  const row = (target, templateName) =>
    target.getByRole("listitem").filter({ hasText: templateName });

  // ---------------- opened on its own ----------------
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, []);
  await page.getByText("Your templates").waitFor();
  await snap(page, "home: no templates yet");

  // New template
  await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
  await snap(page, "new template: before choosing a file");
  await page
    .locator('input[type="file"]')
    .setInputFiles(app.writeTempFile("notes.txt", "just some notes, not a PDF"));
  await page.getByText("This file doesn't look like a PDF.").waitFor();
  await snap(page, "new template: a file that is not a PDF");
  await page
    .locator('input[type="file"]')
    .setInputFiles(app.writeTempFile("fake-form.pdf", pdf));
  await waitForPdfPreview(page);
  await snap(page, "new template: preview");
  await page.getByLabel("Template name").fill("");
  await page.getByRole("button", { name: "Save template" }).click();
  await snap(page, "new template: no name given");
  await page.getByLabel("Template name").fill("Fake Form");
  await page.getByRole("button", { name: "Save template" }).click();
  await waitForPdfPreview(page);
  await snap(page, "field editor: no fields yet");

  // Field editor
  const canvas = page.locator("canvas").first();
  const at = async (x, y) => {
    const box = await canvas.boundingBox();
    return [box.x + x, box.y + y];
  };
  async function drag(fromX, fromY, toX, toY) {
    await page.mouse.move(...(await at(fromX, fromY)));
    await page.mouse.down();
    await page.mouse.move(...(await at((fromX + toX) / 2, (fromY + toY) / 2)), { steps: 5 });
    await page.mouse.move(...(await at(toX, toY)), { steps: 5 });
    await page.mouse.up();
  }
  await drag(100, 150, 340, 178);
  await dialog(page).waitFor();
  await snap(page, "field editor: naming a new field");
  await page.getByPlaceholder("e.g. Employee Name").fill("Basic Salary");
  await inDialog(page, "Add field");
  await closed(page);
  await snap(page, "field editor: one field, not saved yet");
  await page.mouse.click(...(await at(220, 164)));
  await dialog(page).waitFor();
  await snap(page, "field editor: field settings");
  await inDialog(page, "Done");
  await closed(page);
  await page.getByRole("button", { name: 'Rename field "Basic Salary"' }).click();
  await snap(page, "field editor: rename field");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: 'Delete field "Basic Salary"' }).click();
  await snap(page, "field editor: delete field");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Save template" }).click();
  await snap(page, "field editor: saved");
  await page.getByRole("button", { name: "Back to templates" }).click();

  // Home with a template
  await snap(page, "home: one template");
  await page.getByRole("button", { name: "Rename" }).click();
  await snap(page, "home: rename template");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Delete" }).click();
  await snap(page, "home: delete template");
  await inDialog(page, "Cancel");
  await closed(page);

  // Company details, first visit with nothing saved before
  await page.getByRole("button", { name: "Company details", exact: true }).click();
  await snap(page, "company details: first visit");
  await page.getByRole("button", { name: "Get started" }).click();
  await snap(page, "company details: editor");
  await page.getByRole("button", { name: "Add field" }).click();
  await snap(page, "company details: new unnamed field");
  await page.getByRole("button", { name: 'Remove field "(unnamed field)"' }).click();
  await snap(page, "company details: remove field");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved", { exact: true }).waitFor();
  await snap(page, "company details: saved");

  // Two templates, one without fields, and company details saved the old way
  await seedTemplates(
    page,
    [
      makeTemplate(pdf, { employerFields: COMPANY_DETAILS }),
      makeTemplate(pdf, { id: "tpl-blank", name: "Blank Form", boxes: [] }),
    ],
    LEGACY_COMPANY_DETAILS,
  );
  await page.getByText("Your templates").waitFor();
  await snap(page, "home: two templates");
  await row(page, "Blank Form")
    .getByRole("button", { name: "Company details", exact: true })
    .click();
  await snap(page, "company details: copy existing details or start blank");
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByRole("button", { name: /^Blank Form Last updated/ }).click();
  await page.getByText("This template doesn't have any fields yet.").waitFor();
  await snap(page, "fill-in: template without fields");
  await page.getByRole("button", { name: "Back to templates" }).click();

  // Fill-in screen
  await openFillScreen(page, "Fake Form");
  await snap(page, "fill-in: nothing typed yet");
  await page.getByLabel("Surname", { exact: true }).fill("Testperson");
  await page.getByLabel("Basic Salary", { exact: true }).fill("fifty thousand");
  await page.getByText("This doesn't look like a number.").waitFor();
  await snap(page, "fill-in: values typed, one amount that is not a number");

  await page.getByRole("button", { name: "Positions locked" }).click();
  await snap(page, "fill-in: positions unlocked");
  await drag(300, 215, 320, 225);
  if ((await page.getByRole("dialog").count()) > 0) {
    await inDialog(page, "Done");
    await closed(page);
  }
  await page.getByText("Unsaved changes").waitFor();
  await snap(page, "fill-in: a field was moved");
  await page.getByRole("button", { name: "Reset to template" }).click();
  await page.getByRole("button", { name: "Positions unlocked" }).click();

  await page.mouse.click(...(await at(300, 215)));
  await dialog(page).waitFor();
  await snap(page, "fill-in: field settings");
  await inDialog(page, "Done");
  await closed(page);

  await page.getByRole("button", { name: "Clear values" }).click();
  await snap(page, "fill-in: clear values");
  await inDialog(page, "Cancel");
  await closed(page);

  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await page.getByLabel("Surname", { exact: true }).fill("Sampleton");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await snap(page, "fill-in: two people added");
  await page.getByRole("button", { name: "Delete Person 1" }).click();
  await snap(page, "fill-in: remove a person");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Clear all" }).click();
  await snap(page, "fill-in: clear all people");
  await inDialog(page, "Cancel");
  await closed(page);

  // Import previews
  const choose = async (name, content) => {
    await page.locator('input[type="file"]').setInputFiles(app.writeTempFile(name, content));
    await dialog(page).waitFor();
  };
  await choose("payroll-fake.json", JSON.stringify(PAYROLL_ROWS));
  await snap(page, "import preview: file, with people already added");
  await inDialog(page, "Add to");
  await snap(page, "import preview: Replace chosen");
  await inDialog(page, "Import 3 people");
  await snap(page, "import preview: replace confirmation");
  await inDialog(page, "Cancel");
  await inDialog(page, "Cancel");
  await closed(page);
  await choose("broken.json", "{ this is not json");
  await snap(page, "import preview: file that is not valid JSON");
  await inDialog(page, "Cancel");
  await closed(page);
  await choose("no-match.csv", "Department,Email\nTesting,nobody@example.test\n");
  await snap(page, "import preview: no matching columns");
  await inDialog(page, "Cancel");
  await closed(page);
  await context.close();

  // ---------------- inside the stand-in dashboard ----------------
  const embedded = await app.newContext();
  const outer = await embedded.context.newPage();
  await outer.goto(STANDIN_URL);
  const frame = await (await outer.locator("#app").elementHandle()).contentFrame();
  await frame.getByText("Your templates").waitFor();
  await seedTemplates(frame, [
    makeTemplate(pdf, { employerFields: COMPANY_DETAILS }),
    makeTemplate(pdf, { id: "tpl-blank", name: "Blank Form", boxes: [] }),
  ]);
  await frame.getByText("Your templates").waitFor();
  await snap(frame, "in dashboard: home");

  // Get from dashboard: no answer yet, then refused.
  await frame.getByRole("button", { name: "Get from dashboard" }).click();
  await frame.getByText("Waiting for the dashboard").waitFor();
  await snap(frame, "in dashboard: waiting for an answer");
  const requestId = await outer
    .waitForFunction(
      () => window.hub.received.find((m) => m.message.type === "request-data")?.message.id,
    )
    .then((handle) => handle.jsonValue());
  await outer.evaluate(
    (id) => window.hub.send("response-data", { ok: false, error: "The dashboard is locked." }, id),
    requestId,
  );
  await frame.locator('[role="alert"]').waitFor();
  await snap(frame, "in dashboard: request refused");

  await outer.evaluate(
    (rows) =>
      window.hub.send(
        "send-data",
        { dataType: "payroll-result", rows, meta: { period: "2026-10" } },
        "visible-text-delivery-1",
      ),
    OTHER_PAYROLL_ROWS,
  );
  await frame.locator('[role="status"]').waitFor();
  await snap(frame, "in dashboard: data waiting on the home screen");

  await frame.getByRole("button", { name: /^Blank Form Last updated/ }).click();
  await frame.getByText("This template doesn't have any fields yet.").waitFor();
  await snap(frame, "in dashboard: data waiting, template without fields");
  await frame.getByRole("button", { name: "Back to templates" }).click();

  await openFillScreen(frame, "Fake Form");
  await dialog(frame).waitFor();
  await snap(frame, "in dashboard: import preview, company differs");
  await inDialog(frame, "Cancel");
  await closed(frame);
  await snap(frame, "in dashboard: data not imported yet");
  await reloadApp(frame);
  await embedded.context.close();

  const outside = embedded.outsideRequests;
  if (outside.length > 0) {
    throw new Error(`The app tried to reach outside servers: ${outside.join(", ")}`);
  }
}
