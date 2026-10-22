// One walk through every screen and dialog of the app, with fake data.
// Shared by the visible-text check (which records the words at each stop)
// and the accessibility check (which measures contrast at each stop).
import { createHash } from "node:crypto";
import { openTemplatesStandin } from "./fake-hub.mjs";
import { A4, buildFakeForm, file, makeImage } from "./fake-images.mjs";
import {
  addFullPageImages,
  chooseBoxImage,
  chooseForm,
  dragOnPage,
  openFormImages,
  sharpeningDone,
} from "./form-images-tool.mjs";
import {
  STANDIN_URL,
  fillStorage,
  openFillScreen,
  readStoredTemplates,
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

  // Characters the PDF fonts cannot print: one in a listed person, one in
  // the person still in the form, and a tab.
  await page.getByRole("button", { name: "Person 1", exact: true }).click();
  await page.getByLabel("Surname", { exact: true }).fill("Wroński\tTest");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await page.getByLabel("Surname", { exact: true }).fill("Łukasz");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  await downloaded;
  await dialog(page).getByText("Some characters could not be printed").waitFor();
  await snap(page, "fill-in: some characters could not be printed");
  await inDialog(page, "OK");
  await closed(page);

  // The browser's storage full: a change that cannot be stored.
  await page.getByLabel("Surname", { exact: true }).fill("");
  await page.getByRole("button", { name: "Person 2", exact: true }).click();
  await readStoredTemplates(page); // gives the app time to save
  await fillStorage(page);
  await page.getByLabel("Surname", { exact: true }).fill("Sampleton-Placeholder");
  await dialog(page).getByText("This was NOT saved").waitFor();
  await snap(page, "fill-in: NOT saved warning");
  await inDialog(page, "OK");
  await closed(page);
  await page.getByText("Not saved", { exact: true }).waitFor();
  await snap(page, "fill-in: marked NOT saved");
  await page.getByRole("button", { name: "Back to templates" }).click();
  await row(page, "Fake Form").getByRole("button", { name: "Rename" }).click();
  await dialog(page).getByRole("textbox").fill("Fake Form with a much longer name");
  await inDialog(page, "Save");
  await dialog(page).getByText("This was NOT saved").waitFor();
  // The rename dialog is still fading out behind the warning for a moment.
  await page.locator('input[aria-label="Rename template"]').waitFor({ state: "detached" });
  await snap(page, "home: NOT saved warning");
  await inDialog(page, "OK");
  await closed(page);

  // Back up and Restore. The storage is still full here, so the first
  // restore is refused; then room is made and it goes through.
  const backupFile = (content) => ({
    name: "pdf-form-filler-backup-2026-10-13.json",
    mimeType: "application/json",
    buffer: Buffer.from(typeof content === "string" ? content : JSON.stringify(content)),
  });
  const people = (count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `entry-${index + 1}`,
      values: { "f-surname": `Sampleton ${index + 1}`, "f-other": "Fake Person" },
    }));
  const fakeBackup = {
    _meta: { app: "pdf-form-filler-backup", version: 1, exportedAt: "2026-10-13T08:05:00.000Z" },
    stored: {
      "pdf-editor:templates": [
        makeTemplate(pdf, { employerFields: COMPANY_DETAILS, entries: people(400) }),
        makeTemplate(pdf, { id: "tpl-one-field", name: "One Field Form", boxes: [makeTemplate(pdf).boxes[0]], entries: people(1) }),
      ],
      "pdf-editor:employer-fields": COMPANY_DETAILS,
    },
    unreadable: { "pdf-editor:employer-profile": '{"companyName":' },
  };
  const chooseBackup = (content) =>
    page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles(backupFile(content));

  await chooseBackup(fakeBackup);
  await dialog(page).getByText("Restore this backup?").waitFor();
  await snap(page, "restore: what is in the file and in the browser");
  await inDialog(page, "Replace with this backup");
  await dialog(page).getByText("The backup was NOT restored").waitFor();
  await snap(page, "restore: NOT restored, storage full");
  await inDialog(page, "OK");
  await closed(page);

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("zz_test_fill_")) localStorage.removeItem(key);
    }
  });
  await chooseBackup("just some notes, not a backup");
  await dialog(page).getByText("This file cannot be restored").waitFor();
  await snap(page, "restore: a file that is not a backup");
  await inDialog(page, "OK");
  await closed(page);

  await chooseBackup({ ...fakeBackup, _meta: { ...fakeBackup._meta, version: 2 } });
  await dialog(page).getByText("This file cannot be restored").waitFor();
  await snap(page, "restore: a backup of another version");
  await inDialog(page, "OK");
  await closed(page);

  await chooseBackup(fakeBackup);
  await dialog(page).getByText("Restore this backup?").waitFor();
  await inDialog(page, "Replace with this backup");
  await dialog(page).getByText("Backup restored").waitFor();
  await snap(page, "restore: backup restored");
  await inDialog(page, "OK");
  await closed(page);
  await row(page, "One Field Form").waitFor();

  // Form & images, with a fake form and fake images.
  await openFormImages(page);
  await snap(page, "form & images: no form yet");
  await page
    .getByTestId("form-input")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await page.getByRole("alert").waitFor();
  await snap(page, "form & images: a file that is not a form");
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }, { size: A4 }]))], 2);
  await snap(page, "form & images: a form, no boxes");
  await dragOnPage(page, 1, 210, [20, 30], [60, 60]);
  await snap(page, "form & images: a box without an image");
  await chooseBoxImage(page, "fake-logo.png", await makeImage(page, { width: 780, height: 500 }));
  // Small enough to be sharpened at once; the walk waits for it.
  await addFullPageImages(page, [file("fake-logo.png", await makeImage(page, { width: 60, height: 40 }))]);
  await sharpeningDone(page);
  await page.getByLabel("Box width in cm").fill("9.5");
  await page.getByRole("button", { name: "Set size", exact: true }).click();
  await page.getByText("A box can't be larger than its size limit", { exact: false }).waitFor();
  await snap(page, "form & images: a box at its size limit, a full-page image");
  await page.getByLabel("Box width in cm").fill("0.2");
  await page.getByRole("button", { name: "Set size", exact: true }).click();
  await page.getByText("at least 0.5 cm wide and high", { exact: false }).waitFor();
  await snap(page, "form & images: a box made as small as a box can be");
  await page.getByLabel("Limit width in cm").fill("2");
  await page.getByLabel("Limit height in cm").fill("2");
  await page.getByRole("button", { name: "Set limit", exact: true }).click();
  await page.getByText("to fit its new size limit", { exact: false }).waitFor();
  await snap(page, "form & images: a box made smaller by a new limit");
  await page.getByRole("button", { name: "Compare before and after", exact: true }).click();
  await dialog(page).locator("img").nth(1).waitFor();
  await snap(page, "form & images: before and after");
  await page.keyboard.press("Escape");
  await closed(page);
  await page.getByRole("button", { name: "Delete box", exact: true }).click();
  await snap(page, "form & images: delete a box");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: 'Remove "fake-logo.png"', exact: true }).click();
  await snap(page, "form & images: remove a full-page image");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Use another form", exact: true }).click();
  await snap(page, "form & images: use another form");
  await inDialog(page, "Cancel");
  await closed(page);
  await page.getByRole("button", { name: "Back to templates", exact: true }).click();
  await snap(page, "form & images: leave?");
  await inDialog(page, "Leave");
  await page.getByText("Your templates").waitFor();
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
      () => window.hub.received.find((m) => m.message.type === "request-data" && m.message.payload.dataType === "payroll-result")?.message.id,
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

  // ---------------- inside a dashboard that keeps the templates ----------------
  const sha = createHash("sha256").update(pdf).digest("hex");
  const heldTemplate = (more = {}) => ({
    template_id: "20000000-0000-4000-8000-000000000001",
    name: "Dashboard Form",
    revision: 1,
    body: { boxes: makeTemplate(pdf).boxes, employerFields: COMPANY_DETAILS },
    pdf_sha256: sha,
    pdf_file_name: "fake-form.pdf",
    pdf_bytes: pdf.length,
    pdf_pages: 1,
    updated_at: "2026-10-01T08:00:00.000Z",
    ...more,
  });
  const dashboardHolds = (more = {}) => ({
    templates: [heldTemplate()],
    files: { [sha]: pdf.toString("base64") },
    ...more,
  });
  const inBrowser = {
    "pdf-editor:templates": JSON.stringify([
      makeTemplate(pdf, { id: "tpl-browser-one", name: "Browser Only Form" }),
      makeTemplate(pdf, { id: "tpl-browser-two", name: "Dashboard Form", boxes: [] }),
    ]),
  };
  const bar = (target) => target.getByRole("status").filter({ hasText: "kept in the dashboard" });
  const savedThere = (target) => bar(target).getByText("Saved", { exact: true }).waitFor();
  async function renameTo(target, from, to) {
    await row(target, from).getByRole("button", { name: "Rename" }).click();
    await dialog(target).getByRole("textbox").fill(to);
    await inDialog(target, "Save");
    await closed(target);
  }

  const kept = await openTemplatesStandin(app, dashboardHolds(), inBrowser);
  const hubPage = kept.page;
  const tool = kept.frame;
  await bar(tool).waitFor();
  await snap(tool, "dashboard templates: home, with templates to import");

  await tool.getByRole("button", { name: "Copy to another company" }).click();
  await dialog(tool).getByLabel("Company").waitFor();
  await snap(tool, "dashboard templates: copy to another company");
  await inDialog(tool, "Copy");
  await dialog(tool).getByText("Copied to New Venture Ltd.").waitFor();
  await snap(tool, "dashboard templates: copied");
  await inDialog(tool, "OK");
  await closed(tool);

  await tool.getByRole("button", { name: "Import to the dashboard" }).click();
  await dialog(tool).getByText("What will be imported").waitFor();
  await snap(tool, "dashboard templates: import, before the backup");
  const backupSaved = hubPage.waitForEvent("download");
  await inDialog(tool, "Back up");
  await backupSaved;
  await dialog(tool).getByText("Backup downloaded.").waitFor();
  await snap(tool, "dashboard templates: import, backup saved");
  await inDialog(tool, "Import 1 template");
  await dialog(tool).getByText("imported and checked.").waitFor();
  await snap(tool, "dashboard templates: import results");
  await inDialog(tool, "Done");
  await closed(tool);

  // A save the dashboard does not store, then one that someone else got in before.
  await hubPage.evaluate(() => {
    window.hub.state.failNext = { dataType: "pdf-template", action: "save", code: "unavailable", error: "Can't reach the database." };
  });
  await renameTo(tool, "Browser Only Form", "Form Not Saved Yet");
  await bar(tool).getByText("NOT saved").waitFor();
  await snap(tool, "dashboard templates: NOT saved");
  await tool.getByRole("button", { name: "Try saving again" }).click();
  await savedThere(tool);
  await hubPage.evaluate(() => {
    const held = [...window.hub.state.templates.values()].find((t) => t.name === "Form Not Saved Yet");
    held.name = "Changed By Someone Else";
    held.revision += 1;
  });
  await renameTo(tool, "Form Not Saved Yet", "My Own Change");
  await tool.getByRole("button", { name: "Use the dashboard's version" }).waitFor();
  await snap(tool, "dashboard templates: someone else saved meanwhile");
  await tool.getByRole("button", { name: "Use the dashboard's version" }).click();
  await savedThere(tool);

  await openFillScreen(tool, "Changed By Someone Else");
  await snap(tool, "dashboard templates: fill-in screen");
  await tool.getByRole("button", { name: "Back to templates" }).click();

  // History: the saved versions, one of them looked at, and a restore. The stand-in
  // dashboard's clock is held still so the dates shown are the same on every run.
  await hubPage.evaluate(() => {
    const RealDate = Date;
    const fixed = new RealDate("2026-10-13T08:05:00.000Z").getTime();
    window.Date = class extends RealDate {
      constructor(...args) {
        if (args.length > 0) super(...args);
        else super(fixed);
      }
      static now() {
        return fixed;
      }
    };
    for (const kept of window.hub.state.history) kept.saved_at = `2026-10-0${Math.min(kept.revision, 9)}T08:00:00.000Z`;
  });
  await renameTo(tool, "Dashboard Form", "Dashboard Form Renamed");
  await savedThere(tool);
  await row(tool, "Dashboard Form Renamed").getByRole("button", { name: "History" }).click();
  await dialog(tool).getByRole("list", { name: "Saved versions" }).waitFor();
  await snap(tool, "dashboard templates: history");
  await dialog(tool).getByRole("button", { name: /^Revision 1/ }).click();
  await dialog(tool).getByText("Revision 1:").waitFor();
  await tool.waitForFunction(() => (document.querySelector('[role="dialog"] canvas')?.width ?? 0) > 310);
  await snap(tool, "dashboard templates: history, a version shown");
  await inDialog(tool, "Restore this version");
  await snap(tool, "dashboard templates: history, restore question");
  await inDialog(tool, "Restore");
  await dialog(tool).getByText("Restored.").waitFor();
  await snap(tool, "dashboard templates: history, restored");
  await inDialog(tool, "Close");
  await closed(tool);
  await row(tool, "Dashboard Form").first().waitFor();

  // The dashboard switches to another company.
  await hubPage.evaluate((other) => {
    window.hub.state.brn = "C7654321";
    window.hub.state.label = "XYZ Trading Ltd";
    window.hub.state.templates = new Map([[other.template_id, other]]);
  }, heldTemplate({ template_id: "20000000-0000-4000-8000-000000000002", name: "Other Company Form" }));
  await renameTo(tool, "Changed By Someone Else", "For The Wrong Company");
  await tool.getByRole("button", { name: "Load that company's templates" }).waitFor();
  await snap(tool, "dashboard templates: the dashboard shows another company");
  await kept.context.close();

  // Someone who is not an admin, with a template whose PDF is missing, and nowhere to copy to.
  const viewer = await openTemplatesStandin(
    app,
    dashboardHolds({
      role: "member",
      others: [],
      templates: [heldTemplate(), heldTemplate({ template_id: "20000000-0000-4000-8000-000000000003", name: "Lost Form", pdf_sha256: "c".repeat(64) })],
    }),
  );
  await bar(viewer.frame).waitFor();
  await snap(viewer.frame, "dashboard templates: not an admin, and a PDF is missing");
  await viewer.frame.getByRole("button", { name: "Copy to another company" }).click();
  await dialog(viewer.frame).getByText("You are not an admin of any other company").waitFor();
  await snap(viewer.frame, "dashboard templates: no other company to copy to");
  await inDialog(viewer.frame, "OK");
  await closed(viewer.frame);

  await viewer.frame.getByRole("button", { name: "History" }).click();
  await dialog(viewer.frame).getByRole("button", { name: /^Revision 1/ }).click();
  await dialog(viewer.frame).getByText("Only an admin of").waitFor();
  await snap(viewer.frame, "dashboard templates: history, not an admin");
  await inDialog(viewer.frame, "Close");
  await closed(viewer.frame);

  // The dashboard cannot be reached when the tool opens. The copy this browser kept when it
  // last loaded the templates is given a fixed date, so the words are the same on every run.
  await viewer.frame.evaluate(() => {
    const key = "pdf-editor:dashboard-cache:C1234567";
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), loadedAt: "2026-10-13T08:05:00.000Z" }));
  });
  await viewer.page.evaluate(() => {
    window.hub.state.down = true;
  });
  await viewer.frame.evaluate(() => location.reload());
  await viewer.frame.getByRole("button", { name: "Try again" }).waitFor();
  await snap(viewer.frame, "dashboard templates: could not be loaded");

  // The offline copy: read-only, and it can still be filled in.
  await viewer.frame.getByRole("button", { name: "Open the offline copy of ABC Co Ltd" }).click();
  await viewer.frame.getByText("Offline: read-only copy from").waitFor();
  await snap(viewer.frame, "offline copy: home");
  await openFillScreen(viewer.frame, "Dashboard Form");
  await snap(viewer.frame, "offline copy: fill-in screen");
  await viewer.context.close();

  // On its own again, after an import: which copy this is.
  const alone = await app.newContext();
  const alonePage = await alone.context.newPage();
  await alonePage.goto(app.appUrl);
  await alonePage.getByText("Your templates").waitFor();
  await seedTemplates(alonePage, [makeTemplate(pdf)], {
    "pdf-editor:imported": JSON.stringify({
      "tpl-fake-form": { dashboardId: "20000000-0000-4000-8000-000000000001", brn: "C1234567", company: "ABC Co Ltd", name: "Fake Form", revision: 1, importedAt: "2026-10-13T08:00:00.000Z" },
    }),
  });
  await alonePage.getByText("This browser only. Not the dashboard's copy.").waitFor();
  await snap(alonePage, "home: this browser only, after an import");
  await alone.context.close();

  for (const requests of [kept.outsideRequests, viewer.outsideRequests, alone.outsideRequests]) {
    if (requests.length > 0) {
      throw new Error(`The app tried to reach outside servers: ${requests.join(", ")}`);
    }
  }
}
