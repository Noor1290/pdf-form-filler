// Where the tool keeps its data: the full backup file ("Back up" and
// "Restore"), the one interface every screen reads and saves through, and
// the dashboard bridge reporting that someone is working in the tool.
// Run with: node --test tests/storage.test.mjs
//
// It drives the real app in a throwaway browser profile. TEST data only
// (company "ABC Co Ltd", made-up names and IDs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HUB_ORIGIN,
  STANDIN_URL,
  fillStorage,
  openFillScreen,
  seedTemplates,
  startApp,
} from "./helpers/app.mjs";
import { COMPANY_DETAILS, FIELDS, buildSamplePdf, makeTemplate } from "./helpers/fake-data.mjs";

const TIMEOUT = { timeout: 240_000 };
const TEMPLATES_KEY = "pdf-editor:templates";
const LEGACY_KEY = "pdf-editor:employer-fields";
const THEME_KEY = "pdf-editor:theme";
const BACKUP_INPUT = 'input[type="file"][accept=".json,application/json"]';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../src");

let app;
let pdf;
before(async () => {
  app = await startApp();
  pdf = await buildSamplePdf();
}, TIMEOUT);
after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------- test data

// Two templates: one with company details, typed values and two people,
// one bare. Plus company details from before they became per-template.
function twoTemplates() {
  const [first, second] = FIELDS;
  return [
    makeTemplate(pdf, {
      employerFields: COMPANY_DETAILS,
      values: { [first.id]: "typed last time" },
      entries: [
        { id: "entry-1", values: { [first.id]: "TEST person one", [second.id]: "1,234.50" } },
        { id: "entry-2", values: { [first.id]: "TEST person two", [second.id]: "0.10" } },
      ],
    }),
    makeTemplate(pdf, { id: "tpl-second", name: "Second Fake Form", boxes: FIELDS.slice(0, 2) }),
  ];
}
const LEGACY = { [LEGACY_KEY]: JSON.stringify(COMPANY_DETAILS) };

// ------------------------------------------------------------ app driving

async function openApp(templates, extraStorage = {}) {
  const { context, outsideRequests } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, templates, extraStorage);
  await page.getByText("Your templates").waitFor();
  return { context, page, outsideRequests };
}

const dialog = (page, name) => page.getByRole("dialog", { name });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });

// Everything in the browser's storage, key by key, exactly as stored.
const everything = (page) =>
  page.evaluate(() =>
    Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
  );

async function backUp(page, scope = page, name = "Back up") {
  const started = page.waitForEvent("download");
  await button(scope, name).click();
  const file = await started;
  return { name: file.suggestedFilename(), bytes: fs.readFileSync(await file.path()) };
}

const chooseBackup = (page, file) =>
  page.locator(BACKUP_INPUT).setInputFiles({ name: file.name, mimeType: "application/json", buffer: file.bytes });

// A backup file of the two fake templates, and the storage it was made from.
async function makeBackup() {
  const { context, page } = await openApp(twoTemplates(), LEGACY);
  const file = await backUp(page);
  const stored = await everything(page);
  await context.close();
  return { file, stored };
}

// ================================================================== Back up

test("Back up downloads one file holding every template exactly as stored: PDF, fields, company details, typed values and people", TIMEOUT, async () => {
  const templates = twoTemplates();
  const { context, page, outsideRequests } = await openApp(templates, { ...LEGACY, [THEME_KEY]: "light" });
  const before = await everything(page);

  const file = await backUp(page);

  assert.match(file.name, /^pdf-form-filler-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = JSON.parse(file.bytes.toString("utf8"));
  assert.deepEqual({ app: backup._meta.app, version: backup._meta.version }, { app: "pdf-form-filler-backup", version: 1 });
  assert.ok(!Number.isNaN(Date.parse(backup._meta.exportedAt)));
  assert.deepEqual(Object.keys(backup.stored).sort(), [LEGACY_KEY, TEMPLATES_KEY]);
  assert.deepEqual(backup.stored[TEMPLATES_KEY], templates);
  // The PDF itself is in the file, byte for byte.
  assert.equal(backup.stored[TEMPLATES_KEY][0].pdfData, pdf.toString("base64"));
  assert.deepEqual(backup.stored[LEGACY_KEY], COMPANY_DETAILS);
  assert.deepEqual(backup.unreadable, {});
  // The light/dark choice is not data and is not in it.
  assert.ok(!file.bytes.toString("utf8").includes(THEME_KEY));
  // Saving a backup changes nothing in the browser and sends nothing anywhere.
  assert.deepEqual(await everything(page), before);
  assert.deepEqual(outsideRequests, []);
  await context.close();
});

test("with no templates there is nothing to back up, and Restore is still offered", TIMEOUT, async () => {
  const { context, page } = await openApp([]);
  await page.getByText("No templates yet").waitFor();
  assert.equal(await button(page, "Back up").count(), 0);
  assert.equal(await button(page, "Restore").count(), 1);
  await context.close();
});

// ================================================================== Restore

test("Restore into another, empty browser: the same data is stored, the templates are listed and the form still opens", TIMEOUT, async () => {
  const { file, stored } = await makeBackup();
  const { context, page } = await openApp([], { [THEME_KEY]: "light" });

  await chooseBackup(page, file);

  // Nothing is replaced until the user has seen what is in the file and said so.
  const preview = dialog(page, "Restore this backup?");
  await preview.waitFor();
  const text = (await preview.innerText()).replace(/\s+/g, " ");
  assert.ok(text.includes(file.name), text);
  assert.ok(text.includes(`Fake Form ${FIELDS.length} fields, 2 people`), text);
  assert.ok(text.includes("Second Fake Form 2 fields, 0 people"), text);
  assert.ok(text.includes("Company details saved by an earlier version of this tool"), text);
  assert.ok(text.includes("In this browser now No templates."), text);
  // An empty browser has nothing to lose: no warning, no "Back up what is here".
  assert.equal(await preview.getByRole("alert").count(), 0);
  assert.deepEqual(await everything(page), { [TEMPLATES_KEY]: "[]", [THEME_KEY]: "light" });

  await button(preview, "Replace with this backup").click();
  const done = dialog(page, "Backup restored");
  await done.waitFor();
  await button(done, "OK").click();
  await done.waitFor({ state: "hidden" });

  // The storage is the same, key for key and character for character; the theme was left alone.
  assert.deepEqual(await everything(page), { ...stored, [THEME_KEY]: "light" });
  // The list shows it without a reload.
  await page.getByRole("button", { name: /^Second Fake Form Last updated/ }).waitFor();

  // It is all still there after a reload.
  await page.reload();
  await page.getByRole("button", { name: /^Fake Form Last updated/ }).waitFor();
  assert.deepEqual(await everything(page), { ...stored, [THEME_KEY]: "light" });

  // And the restored PDF still draws, with its two people.
  await openFillScreen(page, "Fake Form");
  assert.equal(await page.getByRole("button", { name: /^Person \d+$/ }).count(), 2);
  await context.close();
});

test("Restore replaces what is in the browser only after \"Replace with this backup\"; Cancel changes nothing", TIMEOUT, async () => {
  const { file, stored } = await makeBackup();
  const other = makeTemplate(pdf, { id: "tpl-other", name: "Other Fake Form", boxes: FIELDS.slice(0, 1) });
  const { context, page } = await openApp([other]);
  const before = await everything(page);

  await chooseBackup(page, file);
  const preview = dialog(page, "Restore this backup?");
  await preview.waitFor();
  assert.ok((await preview.innerText()).replace(/\s+/g, " ").includes("In this browser now Other Fake Form 1 field, 0 people"));
  assert.ok((await preview.getByRole("alert").innerText()).includes("The templates in this browser now will be removed. To keep them, back them up first."));

  // "Back up what is here" saves the browser's own templates, not the file's.
  const mine = await backUp(page, preview, "Back up what is here");
  assert.deepEqual(JSON.parse(mine.bytes.toString("utf8")).stored[TEMPLATES_KEY].map((t) => t.name), ["Other Fake Form"]);

  await button(preview, "Cancel").click();
  await preview.waitFor({ state: "hidden" });
  assert.deepEqual(await everything(page), before);

  await chooseBackup(page, file);
  await button(preview, "Replace with this backup").click();
  await button(dialog(page, "Backup restored"), "OK").click();

  assert.deepEqual(await everything(page), stored);
  await page.getByRole("button", { name: /^Fake Form Last updated/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Other Fake Form Last updated/ }).count(), 0);
  await context.close();
});

test("Restore refuses a file that is not a usable backup, in plain words, and changes nothing", TIMEOUT, async () => {
  const { file } = await makeBackup();
  const good = JSON.parse(file.bytes.toString("utf8"));
  const changed = (change) => {
    const copy = structuredClone(good);
    change(copy);
    return JSON.stringify(copy);
  };
  const NOT_A_BACKUP = 'This file is not a backup of this tool. Choose a file saved with "Back up".';
  const cases = [
    ["a text file", "just some notes", NOT_A_BACKUP],
    ["a payroll export", JSON.stringify([{ ID: "F001", Surname: "Fakename" }]), NOT_A_BACKUP],
    ["a Payroll backup", JSON.stringify({ _meta: { app: "payroll-sys-backup", version: 1 }, state: null, periods: {} }), NOT_A_BACKUP],
    ["another version", changed((b) => (b._meta.version = 2)), "This backup was made by a different version of this tool and cannot be restored here. Nothing was changed."],
    ["a template with no PDF", changed((b) => delete b.stored[TEMPLATES_KEY][1].pdfData), 'This backup cannot be restored: the template "Second Fake Form" has no PDF. Nothing was changed.'],
    ["a template with no fields list", changed((b) => (b.stored[TEMPLATES_KEY][0].boxes = "none")), 'This backup cannot be restored: the template "Fake Form" has no list of fields. Nothing was changed.'],
    ["templates that are not a list", changed((b) => (b.stored[TEMPLATES_KEY] = {})), "This backup cannot be restored: its templates are not a list. Nothing was changed."],
    ["something this tool does not keep", changed((b) => (b.stored["payroll_app_state_v1"] = {})), "This backup cannot be restored: it holds something this tool does not keep. Nothing was changed."],
    ["an empty backup", changed((b) => ((b.stored = {}), (b.unreadable = {}))), "This backup is empty: it holds no templates. Nothing was changed."],
  ];

  const { context, page } = await openApp([makeTemplate(pdf)], { payroll_app_state_v1: '{"companies":[]}' });
  const before = await everything(page);
  for (const [what, content, message] of cases) {
    await page.locator(BACKUP_INPUT).setInputFiles({ name: "chosen.json", mimeType: "application/json", buffer: Buffer.from(content) });
    const refused = dialog(page, "This file cannot be restored");
    await refused.waitFor();
    assert.ok((await refused.innerText()).includes(message), `${what}: ${await refused.innerText()}`);
    await button(refused, "OK").click();
    await refused.waitFor({ state: "hidden" });
    assert.equal(await dialog(page, "Restore this backup?").count(), 0, what);
    assert.deepEqual(await everything(page), before, what);
  }
  await context.close();
});

test("when the browser's storage is full the backup is NOT restored, and what was there stays", TIMEOUT, async () => {
  const { file } = await makeBackup();
  const small = makeTemplate(pdf, { id: "tpl-small", name: "Small Fake Form", boxes: [] , pdfData: pdf.toString("base64").slice(0, 400) });
  const { context, page } = await openApp([small]);
  // The rest of this site's storage is taken, to the last character.
  await fillStorage(page);
  const before = await everything(page);

  await chooseBackup(page, file);
  await button(dialog(page, "Restore this backup?"), "Replace with this backup").click();

  const failed = dialog(page, "The backup was NOT restored");
  await failed.waitFor();
  assert.ok((await failed.innerText()).includes("Nothing was changed: this browser holds what it held before."));
  await button(failed, "OK").click();
  assert.deepEqual(await everything(page), before);
  await page.getByRole("button", { name: /^Small Fake Form Last updated/ }).waitFor();
  await context.close();
});

test("saved data that cannot be read is carried through a backup and a restore as it is", TIMEOUT, async () => {
  const damaged = '[{"id":"tpl-fake-form","name":"Fake For';
  const { context, page } = await openApp([makeTemplate(pdf)], LEGACY);
  // Not written the way the tool writes it, and not JSON at all.
  await page.evaluate(([legacyKey, text]) => {
    localStorage.setItem(legacyKey, '[ {"id":"companyName","label":"Company Name","value":"ABC Co Ltd"} ]');
    localStorage.setItem("pdf-editor:employer-profile", text);
  }, [LEGACY_KEY, damaged]);
  const before = await everything(page);

  const file = await backUp(page);
  const backup = JSON.parse(file.bytes.toString("utf8"));
  assert.deepEqual(Object.keys(backup.unreadable).sort(), [LEGACY_KEY, "pdf-editor:employer-profile"]);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText("No templates yet").waitFor();
  await chooseBackup(page, file);
  const preview = dialog(page, "Restore this backup?");
  assert.ok((await preview.innerText()).includes("2 items that could not be read, kept as it is"));
  await button(preview, "Replace with this backup").click();
  await button(dialog(page, "Backup restored"), "OK").click();

  assert.deepEqual(await everything(page), before);
  await context.close();
});

// ====================================================== the store interface

const sourceFiles = (dir = SRC) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
const filesMatching = (pattern) =>
  sourceFiles()
    .filter((file) => pattern.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).replaceAll("\\", "/"))
    .sort();

test("store interface: only the browser store itself touches the browser's storage, and no screen reaches past the interface", () => {
  // theme.ts keeps the light/dark choice, which is a preference and not data.
  assert.deepEqual(filesMatching(/\b(localStorage|sessionStorage|indexedDB)\s*[.[]/), [
    "lib/browserData.ts",
    // The last copy loaded from the dashboard, for when it cannot be reached.
    "lib/dashboardCache.ts",
    // Inside the dashboard, the values last typed and the People list, and the
    // note of what was imported, stay in this browser.
    "lib/dashboardImport.ts",
    "lib/dashboardStore.ts",
    "lib/employerProfile.ts",
    "lib/template.ts",
    "lib/theme.ts",
  ]);
  // backup.ts and browserData.ts are the browser's own copy by definition, and
  // the import reads this browser's templates to copy them to the dashboard.
  assert.deepEqual(filesMatching(/from\s+"@\/lib\/template"/), [
    "lib/backup.ts",
    "lib/browserData.ts",
    "lib/dashboardImport.ts",
    "lib/templateStore.ts",
  ]);
  assert.deepEqual(filesMatching(/\bgetLegacyEmployerFields\b/), [
    "components/CompanyDetailsPanel.tsx",
    "lib/dashboardStore.ts",
    "lib/employerProfile.ts",
    "lib/templateStore.ts",
  ]);
  // The one screen that uses it takes it from the interface, not from the browser store.
  const panel = fs.readFileSync(path.join(SRC, "components/CompanyDetailsPanel.tsx"), "utf8");
  assert.ok(panel.includes("const { getLegacyEmployerFields, saveTemplateEmployerFields } = templateStore;"));
  assert.ok(panel.includes('import { DEFAULT_FIELDS } from "@/lib/employerProfile";'));
});

test("store interface: with another store in its place the whole app reads and saves there, and the browser's storage is left alone", TIMEOUT, async () => {
  const { context, page } = await openApp([makeTemplate(pdf, { name: "Browser Fake Form" })]);
  const before = await everything(page);

  // A store that keeps everything in memory and writes down what it was asked.
  const inMemory = makeTemplate(pdf, { id: "tpl-memory", name: "Memory Fake Form", boxes: FIELDS.slice(0, 2) });
  await page.evaluate(
    async ([url, template]) => {
      const { setTemplateStore, STORE_OPERATIONS } = await import(/* @vite-ignore */ url);
      const calls = [];
      let templates = [template];
      const store = {
        listTemplates: () => templates,
        getTemplate: (id) => templates.find((t) => t.id === id),
        createTemplate: () => {
          throw new Error("not used in this test");
        },
        renameTemplate: (id, name) => {
          templates = templates.map((t) => (t.id === id ? { ...t, name } : t));
          return true;
        },
        deleteTemplate: (id) => {
          templates = templates.filter((t) => t.id !== id);
          return true;
        },
        saveTemplateBoxes: () => true,
        saveTemplateValues: () => true,
        saveTemplateEntries: () => true,
        saveTemplateEmployerFields: (id, employerFields) => {
          templates = templates.map((t) => (t.id === id ? { ...t, employerFields } : t));
          return true;
        },
        getLegacyEmployerFields: () => [],
      };
      for (const name of STORE_OPERATIONS) {
        const real = store[name];
        store[name] = (...args) => {
          calls.push(name);
          return real(...args);
        };
      }
      window.__memoryStore = { calls, templates: () => templates };
      setTemplateStore(store);
    },
    [`${app.appUrl}src/lib/templateStore.ts`, inMemory],
  );

  // Going to another screen and back makes the list read again: now from the other store.
  await button(page, "New Template").click();
  await button(page, "Back to templates").click();
  await page.getByRole("button", { name: /^Memory Fake Form Last updated/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /^Browser Fake Form Last updated/ }).count(), 0);

  // A change is saved to that store.
  await button(page, "Rename").click();
  const rename = dialog(page, "Rename template");
  await rename.getByLabel("Rename template").fill("Renamed In Memory");
  await button(rename, "Save").click();
  await page.getByRole("button", { name: /^Renamed In Memory Last updated/ }).waitFor();

  // Its fill-in screen opens from that store too.
  await openFillScreen(page, "Renamed In Memory");

  const memory = await page.evaluate(() => ({ calls: window.__memoryStore.calls, names: window.__memoryStore.templates().map((t) => t.name) }));
  assert.deepEqual(memory.names, ["Renamed In Memory"]);
  for (const used of ["listTemplates", "getTemplate", "renameTemplate"]) assert.ok(memory.calls.includes(used), used);
  // Nothing of it went to the browser's storage.
  assert.deepEqual(await everything(page), before);
  await context.close();
});

test("store interface: a store that lacks an operation is refused at once, and the browser store stays in use", TIMEOUT, async () => {
  const { context, page } = await openApp([makeTemplate(pdf)]);
  const error = await page.evaluate(async (url) => {
    const { setTemplateStore, templateStore } = await import(/* @vite-ignore */ url);
    const { saveTemplateEntries: _left, ...incomplete } = templateStore;
    try {
      setTemplateStore(incomplete);
      return null;
    } catch (thrown) {
      return String(thrown.message);
    }
  }, `${app.appUrl}src/lib/templateStore.ts`);
  assert.equal(error, "This store cannot be used: it has no saveTemplateEntries.");

  await button(page, "Rename").click();
  const rename = dialog(page, "Rename template");
  await rename.getByLabel("Rename template").fill("Still In The Browser");
  await button(rename, "Save").click();
  await page.getByRole("button", { name: /^Still In The Browser Last updated/ }).waitFor();
  assert.equal(JSON.parse((await everything(page))[TEMPLATES_KEY])[0].name, "Still In The Browser");
  await context.close();
});

// ================================================== the bridge: "activity"

test("inside the dashboard, working in the tool is reported to it: one \"activity\" message, with nothing in it, however much is typed", TIMEOUT, async () => {
  const { context, outsideRequests } = await app.newContext();
  const page = await context.newPage();
  await page.goto(STANDIN_URL);
  const frame = await (await page.locator("#app").elementHandle()).contentFrame();
  await frame.getByText("Your templates").waitFor();
  await seedTemplates(frame, [makeTemplate(pdf)]);
  await frame.getByText("Fake Form").waitFor();
  const activity = () => page.evaluate(() => window.hub.received.filter((m) => m.message.type === "activity"));

  // Loading the tool is not work: nothing is reported yet.
  await page.waitForFunction(() => window.hub.received.some((m) => m.message.type === "ready"));
  assert.deepEqual(await activity(), []);

  // A person renames the template: a click, then twenty keys.
  await button(frame, "Rename").click();
  const field = frame.getByRole("dialog", { name: "Rename template" }).getByLabel("Rename template");
  await field.pressSequentially(" renamed by a tester", { delay: 20 });
  await page.waitForFunction(() => window.hub.received.some((m) => m.message.type === "activity"));
  await page.waitForTimeout(500);

  const reported = await activity();
  assert.equal(reported.length, 1, "one message for all of it, not one per key");
  const { message } = reported[0];
  assert.deepEqual({ type: message.type, from: message.from, to: message.to, version: message.version, payload: message.payload }, { type: "activity", from: "pdf-editor", to: "dashboard", version: 1, payload: {} });
  // Not a word of what was typed is in it.
  assert.ok(!JSON.stringify(message).includes("tester"));
  // It reached the stand-in dashboard, which sits at the only address the bridge will post to.
  assert.ok(STANDIN_URL.startsWith(HUB_ORIGIN));
  assert.deepEqual(outsideRequests, []);
  await context.close();
});

test("opened on its own, the tool reports nothing to anyone while it is used", TIMEOUT, async () => {
  const { context, page, outsideRequests } = await openApp([makeTemplate(pdf)]);
  await page.evaluate(() => {
    window.__posted = [];
    const real = window.postMessage.bind(window);
    window.postMessage = (message, ...rest) => {
      window.__posted.push(message);
      return real(message, ...rest);
    };
  });

  await button(page, "Rename").click();
  await page.getByRole("dialog", { name: "Rename template" }).getByLabel("Rename template").pressSequentially(" typed alone", { delay: 20 });
  await page.waitForTimeout(500);

  assert.equal(await page.evaluate(() => window.PayrollHubBridge.isEmbedded()), false);
  assert.deepEqual(await page.evaluate(() => window.__posted.filter((m) => m && m.type === "activity")), []);
  assert.deepEqual(outsideRequests, []);
  await context.close();
});

test("the bridge file in this tool is the dashboard's docs/bridge.js, unchanged", (t) => {
  const hubCopy = path.resolve(here, "../../payroll_hub/docs/bridge.js");
  // Only where the dashboard's folder sits next to this one (as on the development machine).
  if (!fs.existsSync(hubCopy)) return t.skip("the payroll_hub folder is not next to this one");
  const normalise = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  assert.equal(normalise(path.join(SRC, "payrollHubBridge.js")), normalise(hubCopy));
});
