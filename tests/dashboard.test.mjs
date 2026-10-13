// Inside the dashboard, the tool keeps its templates in the dashboard's
// database and its PDFs in the dashboard's bucket (migration plan, Phase 1).
// Run with: node --test tests/dashboard.test.mjs
//
// It drives the real app inside a stand-in dashboard that follows the wire
// contract (tests/helpers/fake-hub.mjs). Nothing leaves the machine.
// TEST data only (made-up company, names and IDs).
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { fillStorage, openFillScreen, startApp } from "./helpers/app.mjs";
import { readPdfText } from "./helpers/read-pdf.mjs";
import { COMPANY_DETAILS, FIELDS, buildSamplePdf, makeTemplate } from "./helpers/fake-data.mjs";
import { openTemplatesStandin } from "./helpers/fake-hub.mjs";

const TIMEOUT = { timeout: 240_000 };
const TEMPLATES_KEY = "pdf-editor:templates";
const VALUES_KEY = "pdf-editor:dashboard-values";
const IMPORTED_KEY = "pdf-editor:imported";
const BACKUP_INPUT = 'input[type="file"][accept=".json,application/json"]';

let app;
let pdf;
let sha;
before(async () => {
  app = await startApp();
  pdf = await buildSamplePdf();
  sha = createHash("sha256").update(pdf).digest("hex");
}, TIMEOUT);
after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------- test data

const T1 = "20000000-0000-4000-8000-000000000001";
const T2 = "20000000-0000-4000-8000-000000000002";

// A template as the dashboard holds it.
const held = (more = {}) => ({
  template_id: T1,
  name: "Dashboard Form",
  revision: 1,
  body: { boxes: FIELDS, employerFields: COMPANY_DETAILS },
  pdf_sha256: sha,
  pdf_file_name: "fake-form.pdf",
  pdf_bytes: pdf.length,
  pdf_pages: 1,
  updated_at: "2026-10-01T08:00:00.000Z",
  ...more,
});
const seedOf = (more = {}) => ({ templates: [held()], files: { [sha]: pdf.toString("base64") }, ...more });

// ------------------------------------------------------------ app driving

// Opens the app inside the stand-in dashboard. `browser` is what this
// browser's own storage holds for the app before it starts.
async function openInDashboard(seed = seedOf(), browser = {}) {
  const { context, page, frame, outsideRequests } = await openTemplatesStandin(app, seed, browser);
  const hub = {
    state: (read) => page.evaluate(read),
    set: (change, arg) => page.evaluate(change, arg),
    log: () => page.evaluate(() => window.hub.state.log),
    templates: () => page.evaluate(() => [...window.hub.state.templates.values()]),
    saves: () => page.evaluate(() => window.hub.state.log.filter((m) => m.kind === "save" && m.dataType === "pdf-template" && m.action === "save")),
  };
  return { context, page, frame, hub, outsideRequests };
}

const bar = (frame) => frame.getByRole("status").filter({ hasText: "kept in the dashboard" });
const loaded = (frame) => bar(frame).waitFor();
const saved = async (frame) => {
  await bar(frame).getByText("Saved", { exact: true }).waitFor();
};
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const dialog = (frame, name) => frame.getByRole("dialog", { name });
const row = (frame, name) => frame.getByRole("button", { name: new RegExp(`^${name} Last updated`) });
const appStorage = (frame) =>
  frame.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])));

async function rename(frame, from, to) {
  await frame.getByRole("listitem").filter({ hasText: from }).getByRole("button", { name: "Rename", exact: true }).click();
  const box = dialog(frame, "Rename template");
  await box.getByLabel("Rename template").fill(to);
  await button(box, "Save").click();
  await row(frame, to).waitFor();
}

// ============================================================ where it reads

test("inside the dashboard the templates come from the dashboard, with their PDFs, and the browser's own are left alone", TIMEOUT, async () => {
  const mine = makeTemplate(pdf, { name: "Browser Form" });
  const { context, frame, hub, outsideRequests } = await openInDashboard(seedOf(), { [TEMPLATES_KEY]: JSON.stringify([mine]) });
  await loaded(frame);

  assert.ok((await bar(frame).innerText()).includes("Templates of ABC Co Ltd, kept in the dashboard."));
  await row(frame, "Dashboard Form").waitFor();
  assert.equal(await row(frame, "Browser Form").count(), 0);
  await saved(frame);

  // The PDF came through the bridge and draws; the fields are the dashboard's.
  await openFillScreen(frame, "Dashboard Form");
  assert.equal(await frame.getByLabel("Surname", { exact: true }).count(), 1);

  // Loading asked and stored nothing; this browser's copy is untouched.
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  assert.equal((await appStorage(frame))[TEMPLATES_KEY], JSON.stringify([mine]));
  assert.deepEqual(outsideRequests, []);
  await context.close();
});

test("an older dashboard that does not keep templates: the tool uses this browser, as before", TIMEOUT, async () => {
  const mine = makeTemplate(pdf, { name: "Browser Form" });
  const { context, frame } = await openInDashboard(seedOf({ supported: false }), { [TEMPLATES_KEY]: JSON.stringify([mine]) });
  await row(frame, "Browser Form").waitFor();
  assert.equal(await bar(frame).count(), 0);
  await rename(frame, "Browser Form", "Renamed In Browser");
  assert.equal(JSON.parse((await appStorage(frame))[TEMPLATES_KEY])[0].name, "Renamed In Browser");
  await context.close();
});

test("when the dashboard cannot be reached at the start, the tool says so and offers Try again", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await hub.set(() => (window.hub.state.failNext = { dataType: "pdf-template", action: "list", code: "unavailable", error: "The dashboard is not connected to a database." }));
  await frame.evaluate(() => location.reload());

  const alert = frame.getByRole("alert");
  await alert.waitFor();
  const text = (await alert.innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes("The templates could not be loaded from the dashboard. The dashboard is not connected to a database. Nothing was changed."), text);
  assert.equal(await frame.getByText("Your templates").count(), 0);

  await button(alert, "Try again").click();
  await row(frame, "Dashboard Form").waitFor();
  await context.close();
});

test("a template whose PDF is missing from the dashboard is a visible error, and the others still load", TIMEOUT, async () => {
  const lost = held({ template_id: T2, name: "Lost Form", pdf_sha256: "c".repeat(64) });
  const { context, frame } = await openInDashboard(seedOf({ templates: [held(), lost] }));
  await loaded(frame);
  await row(frame, "Dashboard Form").waitFor();
  assert.equal(await row(frame, "Lost Form").count(), 0);
  const alert = frame.getByRole("alert");
  assert.ok((await alert.innerText()).includes('"Lost Form" could not be loaded from the dashboard: Its PDF file is missing from the dashboard.'));
  await context.close();
});

// ============================================================== saving

test("a new template: the PDF goes to the dashboard first, under its hash, then the template, and the browser stores nothing", TIMEOUT, async () => {
  const { context, page, frame, hub } = await openInDashboard({ templates: [], files: {} });
  await loaded(frame);
  const before = await appStorage(frame);

  await button(frame, "Upload a PDF").click();
  await frame.locator('input[type="file"][accept="application/pdf"]').setInputFiles(app.writeTempFile("new-form.pdf", pdf));
  await frame.getByLabel("Template name").fill("New In Dashboard");
  await button(frame, "Save template").click();
  await page.waitForFunction(() => window.hub.state.templates.size === 1);
  await saved(frame);

  const log = (await hub.log()).filter((m) => m.kind === "save");
  assert.deepEqual(log.map((m) => [m.dataType, m.action]), [["pdf-file", "upload"], ["pdf-template", "save"]]);
  assert.equal(log[0].sha256, sha);
  const [stored] = await hub.templates();
  assert.deepEqual(
    { name: stored.name, revision: stored.revision, sha: stored.pdf_sha256, file: stored.pdf_file_name, bytes: stored.pdf_bytes, pages: stored.pdf_pages, body: stored.body },
    { name: "New In Dashboard", revision: 1, sha, file: "new-form.pdf", bytes: pdf.length, pages: 1, body: { boxes: [] } },
  );
  // The file in the dashboard is the file that was chosen, byte for byte.
  assert.equal(await hub.set((hash) => window.hub.state.files.get(hash), sha), pdf.toString("base64"));
  assert.match(log[1].template_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(await appStorage(frame), before);
  await context.close();
});

test("a PDF over 5 MB is refused before anything is sent, and the message says why", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard({ templates: [], files: {} });
  await loaded(frame);
  // The same form with padding after its end, to just over 5 MB.
  const big = Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024 + 1 - pdf.length, 0x20)]);
  await button(frame, "Upload a PDF").click();
  await frame.locator('input[type="file"][accept="application/pdf"]').setInputFiles(app.writeTempFile("big-form.pdf", big));
  await frame.getByLabel("Template name").fill("Too Big");
  await button(frame, "Save template").click();

  await frame.getByText("This PDF is larger than 5 MB, the largest the dashboard stores.").waitFor();
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  await context.close();
});

test("a change is saved by itself, carrying the revision last seen; several quick changes make one save", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);

  // Three changes within the same moment, as fast typing or dragging makes them.
  await frame.evaluate(async ([url, id]) => {
    const { templateStore } = await import(/* @vite-ignore */ url);
    templateStore.renameTemplate(id, "First Name");
    templateStore.renameTemplate(id, "Second Name");
    templateStore.renameTemplate(id, "Third Name");
  }, [`${app.appUrl}src/lib/templateStore.ts`, T1]);
  await bar(frame).getByText("Saving…").waitFor();
  await saved(frame);

  const saves = await hub.saves();
  assert.equal(saves.length, 1, "three renames inside a second are one save");
  assert.deepEqual({ name: saves[0].name, expected: saves[0].expected_revision, brn: saves[0].brn }, { name: "Third Name", expected: 1, brn: "C1234567" });
  // The PDF was already there: it is not sent again.
  assert.equal((await hub.log()).filter((m) => m.sentFile).length, 0);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["Third Name", 2]]);
  await context.close();
});

test("never two saves at once for one template: a change made while a save is on its way goes out after it", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await hub.set(() => (window.hub.state.delayMs = 1500));

  await rename(frame, "Dashboard Form", "While Saving One");
  await bar(frame).getByText("Saving…").waitFor();
  await frame.waitForTimeout(1300); // the first save is now with the dashboard
  await rename(frame, "While Saving One", "While Saving Two");
  await saved(frame);

  assert.equal(await hub.state(() => window.hub.state.mostSavesAtOnce), 1);
  const saves = await hub.saves();
  assert.deepEqual(saves.map((s) => [s.name, s.expected_revision]), [["While Saving One", 1], ["While Saving Two", 2]]);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["While Saving Two", 3]]);
  await context.close();
});

test("deleting a template deletes it in the dashboard, at the revision last seen", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await button(frame, "Delete").click();
  await button(dialog(frame, "Delete template?"), "Delete").click();
  await frame.getByText("No templates yet").waitFor();
  await saved(frame);
  assert.deepEqual(await hub.templates(), []);
  const sent = (await hub.log()).find((m) => m.action === "delete");
  assert.deepEqual({ id: sent.template_id, expected: sent.expected_revision }, { id: T1, expected: 1 });
  await context.close();
});

test("the values typed into a form and the People list stay in this browser: nothing of them goes to the dashboard", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await openFillScreen(frame, "Dashboard Form");
  await frame.getByLabel("Surname", { exact: true }).fill("Sampleton-Private");
  await button(frame, "Add & fill next person").click();
  await frame.waitForTimeout(1500);
  await button(frame, "Back to templates").click();

  assert.ok(!JSON.stringify(await hub.log()).includes("Sampleton-Private"));
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  const kept = JSON.parse((await appStorage(frame))[VALUES_KEY]);
  assert.ok(JSON.stringify(kept[T1].entries).includes("Sampleton-Private"));
  // And they are back after a reload.
  await frame.evaluate(() => location.reload());
  await loaded(frame);
  await openFillScreen(frame, "Dashboard Form");
  assert.equal(await frame.getByRole("button", { name: /^Person \d+$/ }).count(), 1);
  await context.close();
});

// ========================================================== when it fails

test("a save the dashboard did not store is marked NOT saved, with the reason, and \"Try saving again\" saves it", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await hub.set(() => (window.hub.state.failNext = { dataType: "pdf-template", action: "save", code: "unavailable", error: "Can't reach the database." }));

  await rename(frame, "Dashboard Form", "Not Stored Yet");
  await bar(frame).getByText("NOT saved").waitFor();
  const alert = frame.getByRole("alert");
  const text = (await alert.innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes('"Not Stored Yet" was NOT saved in the dashboard. Can\'t reach the database.'), text);
  assert.ok(text.includes("it will be gone when this page is closed or reloaded"), text);
  assert.deepEqual((await hub.templates()).map((t) => t.name), ["Dashboard Form"]);

  await button(alert, "Try saving again").click();
  await saved(frame);
  assert.equal(await frame.getByRole("alert").count(), 0);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["Not Stored Yet", 2]]);
  await context.close();
});

test("after \"could not confirm\", the tool looks before saving again: a save that did arrive is not sent twice", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await hub.set(() => (window.hub.state.failNext = { dataType: "pdf-template", action: "save", code: "unavailable", store: true }));

  await rename(frame, "Dashboard Form", "Stored All The Same");
  await saved(frame);

  assert.equal(await frame.getByRole("alert").count(), 0);
  assert.equal((await hub.saves()).length, 1);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["Stored All The Same", 2]]);
  // The next change carries the revision that save produced.
  await rename(frame, "Stored All The Same", "And Again");
  await saved(frame);
  assert.equal((await hub.saves()).at(-1).expected_revision, 2);
  await context.close();
});

test("someone else saved meanwhile: nothing is overwritten unseen; the user chooses the dashboard's version or their own", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  const someoneElseSaves = (name) =>
    hub.set((newName) => {
      const row = [...window.hub.state.templates.values()][0];
      row.name = newName;
      row.revision += 1;
    }, name);

  await someoneElseSaves("Changed By Someone Else");
  await rename(frame, "Dashboard Form", "My Change");
  const alert = frame.getByRole("alert");
  await alert.waitFor();
  assert.ok((await alert.innerText()).includes("Someone else changed it in the dashboard since you opened it."));
  assert.deepEqual((await hub.templates()).map((t) => t.name), ["Changed By Someone Else"]);

  await button(alert, "Use the dashboard's version").click();
  await row(frame, "Changed By Someone Else").waitFor();
  await saved(frame);

  await someoneElseSaves("Changed Again");
  await rename(frame, "Changed By Someone Else", "Mine Wins");
  await button(frame.getByRole("alert"), "Save mine over it").click();
  await saved(frame);
  const [stored] = await hub.templates();
  assert.deepEqual([stored.name, stored.revision], ["Mine Wins", 4]);
  await context.close();
});

test("someone who is not an admin can open and fill in, is told so, and a change is NOT saved", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard(seedOf({ role: "member" }));
  await loaded(frame);
  await frame.getByText("You can open these templates and fill them in. Only an admin of ABC Co Ltd can change them.").waitFor();
  assert.equal(await frame.getByText("in this browser").count(), 0, "no import is offered to a viewer");

  await rename(frame, "Dashboard Form", "A Viewer's Change");
  const alert = frame.getByRole("alert");
  await alert.waitFor();
  assert.ok((await alert.innerText()).includes("Only an admin of this company can change its templates."));
  assert.deepEqual((await hub.templates()).map((t) => t.name), ["Dashboard Form"]);
  await context.close();
});

test("the dashboard switched to another company: a save for the first one is refused, and that company's templates can be loaded", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await hub.set((other) => {
    window.hub.state.brn = "C7654321";
    window.hub.state.label = "XYZ Trading Ltd";
    window.hub.state.templates = new Map([[other.template_id, other]]);
  }, held({ template_id: T2, name: "Other Company Form" }));

  await rename(frame, "Dashboard Form", "For The Wrong Company");
  const alert = frame.getByRole("alert");
  await alert.waitFor();
  assert.ok((await alert.innerText()).includes("The dashboard is now showing another company."));
  assert.deepEqual((await hub.templates()).map((t) => t.name), ["Other Company Form"]);

  await button(alert, "Load that company's templates").click();
  await row(frame, "Other Company Form").waitFor();
  assert.ok((await bar(frame).innerText()).includes("Templates of XYZ Trading Ltd"));
  assert.equal(await row(frame, "For The Wrong Company").count(), 0);
  await context.close();
});

// ================================================ copy to another company

test("Copy to another company: the user picks one of their other companies, and the template here is not changed", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  await button(frame, "Copy to another company").click();
  const box = dialog(frame, "Copy to another company");
  await box.getByLabel("Company").waitFor();
  assert.deepEqual(await box.getByLabel("Company").locator("option").allTextContents(), ["New Venture Ltd"]);
  await box.getByLabel("Name there").fill("Form For New Venture");
  await button(box, "Copy").click();
  await box.getByText("Copied to New Venture Ltd.").waitFor();
  await button(box, "OK").click();

  const copies = await hub.state(() => window.hub.state.copies);
  assert.equal(copies.length, 1);
  assert.deepEqual({ to: copies[0].to_brn, name: copies[0].name, sha: copies[0].pdf_sha256 }, { to: "C0000001", name: "Form For New Venture", sha });
  assert.match(copies[0].new_template_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["Dashboard Form", 1]]);
  await context.close();
});

test("on its own the tool offers no copy to another company and no import", TIMEOUT, async () => {
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [TEMPLATES_KEY, JSON.stringify([makeTemplate(pdf)])]);
  await page.reload();
  await row(page, "Fake Form").waitFor();
  assert.equal(await button(page, "Copy to another company").count(), 0);
  assert.equal(await button(page, "Import to the dashboard").count(), 0);
  assert.equal(await page.getByText("This browser only. Not the dashboard's copy.").count(), 0);
  await context.close();
});

// ============================================================ the import

// This browser: one template with company details, typed values and two
// people, and one whose name the dashboard already uses.
function browserTemplates() {
  const [first, second] = FIELDS;
  return [
    makeTemplate(pdf, {
      id: "tpl-browser-one",
      name: "Browser Only Form",
      employerFields: COMPANY_DETAILS,
      values: { [first.id]: "typed last time" },
      entries: [
        { id: "entry-1", values: { [first.id]: "TEST person one", [second.id]: "1,234.50" } },
        { id: "entry-2", values: { [first.id]: "TEST person two" } },
      ],
    }),
    makeTemplate(pdf, { id: "tpl-browser-two", name: "dashboard form", boxes: FIELDS.slice(0, 2) }),
  ];
}

async function openImport(frame) {
  await button(frame, "Import to the dashboard").click();
  const box = dialog(frame, "Import this browser's templates");
  await box.waitFor();
  return box;
}

async function backUpIn(page, box) {
  const started = page.waitForEvent("download");
  await button(box, "Back up").click();
  const file = await started;
  return JSON.parse(fs.readFileSync(await file.path(), "utf8"));
}

test("import: asks for a backup first, shows what it would do, and writes nothing until told", TIMEOUT, async () => {
  const mine = browserTemplates();
  const { context, page, frame, hub } = await openInDashboard(seedOf(), { [TEMPLATES_KEY]: JSON.stringify(mine) });
  await loaded(frame);
  const notice = frame.getByRole("status").filter({ hasText: "in this browser" });
  assert.ok((await notice.innerText()).replace(/\s+/g, " ").includes("2 templates in this browser are not in the dashboard"));

  const box = await openImport(frame);
  const text = (await box.innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes(`Browser Only Form ${FIELDS.length} fields, PDF 1 KB Will be imported.`), text);
  assert.ok(text.includes("dashboard form 2 fields, PDF 1 KB The dashboard already has a template with this name:"), text);
  // A conflict is never settled silently: left alone unless the user says otherwise.
  assert.equal(await box.getByRole("combobox").inputValue(), "skip");
  assert.ok(await button(box, "Import 1 template").isDisabled(), "not before the backup");

  const backup = await backUpIn(page, box);
  assert.deepEqual(backup.stored[TEMPLATES_KEY].map((t) => t.name), mine.map((t) => t.name));
  await box.getByText("Backup downloaded.").waitFor();
  assert.ok(await button(box, "Import 1 template").isEnabled());

  // So far nothing was sent to be stored, and Cancel leaves everything as it was.
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  await button(box, "Cancel").click();
  assert.equal((await appStorage(frame))[IMPORTED_KEY], undefined);
  assert.equal((await hub.templates()).length, 1);
  await context.close();
});

test("import: each template is stored, checked against this browser's copy and noted; the browser's copy is not changed; a second run imports nothing twice", TIMEOUT, async () => {
  const mine = browserTemplates();
  const { context, page, frame, hub } = await openInDashboard(seedOf(), { [TEMPLATES_KEY]: JSON.stringify(mine) });
  await loaded(frame);

  let box = await openImport(frame);
  await backUpIn(page, box);
  await button(box, "Import 1 template").click();
  await box.getByText("Browser Only Form:").waitFor();
  assert.ok((await box.getByRole("list", { name: "What was imported" }).innerText()).replace(/\s+/g, " ").includes("Browser Only Form: imported and checked."));
  await button(box, "Done").click();

  // In the dashboard: the fields and company details, and the PDF by its hash. No values, no people.
  const imported = (await hub.templates()).find((t) => t.name === "Browser Only Form");
  assert.deepEqual(imported.body, { boxes: FIELDS, employerFields: COMPANY_DETAILS });
  assert.deepEqual([imported.revision, imported.pdf_sha256, imported.pdf_pages], [1, sha, 1]);
  assert.ok(!JSON.stringify(await hub.log()).includes("TEST person"));
  assert.ok(!JSON.stringify(await hub.templates()).includes("typed last time"));

  // In this browser: its own copy exactly as it was; a note of what went where; values and people under the new id.
  const storage = await appStorage(frame);
  assert.equal(storage[TEMPLATES_KEY], JSON.stringify(mine));
  const note = JSON.parse(storage[IMPORTED_KEY])["tpl-browser-one"];
  assert.deepEqual({ id: note.dashboardId, brn: note.brn, company: note.company, name: note.name, revision: note.revision }, { id: imported.template_id, brn: "C1234567", company: "ABC Co Ltd", name: "Browser Only Form", revision: 1 });
  assert.deepEqual(JSON.parse(storage[VALUES_KEY])[imported.template_id], { values: mine[0].values, entries: mine[0].entries });

  // The list shows it, with its two people.
  await row(frame, "Browser Only Form").waitFor();
  await openFillScreen(frame, "Browser Only Form");
  assert.equal(await frame.getByRole("button", { name: /^Person \d+$/ }).count(), 2);
  await button(frame, "Back to templates").click();

  // What is left is the one with a conflict. This time: replace the dashboard's with this browser's.
  const notice = frame.getByRole("status").filter({ hasText: "in this browser" });
  assert.ok((await notice.innerText()).replace(/\s+/g, " ").includes("1 template in this browser is not in the dashboard"));
  box = await openImport(frame);
  assert.ok(!(await box.innerText()).includes("Browser Only Form"), "an imported template is not offered again");
  await box.getByRole("combobox").selectOption("replace");
  await backUpIn(page, box);
  await button(box, "Import 1 template").click();
  await box.getByText("dashboard form:").waitFor();
  assert.ok((await box.innerText()).replace(/\s+/g, " ").includes("dashboard form: imported and checked."));
  await button(box, "Done").click();

  const replaced = (await hub.templates()).find((t) => t.template_id === T1);
  assert.deepEqual([replaced.name, replaced.revision, replaced.body.boxes.length], ["dashboard form", 2, 2]);
  assert.equal((await hub.templates()).length, 2);
  // Nothing left to import: the notice is gone, and the browser's copy is still as it was.
  await row(frame, "dashboard form").waitFor();
  assert.equal(await button(frame, "Import to the dashboard").count(), 0);
  assert.equal((await appStorage(frame))[TEMPLATES_KEY], JSON.stringify(mine));
  await context.close();
});

test("import: when what the dashboard stored is not what this browser holds, the template is NOT marked as imported", TIMEOUT, async () => {
  const mine = browserTemplates().slice(0, 1);
  const { context, page, frame, hub } = await openInDashboard({ templates: [], files: {} }, { [TEMPLATES_KEY]: JSON.stringify(mine) });
  await loaded(frame);
  await hub.set(() => (window.hub.state.corruptNextSave = true));

  const box = await openImport(frame);
  await backUpIn(page, box);
  await button(box, "Import 1 template").click();
  await box.getByText("Browser Only Form:").waitFor();
  const text = (await box.innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes("Browser Only Form: NOT imported. What the dashboard stored is not the same as this browser's copy. This browser's copy is still the one to use."), text);
  await button(box, "Done").click();

  const storage = await appStorage(frame);
  assert.equal(storage[IMPORTED_KEY], undefined);
  assert.equal(storage[TEMPLATES_KEY], JSON.stringify(mine));
  // Still offered, so it can be tried again.
  await button(frame, "Import to the dashboard").waitFor();
  await context.close();
});

test("import: a refused template stays in the browser, the reason is shown, and the others are not affected", TIMEOUT, async () => {
  const mine = [browserTemplates()[0], makeTemplate(pdf, { id: "tpl-browser-three", name: "Third Browser Form", boxes: [] })];
  const { context, page, frame, hub } = await openInDashboard({ templates: [], files: {} }, { [TEMPLATES_KEY]: JSON.stringify(mine) });
  await loaded(frame);
  await hub.set(() => (window.hub.state.failNext = { dataType: "pdf-template", action: "save", code: "too-large", error: "The company has reached the limit for this kind of data." }));

  const box = await openImport(frame);
  await backUpIn(page, box);
  await button(box, "Import 2 templates").click();
  await box.getByText("Third Browser Form:").waitFor();
  const text = (await box.getByRole("list", { name: "What was imported" }).innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes("Browser Only Form: NOT imported. The company has reached the limit for this kind of data."), text);
  assert.ok(text.includes("Third Browser Form: imported and checked."), text);
  await button(box, "Done").click();
  assert.deepEqual(Object.keys(JSON.parse((await appStorage(frame))[IMPORTED_KEY])), ["tpl-browser-three"]);
  assert.deepEqual((await hub.templates()).map((t) => t.name), ["Third Browser Form"]);
  await context.close();
});

test("after an import, opened on its own the tool uses this browser's copy and says which copy it is", TIMEOUT, async () => {
  const mine = browserTemplates().slice(0, 1);
  const note = { "tpl-browser-one": { dashboardId: randomUUID(), brn: "C1234567", company: "ABC Co Ltd", name: "Browser Only Form", revision: 1, importedAt: "2026-10-13T08:00:00.000Z" } };
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.evaluate(([templates, imported]) => {
    localStorage.setItem("pdf-editor:templates", templates);
    localStorage.setItem("pdf-editor:imported", imported);
  }, [JSON.stringify(mine), JSON.stringify(note)]);
  await page.reload();

  await row(page, "Browser Only Form").waitFor();
  await page.getByText("This browser only. Not the dashboard's copy.").waitFor();
  // It still works from the browser, as before.
  await rename(page, "Browser Only Form", "Renamed On Its Own");
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem("pdf-editor:templates")))[0].name, "Renamed On Its Own");

  // A backup made here carries the note and the dashboard values too.
  const started = page.waitForEvent("download");
  await button(page, "Back up").click();
  const backup = JSON.parse(fs.readFileSync(await (await started).path(), "utf8"));
  assert.deepEqual(backup.stored[IMPORTED_KEY], note);
  assert.equal(await page.locator(BACKUP_INPUT).count(), 1);
  await context.close();
});

// ====================================================== history and restore

// The template as it is now (revision 2, saved by this user) and as it was
// first saved by someone else: another name, and only two fields.
function withHistory(more = {}) {
  const now = held({ revision: 2, updated_at: "2026-10-05T09:30:00.000Z" });
  const first = { ...now, revision: 1, name: "First Name", body: { boxes: FIELDS.slice(0, 2) }, updated_at: "2026-10-01T08:00:00.000Z" };
  return seedOf({
    templates: [now],
    history: [
      { ...first, saved_at: first.updated_at, saved_by_you: false },
      { ...now, saved_at: now.updated_at, saved_by_you: true },
    ],
    ...more,
  });
}

async function openHistory(frame) {
  await button(frame, "History").click();
  const box = dialog(frame, 'History of "Dashboard Form"');
  await box.getByRole("list", { name: "Saved versions" }).waitFor();
  return box;
}
const versions = async (box) =>
  (await box.getByRole("list", { name: "Saved versions" }).getByRole("button").allInnerTexts()).map((text) => text.replace(/\s+/g, " ").trim());

test("History lists a template's saved versions, newest first, with the date, the time and who saved it", TIMEOUT, async () => {
  const { context, frame } = await openInDashboard(withHistory());
  await loaded(frame);
  const box = await openHistory(frame);
  assert.deepEqual(await versions(box), [
    "Revision 2 (current) 5 Oct 2026, 09:30, saved by you Dashboard Form",
    "Revision 1 1 Oct 2026, 08:00, saved by someone else First Name",
  ]);
  await context.close();
});

test("History: a version can be looked at, its fields drawn on the PDF, and looking changes nothing", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard(withHistory());
  await loaded(frame);
  const box = await openHistory(frame);
  await box.getByRole("button", { name: /^Revision 1/ }).click();
  await box.getByText("Revision 1: 2 fields on fake-form.pdf").waitFor();
  await box.locator("canvas").waitFor();
  await frame.waitForFunction(() => (document.querySelector('[role="dialog"] canvas')?.width ?? 0) > 310);
  // The two fields of that version are drawn where they were, by name; the current version has more.
  await box.locator(".preview-frame .absolute").first().waitFor();
  const drawn = await box.locator(".preview-frame .absolute").allInnerTexts();
  assert.deepEqual(drawn.sort(), FIELDS.slice(0, 2).map((f) => f.name).sort());
  const first = await box.locator(".preview-frame .absolute").first().boundingBox();
  const canvas = await box.locator("canvas").boundingBox();
  assert.ok(first.x >= canvas.x && first.y >= canvas.y && first.x + first.width <= canvas.x + canvas.width + 1, "a field lies on the page");

  await box.getByRole("button", { name: /^Revision 2/ }).click();
  await box.getByText(`Revision 2: ${FIELDS.length} fields on fake-form.pdf`).waitFor();
  await box.getByText("This is the version in use now.").waitFor();

  // Nothing was saved or restored, and the template is as it was.
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  assert.deepEqual((await hub.templates()).map((t) => [t.name, t.revision]), [["Dashboard Form", 2]]);
  await button(box, "Close").click();
  await row(frame, "Dashboard Form").waitFor();
  await context.close();
});

test("History: \"Restore this version\" asks first, then saves it as a NEW revision; no earlier version is deleted or rewritten", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard(withHistory());
  await loaded(frame);
  const kept = () => hub.state(() => window.hub.state.history.map((h) => ({ revision: h.revision, name: h.name, fields: h.body.boxes.length })));
  const before = await kept();
  const box = await openHistory(frame);
  await box.getByRole("button", { name: /^Revision 1/ }).click();
  await button(box, "Restore this version").click();

  const question = box.getByRole("alert");
  assert.ok((await question.innerText()).includes("Restore revision 1? It is saved as a new revision, and every earlier version is kept."));
  // Cancel: nothing was sent.
  await button(question, "Cancel").click();
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);

  await button(box, "Restore this version").click();
  await button(box.getByRole("alert"), "Restore").click();
  await box.getByText("Restored. It was saved as revision 3; the earlier versions are all still here.").waitFor();

  const sent = (await hub.log()).filter((m) => m.kind === "save");
  assert.deepEqual(sent.map((m) => [m.action, m.revision, m.expected_revision]), [["restore", 1, 2]]);
  // The template is now revision 3 with the first version's name and fields.
  const [now] = await hub.templates();
  assert.deepEqual([now.name, now.revision, now.body.boxes.length], ["First Name", 3, 2]);
  // History only grew: revisions 1 and 2 are exactly as they were.
  const after = await kept();
  assert.deepEqual(after.slice(0, 2), before);
  assert.deepEqual(after[2], { revision: 3, name: "First Name", fields: 2 });
  assert.equal((await versions(box))[0].startsWith("Revision 3 (current)"), true);

  // The tool shows the restored template, and the next change carries revision 3.
  await button(box, "Close").click();
  await row(frame, "First Name").waitFor();
  await saved(frame);
  await rename(frame, "First Name", "After The Restore");
  await saved(frame);
  assert.equal((await hub.saves()).at(-1).expected_revision, 3);
  await context.close();
});

test("History: someone who is not an admin can look at versions but is not offered Restore", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard(withHistory({ role: "member" }));
  await loaded(frame);
  const box = await openHistory(frame);
  await box.getByRole("button", { name: /^Revision 1/ }).click();
  await box.getByText("Revision 1: 2 fields on fake-form.pdf").waitFor();
  await box.getByText("Only an admin of ABC Co Ltd can restore a version.").waitFor();
  assert.equal(await button(box, "Restore this version").count(), 0);
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);
  await context.close();
});

// ================================================== offline, read-only copy

const CACHE_KEY = "pdf-editor:dashboard-cache:C1234567";
const OFFLINE_LABEL = /Offline: read-only copy from \d{1,2} \w+ \d{4} at \d{2}:\d{2}\. Changes can't be saved\./;
const goDown = (hub) => hub.set(() => (window.hub.state.down = true));
const offer = (frame, company) => button(frame, `Open the offline copy of ${company}`);

test("offline: when the dashboard can't be reached, the last copy loaded from it opens read-only, clearly labelled, and can still be filled in and downloaded", TIMEOUT, async () => {
  const { context, page, frame, hub } = await openInDashboard();
  await loaded(frame);
  // Loading kept a copy: what the dashboard holds, and the PDF. No typed values.
  const copy = JSON.parse((await appStorage(frame))[CACHE_KEY]);
  assert.deepEqual({ brn: copy.brn, label: copy.label, names: copy.templates.map((t) => t.name), files: Object.keys(copy.files) }, { brn: "C1234567", label: "ABC Co Ltd", names: ["Dashboard Form"], files: [sha] });
  assert.equal(copy.files[sha], pdf.toString("base64"));

  await goDown(hub);
  await frame.evaluate(() => location.reload());
  await frame.getByText("The templates could not be loaded from the dashboard.").waitFor();
  await offer(frame, "ABC Co Ltd").click();

  const label = frame.getByRole("status").filter({ hasText: "Offline" });
  assert.match((await label.innerText()).replace(/\s+/g, " "), OFFLINE_LABEL);
  assert.ok((await label.innerText()).includes("These are the templates of ABC Co Ltd."));
  await row(frame, "Dashboard Form").waitFor();
  // Nothing that changes a template is offered.
  for (const name of ["Edit fields", "Company details", "Rename", "Delete", "Copy to another company", "History", "New Template", "Upload a PDF", "Back up", "Restore"]) {
    assert.equal(await button(frame, name).count(), 0, name);
  }

  // Filling in and downloading still work.
  await openFillScreen(frame, "Dashboard Form");
  for (const name of ["Edit fields", "Positions locked", "Positions unlocked", "Add fields"]) {
    assert.equal(await frame.getByRole("button", { name }).count(), 0, name);
  }
  assert.match((await label.innerText()).replace(/\s+/g, " "), OFFLINE_LABEL);
  await frame.getByLabel("Surname", { exact: true }).fill("Offline-Sampleton");
  const started = page.waitForEvent("download");
  await button(frame, "Download PDF").click();
  const text = await readPdfText(fs.readFileSync(await (await started).path()));
  assert.ok(JSON.stringify(text).includes("Offline-Sampleton"), JSON.stringify(text).slice(0, 300));
  // What was typed is kept in this browser, as always; nothing was sent to be saved.
  await frame.waitForTimeout(800);
  assert.ok((await appStorage(frame))[VALUES_KEY].includes("Offline-Sampleton"));
  assert.deepEqual((await hub.log()).filter((m) => m.kind === "save"), []);

  // When the dashboard is back, "Try the dashboard again" returns to the live templates.
  await button(frame, "Back to templates").click();
  await hub.set(() => (window.hub.state.down = false));
  await button(frame, "Try the dashboard again").click();
  await loaded(frame);
  assert.equal(await frame.getByText("Offline:").count(), 0);
  assert.equal(await button(frame, "Rename").count(), 1);
  await context.close();
});

test("offline: a copy is kept per company, and each is offered by name with when it was loaded", TIMEOUT, async () => {
  const copyOf = (brn, label, name, loadedAt) =>
    JSON.stringify({ brn, label, loadedAt, templates: [held({ name })], files: { [sha]: pdf.toString("base64") } });
  const { context, frame } = await openInDashboard(seedOf({ down: true }), {
    "pdf-editor:dashboard-cache:C1234567": copyOf("C1234567", "ABC Co Ltd", "ABC Form", "2026-10-12T07:15:00.000Z"),
    "pdf-editor:dashboard-cache:C7654321": copyOf("C7654321", "XYZ Trading Ltd", "XYZ Form", "2026-10-13T16:40:00.000Z"),
  });
  await frame.getByText("The templates could not be loaded from the dashboard.").waitFor();
  await frame.getByText("ABC Co Ltd: a copy from 12 October 2026 at 07:15").waitFor();
  await frame.getByText("XYZ Trading Ltd: a copy from 13 October 2026 at 16:40").waitFor();

  await offer(frame, "XYZ Trading Ltd").click();
  const label = (await frame.getByRole("status").filter({ hasText: "Offline" }).innerText()).replace(/\s+/g, " ");
  assert.ok(label.includes("Offline: read-only copy from 13 October 2026 at 16:40. Changes can't be saved."), label);
  assert.ok(label.includes("These are the templates of XYZ Trading Ltd."), label);
  await row(frame, "XYZ Form").waitFor();
  assert.equal(await row(frame, "ABC Form").count(), 0);
  await context.close();
});

test("offline: when the browser has no room to keep the copy, none is kept and no offline copy is offered", TIMEOUT, async () => {
  const { context, frame, hub } = await openInDashboard();
  await loaded(frame);
  assert.ok((await appStorage(frame))[CACHE_KEY]);

  // The rest of this site's storage is taken, then the templates are loaded again with one
  // more template: the copy no longer fits.
  await hub.set((extra) => window.hub.state.templates.set(extra.template_id, extra), held({ template_id: T2, name: "One More Form" }));
  await fillStorage(frame);
  await frame.evaluate(() => location.reload());
  await loaded(frame);
  await row(frame, "One More Form").waitFor();
  // The tool itself works as usual; there is just no copy, old or new, for this company.
  assert.equal((await appStorage(frame))[CACHE_KEY], undefined);

  await goDown(hub);
  await frame.evaluate(() => location.reload());
  await frame.getByText("The templates could not be loaded from the dashboard.").waitFor();
  await button(frame, "Try again").waitFor();
  assert.equal(await frame.getByRole("button", { name: /^Open the offline copy/ }).count(), 0);
  await context.close();
});

test("on its own the tool has no History and no offline copy: it uses this browser, as before", TIMEOUT, async () => {
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [TEMPLATES_KEY, JSON.stringify([makeTemplate(pdf)])]);
  await page.reload();
  await row(page, "Fake Form").waitFor();
  assert.equal(await button(page, "History").count(), 0);
  assert.equal(await page.getByText("Offline:").count(), 0);
  assert.equal(await button(page, "Edit fields").count(), 1);
  await context.close();
});
