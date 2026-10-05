// Safety net for the visual redesign. Each test drives the real app with
// fake data and compares what happened against a saved recording in
// tests/expected/. These recordings describe behaviour (which value goes
// into which field, what is drawn into the PDF and where, what each data
// path stores), never appearance, so they must pass unchanged before and
// after any restyling.
//
//   npm test                         compare against the recordings
//   UPDATE_RECORDINGS=1 npm test     re-record (only when behaviour is meant to change)
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  STANDIN_URL,
  describeTemplates,
  dialogStrings,
  downloadAndRead,
  loadWriterProbe,
  openFillScreen,
  peopleCount,
  readStoredTemplates,
  reloadApp,
  roundWriterCall,
  seedTemplates,
  startApp,
  waitForPdfPreview,
} from "./helpers/app.mjs";
import {
  COMPANY,
  COMPANY_DETAILS,
  FIELDS,
  OTHER_PAYROLL_ROWS,
  PAYROLL_CSV,
  PAYROLL_ROWS,
  buildSamplePdf,
  makeTemplate,
} from "./helpers/fake-data.mjs";
import { readPdfText } from "./helpers/read-pdf.mjs";
import { checkRecording } from "./helpers/recording.mjs";
import { collectStrings } from "./helpers/visible-text.mjs";

const NOTICE = '[role="status"]';
const TIMEOUT = { timeout: 180_000 };

let app;
before(async () => {
  app = await startApp();
}, TIMEOUT);
after(async () => {
  await app?.close();
});

async function openApp(templates, extraStorage) {
  const { context, outsideRequests } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, templates, extraStorage);
  await page.getByText("Your templates").waitFor();
  await loadWriterProbe(page, app.appUrl);
  return { context, page, outsideRequests };
}

async function formValues(target) {
  const values = {};
  for (const field of FIELDS) {
    values[field.name] = await target
      .getByLabel(field.name, { exact: true })
      .inputValue();
  }
  return values;
}

async function typeInto(target, values) {
  for (const [fieldName, value] of Object.entries(values)) {
    await target.getByLabel(fieldName, { exact: true }).fill(value);
  }
}

async function chooseImportFile(target, file) {
  await target.locator('input[type="file"]').setInputFiles(file);
  await target.getByRole("dialog").waitFor();
}

async function dialogButton(target, name) {
  await target
    .getByRole("dialog")
    .last()
    .getByRole("button", { name, exact: true })
    .click();
}

async function waitForNoDialog(target) {
  await target.getByRole("dialog").first().waitFor({ state: "hidden" });
}

test(
  "field mapping and PDF filling: which value goes into which field, and what ends up in the PDF",
  TIMEOUT,
  async () => {
    const { context, page, outsideRequests } = await openApp([]);
    const recording = {};

    for (const [label, rotated] of [
      ["upright page", false],
      ["page saved rotated by 90 degrees", true],
    ]) {
      const pdf = await buildSamplePdf({ rotated });
      const result = await page.evaluate(
        async ({ base, pdfData, fields, rows }) => {
          const { parseImportRows } = await import(`${base}src/lib/importEntries.ts`);
          const { exportFilledPdf } = await import(`${base}src/lib/pdf.ts`);

          const parsed = parseImportRows(rows, fields);
          window.__writerProbe.start();
          const bytes = await exportFilledPdf(pdfData, fields, parsed.entries);
          const handedToWriter = window.__writerProbe.stop();

          let binary = "";
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return { parsed, handedToWriter, pdfBase64: btoa(binary) };
        },
        {
          base: app.appUrl,
          pdfData: pdf.toString("base64"),
          fields: FIELDS,
          rows: PAYROLL_ROWS,
        },
      );

      const nameById = new Map(FIELDS.map((field) => [field.id, field.name]));
      recording[label] = {
        columnsMatchedToAField: result.parsed.matchedColumns,
        columnsIgnored: result.parsed.unmatchedColumns,
        valueForEachField: result.parsed.entries.map((entry, index) => ({
          person: index + 1,
          fields: Object.fromEntries(
            Object.entries(entry).map(([id, value]) => [nameById.get(id), value]),
          ),
        })),
        handedToPdfWriter: result.handedToWriter.map(roundWriterCall),
        readBackFromPdf: await readPdfText(Buffer.from(result.pdfBase64, "base64")),
      };
    }

    checkRecording("field-mapping-and-pdf", recording);
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

test(
  "fill-in screen: typed values, company autofill and several people in one download",
  TIMEOUT,
  async () => {
    const pdf = await buildSamplePdf();
    const { context, page, outsideRequests } = await openApp([
      makeTemplate(pdf, { employerFields: COMPANY_DETAILS }),
    ]);
    const recording = {};
    await openFillScreen(page, "Fake Form");

    recording.companyDetailsFilledInAutomatically = await formValues(page);

    await typeInto(page, {
      Surname: "Testperson",
      "Other Names": "Alpha",
      "Basic Salary": "50,000.00",
      "Net Pay": "43250.75",
    });
    recording.onePersonForm = await formValues(page);
    recording.onePersonDownload = await downloadAndRead(page);

    await page.getByRole("button", { name: "Add & fill next person" }).click();
    recording.formAfterAddAndFillNext = await formValues(page);
    await typeInto(page, {
      Surname: "Sampleton",
      "Other Names": "Beta Gamma",
      "Basic Salary": "61250.50",
      "Net Pay": "not a number",
    });
    recording.amountWarningShown = await page
      .getByText("This doesn't look like a number.")
      .count();
    recording.secondPersonTypedButNotAddedDownload = await downloadAndRead(page);

    await page.getByRole("button", { name: "Add & fill next person" }).click();
    recording.peopleAfterAddingBoth = await peopleCount(page);

    await page.getByRole("button", { name: "Person 1", exact: true }).click();
    await typeInto(page, { "Net Pay": "44,000.00" });
    await page.getByRole("button", { name: "Person 2", exact: true }).click();
    recording.personTwoForm = await formValues(page);
    await page.getByRole("button", { name: "Person 1", exact: true }).click();
    recording.personOneFormAfterEdit = await formValues(page);
    recording.twoPeopleDownload = await downloadAndRead(page);

    recording.stored = describeTemplates(await readStoredTemplates(page));

    checkRecording("fill-in-screen", recording);
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

test(
  "file import: JSON and CSV, Add to, Replace with its confirmation, and files that can't be used",
  TIMEOUT,
  async () => {
    const pdf = await buildSamplePdf();
    const { context, page, outsideRequests } = await openApp([makeTemplate(pdf)]);
    const recording = {};
    await openFillScreen(page, "Fake Form");

    const jsonFile = app.writeTempFile("payroll-fake.json", JSON.stringify(PAYROLL_ROWS));
    const otherJsonFile = app.writeTempFile(
      "payroll-other-fake.json",
      JSON.stringify(OTHER_PAYROLL_ROWS),
    );
    const csvFile = app.writeTempFile("payroll-fake.csv", PAYROLL_CSV);
    const brokenFile = app.writeTempFile("broken.json", "{ this is not json");
    const notAListFile = app.writeTempFile("not-a-list.json", '{"Surname":"Solo"}');
    const noMatchFile = app.writeTempFile("no-match.csv", "Department,Email\nTesting,nobody@example.test\n");

    await chooseImportFile(page, jsonFile);
    recording.jsonPreview = await dialogStrings(page);
    await dialogButton(page, "Import 3 people");
    await waitForNoDialog(page);
    recording.peopleAfterJsonImport = await peopleCount(page);
    recording.formShowsLastImportedPerson = await formValues(page);

    await chooseImportFile(page, csvFile);
    recording.csvPreviewAddTo = await dialogStrings(page);
    await dialogButton(page, "Add to");
    recording.csvPreviewReplace = await dialogStrings(page);
    await dialogButton(page, "Import 2 people");
    recording.replaceConfirmation = await dialogStrings(page);
    recording.peopleWhileConfirmationIsOpen = await peopleCount(page);
    await dialogButton(page, "Replace all");
    await waitForNoDialog(page);
    recording.peopleAfterReplace = await peopleCount(page);

    await chooseImportFile(page, otherJsonFile);
    await dialogButton(page, "Import 2 people");
    await waitForNoDialog(page);
    recording.peopleAfterAddTo = await peopleCount(page);

    for (const [label, file] of [
      ["brokenJson", brokenFile],
      ["jsonThatIsNotAList", notAListFile],
      ["noMatchingColumns", noMatchFile],
    ]) {
      await chooseImportFile(page, file);
      recording[label] = await dialogStrings(page);
      await dialogButton(page, "Cancel");
      await waitForNoDialog(page);
    }
    recording.peopleAfterUnusableFiles = await peopleCount(page);

    recording.download = await downloadAndRead(page);
    recording.stored = describeTemplates(await readStoredTemplates(page));

    checkRecording("file-import", recording);
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

test(
  "dashboard data: waiting notice, import preview, Add to / Replace, Get from dashboard",
  TIMEOUT,
  async () => {
    const pdf = await buildSamplePdf();
    const { context, outsideRequests } = await app.newContext();
    const page = await context.newPage();
    await page.goto(STANDIN_URL);
    const frame = await (await page.locator("#app").elementHandle()).contentFrame();
    await frame.getByText("Your templates").waitFor();
    await seedTemplates(frame, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
    await frame.getByText("Fake Form").waitFor();
    await loadWriterProbe(frame, app.appUrl);

    const recording = {};
    let messageNumber = 0;
    const hubWait = (predicate, arg) =>
      page.waitForFunction(predicate, arg).then((handle) => handle.jsonValue());

    // Sends data the way the dashboard does and returns the app's answer.
    async function send(payload, id = `test-message-${String(++messageNumber).padStart(4, "0")}`) {
      const repliesBefore = await page.evaluate(
        (wanted) => window.hub.received.filter((m) => m.message.id === wanted).length,
        id,
      );
      await page.evaluate(([p, i]) => window.hub.send("send-data", p, i), [payload, id]);
      return hubWait(
        ([wanted, count]) => {
          const replies = window.hub.received.filter(
            (m) => m.message.type === "received" && m.message.id === wanted,
          );
          return replies.length > count ? replies[replies.length - 1].message.payload : null;
        },
        [id, repliesBefore],
      );
    }
    const payrollResult = (rows, period) => ({
      dataType: "payroll-result",
      rows,
      ...(period ? { meta: { period } } : {}),
    });

    const ready = await hubWait(() => window.hub.received.find((m) => m.message.type === "ready"));
    recording.readyMessage = {
      from: ready.message.from,
      to: ready.message.to,
      version: ready.message.version,
      sentFromTheAppsOwnOrigin: ready.origin === app.appOrigin,
    };
    recording.getFromDashboardButtons = await frame
      .getByRole("button", { name: "Get from dashboard" })
      .count();

    // On the home screen: delivered, held, and described in the notice.
    recording.firstDelivery = await send(payrollResult(PAYROLL_ROWS, "2026-09"), "test-message-first");
    await frame.locator(NOTICE).waitFor();
    recording.noticeOnHomeScreen = await collectStrings(frame, NOTICE);

    recording.sameMessageSentAgain = await send(payrollResult(PAYROLL_ROWS, "2026-09"), "test-message-first");
    recording.noticesAfterRetry = await frame.locator(NOTICE).count();

    recording.newerDelivery = await send(payrollResult(OTHER_PAYROLL_ROWS, "2026-10"));
    await frame.getByText("2 people").waitFor();
    recording.noticeAfterNewerData = await collectStrings(frame, NOTICE);
    recording.noticesAfterNewerData = await frame.locator(NOTICE).count();

    recording.rowsThatCannotBeUsed = await send(payrollResult([{ Surname: "Fine" }, 5]));
    recording.unsupportedDataType = await send({ dataType: "something-else", rows: [{ a: "b" }] });
    recording.noticeAfterRefusedData = await collectStrings(frame, NOTICE);

    recording.waitingDataKeptOutOfBrowserStorage = await frame.evaluate(async (needle) => {
      const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      const databases = indexedDB.databases ? await indexedDB.databases() : [];
      return !stored.includes(needle) && databases.length === 0;
    }, "Mockwell");

    // Opening a template opens the same preview a file gets.
    await openFillScreen(frame, "Fake Form");
    await frame.getByRole("dialog").waitFor();
    recording.previewWithDifferentCompany = await dialogStrings(frame);
    recording.noticeWhilePreviewIsOpen = await collectStrings(frame, NOTICE);
    await dialogButton(frame, "Cancel");
    await waitForNoDialog(frame);
    recording.noticeAfterCancel = await collectStrings(frame, NOTICE);
    await frame.getByRole("button", { name: "Review and import" }).click();
    await dialogButton(frame, "Import 2 people");
    await waitForNoDialog(frame);
    recording.peopleAfterImport = await peopleCount(frame);
    recording.noticesAfterImport = await frame.locator(NOTICE).count();

    // Data arriving on the fill-in screen, with people already there.
    recording.deliveryOnFillScreen = await send(payrollResult(PAYROLL_ROWS));
    await frame.getByRole("dialog").waitFor();
    recording.previewWithMatchingCompany = await dialogStrings(frame);
    await dialogButton(frame, "Add to");
    await dialogButton(frame, "Import 3 people");
    recording.replaceConfirmation = await dialogStrings(frame);
    recording.peopleWhileConfirmationIsOpen = await peopleCount(frame);
    await dialogButton(frame, "Replace all");
    await waitForNoDialog(frame);
    recording.peopleAfterReplace = await peopleCount(frame);
    recording.download = await downloadAndRead(page, frame);
    recording.stored = describeTemplates(await readStoredTemplates(frame));

    // A Replace choice must not carry over to the next delivery.
    await send(payrollResult(OTHER_PAYROLL_ROWS));
    await frame.getByRole("dialog").waitFor();
    await dialogButton(frame, "Add to");
    recording.replaceChosenForOlderData = await dialogStrings(frame);
    await send(payrollResult(PAYROLL_ROWS, "2026-11"));
    await frame.getByText("3 people found in this data.").waitFor();
    recording.newerDataResetsToAddTo = await dialogStrings(frame);
    await dialogButton(frame, "Cancel");
    await waitForNoDialog(frame);

    await frame.getByRole("button", { name: "Discard" }).click();
    await frame.locator(NOTICE).waitFor({ state: "detached" });
    recording.noticesAfterDiscard = await frame.locator(NOTICE).count();
    recording.peopleAfterDiscard = await peopleCount(frame);

    // Get from dashboard: approved, then refused.
    await frame.getByRole("button", { name: "Back to templates" }).click();
    await page.evaluate((rows) => {
      window.hub.requestReply = { ok: true, dataType: "payroll-result", rows, meta: { period: "2026-08" } };
    }, PAYROLL_ROWS);
    await frame.getByRole("button", { name: "Get from dashboard" }).click();
    await frame.locator(NOTICE).waitFor();
    recording.noticeAfterGetFromDashboard = await collectStrings(frame, NOTICE);
    const request = await hubWait(() => window.hub.received.find((m) => m.message.type === "request-data"));
    recording.requestSentToDashboard = { type: request.message.type, payload: request.message.payload };

    await page.evaluate(() => {
      window.hub.requestReply = { ok: false, error: "The dashboard is locked.", code: "locked" };
    });
    await frame.getByRole("button", { name: "Get from dashboard" }).click();
    await frame.locator('[role="alert"]').waitFor();
    recording.refusedRequest = await collectStrings(frame, '[role="alert"]');
    recording.noticeKeptAfterRefusedRequest = await collectStrings(frame, NOTICE);

    // A reload is the end of waiting data.
    await reloadApp(frame);
    await frame.getByText("Fake Form").waitFor();
    recording.noticesAfterReload = await frame.locator(NOTICE).count();

    // Opened on its own, none of this exists.
    const alone = await context.newPage();
    await alone.goto(app.appUrl);
    await alone.getByText("Your templates").waitFor();
    recording.standalone = {
      getFromDashboardButtons: await alone.getByRole("button", { name: "Get from dashboard" }).count(),
      notices: await alone.locator(NOTICE).count(),
    };

    checkRecording("dashboard-data", recording);
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

test(
  "templates and the field editor: create, place fields, style, move, rename, delete, and reload",
  TIMEOUT,
  async () => {
    const pdf = await buildSamplePdf();
    const pdfFile = app.writeTempFile("fake-form.pdf", pdf);
    const { context, page, outsideRequests } = await openApp([]);
    const recording = {};
    const stored = async () =>
      describeTemplates(await readStoredTemplates(page), pdf.toString("base64"));

    // New template.
    await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(pdfFile);
    await page.getByLabel("Template name").fill("Fake Form");
    await page.getByRole("button", { name: "Save template" }).click();
    await page.getByRole("heading", { name: "Fake Form" }).waitFor();
    await waitForPdfPreview(page);
    recording.afterCreating = await stored();

    // All mouse positions are measured from the PDF page's own top-left
    // corner, the same way the editor measures them.
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
    async function drawField(name, x1, y1, x2, y2) {
      await drag(x1, y1, x2, y2);
      await page.getByPlaceholder("e.g. Employee Name").fill(name);
      await dialogButton(page, "Add field");
      await waitForNoDialog(page);
    }

    await drawField("Surname", 100, 150, 340, 178);
    await drawField("Basic Salary", 100, 220, 260, 246);
    recording.unsavedChangesShown = await page.getByText("Unsaved changes").count();
    await page.getByRole("button", { name: "Save template" }).click();
    recording.afterDrawingTwoFields = await stored();

    // Field settings.
    await page.mouse.click(...(await at(220, 164)));
    await page.getByRole("dialog").waitFor();
    recording.fieldSettingsDialog = await dialogStrings(page);
    await dialogButton(page, "Courier");
    await page.getByLabel("Font size").fill("14");
    await dialogButton(page, "Right");
    await dialogButton(page, "Bold off");
    await dialogButton(page, "Amount");
    await dialogButton(page, "Done");
    await waitForNoDialog(page);

    // Move a field by dragging it.
    await drag(180, 233, 220, 263);
    recording.settingsOpenAfterDragging = await page.getByRole("dialog").count();
    if (recording.settingsOpenAfterDragging > 0) {
      await dialogButton(page, "Done");
      await waitForNoDialog(page);
    }

    await page.getByRole("button", { name: 'Rename field "Surname"' }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Family Name");
    await dialogButton(page, "Save");
    await waitForNoDialog(page);

    await page.getByRole("button", { name: "Save template" }).click();
    recording.afterStyleMoveAndRename = await stored();

    await page.reload();
    await page.getByText("Your templates").waitFor();
    recording.afterReload = await stored();

    await page.getByRole("button", { name: "Edit fields" }).click();
    await waitForPdfPreview(page);
    await page.getByRole("button", { name: 'Delete field "Basic Salary"' }).click();
    recording.deleteFieldDialog = await dialogStrings(page);
    await dialogButton(page, "Delete");
    await waitForNoDialog(page);
    await page.getByRole("button", { name: "Save template" }).click();
    recording.afterDeletingAField = await stored();
    await page.getByRole("button", { name: "Back to templates" }).click();

    // Template rename and company details.
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill("Fake Form Renamed");
    await dialogButton(page, "Save");
    await waitForNoDialog(page);

    await page.getByRole("button", { name: "Company details", exact: true }).click();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("Company Name", { exact: true }).fill(COMPANY.name);
    await page.getByRole("button", { name: "Add field" }).click();
    await page.getByLabel("Field name").last().fill("BRN");
    await page.getByLabel("BRN", { exact: true }).fill(COMPANY.brn);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved", { exact: true }).waitFor();

    await page.reload();
    await page.getByText("Your templates").waitFor();
    recording.afterRenameAndCompanyDetails = await stored();

    // The fill-in screen lists the fields that were saved.
    await openFillScreen(page, "Fake Form Renamed");
    recording.fillScreenFieldNames = await page.getByRole("textbox").evaluateAll((inputs) =>
      inputs.map((input) => document.querySelector(`label[for="${input.id}"]`)?.textContent),
    );
    await page.getByRole("button", { name: "Back to templates" }).click();

    await page.getByRole("button", { name: "Delete" }).click();
    recording.deleteTemplateDialog = await dialogStrings(page);
    await dialogButton(page, "Delete");
    await waitForNoDialog(page);
    recording.afterDeletingTheTemplate = await stored();

    checkRecording("templates-and-field-editor", recording);
    assert.deepEqual(outsideRequests, []);
    await context.close();
  },
);

// Positions are the riskiest thing a restyle of the field editor could
// disturb, so this records them at every step: after drawing a field, after
// dragging it, after resizing it from two different corners, after a
// reload, and after moving and resizing it again on the fill-in screen. It
// then fills the field in and records where the value lands in the PDF.
// All of it twice: on an upright page and on a page saved rotated by 90.
test(
  "field positions and sizes after dragging and resizing, on an upright and a rotated page",
  TIMEOUT,
  async () => {
    const recording = {};

    for (const [label, rotated] of [
      ["upright page", false],
      ["page saved rotated by 90 degrees", true],
    ]) {
      const pdf = await buildSamplePdf({ rotated });
      const pdfFile = app.writeTempFile(rotated ? "fake-rotated.pdf" : "fake-upright.pdf", pdf);
      const { context, page, outsideRequests } = await openApp([]);
      const steps = {};
      const settingsOpenedAfter = {};
      const fields = async () =>
        describeTemplates(await readStoredTemplates(page))[0].fields;

      await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles(pdfFile);
      await page.getByLabel("Template name").fill("Fake Form");
      await page.getByRole("button", { name: "Save template" }).click();
      await page.getByRole("heading", { name: "Fake Form" }).waitFor();
      await waitForPdfPreview(page);

      // Measured from the page's own top-left corner, as the editor does.
      const canvas = page.locator("canvas").first();
      async function drag(fromX, fromY, toX, toY) {
        const box = await canvas.boundingBox();
        const point = (x, y) => [box.x + x, box.y + y];
        await page.mouse.move(...point(fromX, fromY));
        await page.mouse.down();
        await page.mouse.move(...point((fromX + toX) / 2, (fromY + toY) / 2), { steps: 5 });
        await page.mouse.move(...point(toX, toY), { steps: 5 });
        await page.mouse.up();
      }
      // Records whether letting go opened the field's settings (a known
      // oddity, see docs/KNOWN_ISSUES.md), and closes them if so.
      async function settle(step) {
        await page.waitForTimeout(150);
        settingsOpenedAfter[step] = await page.getByRole("dialog").count();
        if (settingsOpenedAfter[step] > 0) {
          await dialogButton(page, "Done");
          await waitForNoDialog(page);
        }
      }
      const save = (name) => page.getByRole("button", { name, exact: true }).click();

      steps.pageShownAt = await canvas.evaluate((el) => `${el.width} x ${el.height}`);

      // Draw: corners at (100,150) and (340,178) on the 800px-wide page.
      await drag(100, 150, 340, 178);
      await page.getByPlaceholder("e.g. Employee Name").fill("Surname");
      await dialogButton(page, "Add field");
      await waitForNoDialog(page);
      await save("Save template");
      steps.afterDrawing = await fields();

      // Move by 60 right, 40 down: corners now (160,190) and (400,218).
      await drag(220, 164, 280, 204);
      await settle("moving in the editor");
      await save("Save template");
      steps.afterMoving = await fields();

      // Resize from the bottom-right handle by 60 right, 20 down.
      await drag(400, 218, 460, 238);
      await settle("resizing from the bottom-right handle");
      await save("Save template");
      steps.afterResizingFromBottomRight = await fields();

      // Resize from the top-left handle by 30 left, 10 up.
      await drag(160, 190, 130, 180);
      await settle("resizing from the top-left handle");
      await save("Save template");
      steps.afterResizingFromTopLeft = await fields();

      await page.reload();
      await page.getByText("Your templates").waitFor();
      await loadWriterProbe(page, app.appUrl);
      steps.afterReload = await fields();

      // The fill-in screen can move and resize fields too, once unlocked.
      await openFillScreen(page, "Fake Form");
      await page.getByRole("button", { name: "Positions locked" }).click();
      await drag(200, 200, 220, 230);
      await settle("moving on the fill-in screen");
      await drag(480, 268, 500, 280);
      await settle("resizing on the fill-in screen");
      steps.unsavedChangesShown = await page.getByText("Unsaved changes").count();
      await save("Save changes to template");
      steps.afterMovingAndResizingOnFillScreen = await fields();
      await page.getByRole("button", { name: "Positions unlocked" }).click();

      // And where a value typed into that field ends up in the PDF.
      await page.getByLabel("Surname", { exact: true }).fill("Testperson");
      steps.download = await downloadAndRead(page);
      steps.settingsOpenedAfter = settingsOpenedAfter;

      recording[label] = steps;
      assert.deepEqual(outsideRequests, []);
      await context.close();
    }

    checkRecording("field-positions-drag-and-resize", recording);
  },
);
