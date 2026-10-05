// Accessibility checks, as numbers rather than screenshots:
//   - contrast of every piece of text against what is actually behind it,
//     in both themes (WCAG AA: 4.5 to 1, or 3 to 1 for large text),
//   - a 2px accent focus ring on everything the Tab key reaches,
//   - every control has a name a screen reader can say,
//   - dialogs: focus moves in, Tab stays inside, Escape closes, focus
//     returns to the button that opened it,
//   - "reduce motion" switches every animation and transition off.
//
//   npm run check:a11y
//
// Covers the screens restyled so far (listed in SCREENS at the bottom).
import {
  STANDIN_URL,
  openFillScreen,
  seedTemplates,
  startApp,
  waitForPdfPreview,
} from "./helpers/app.mjs";
import {
  COMPANY_DETAILS,
  OTHER_PAYROLL_ROWS,
  PAYROLL_ROWS,
  buildSamplePdf,
  makeTemplate,
} from "./helpers/fake-data.mjs";
import { walkThrough } from "./helpers/walkthrough.mjs";

// ---------------------------------------------------------------- in-page

function measureContrast() {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  function rgba(color) {
    if (cache.has(color)) return cache.get(color);
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    const value = { r, g, b, a: a / 255 };
    cache.set(color, value);
    return value;
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // What is really behind an element: every ancestor's background colour,
  // from the page outwards in, each laid over the one before.
  //
  // On screens with the aurora background, a soft colour wash can drift
  // behind any card. `washes` is one of the cases to assume: none of them,
  // one at full strength, or any two overlapping at full strength. (The
  // three sit in different corners and never all overlap.)
  const aurora = Array.from(document.querySelectorAll(".app-backdrop > span")).map((wash) => {
    const style = getComputedStyle(wash);
    const colour = rgba(style.backgroundColor);
    return { ...colour, a: colour.a * Number(style.opacity) };
  });
  const washCases = [[]];
  aurora.forEach((first, i) => {
    washCases.push([first]);
    aurora.slice(i + 1).forEach((second) => washCases.push([first, second]));
  });

  function backdrop(element, washes) {
    const chain = [];
    for (let e = element; e; e = e.parentElement) chain.unshift(e);
    let colour = { r: 255, g: 255, b: 255, a: 1 };
    for (const e of chain) {
      const bg = rgba(getComputedStyle(e).backgroundColor);
      if (bg.a > 0) colour = over(bg, colour);
      // The washes sit directly on the page background, under everything else.
      if (e.querySelector(":scope > .app-backdrop")) {
        for (const wash of washes) colour = over(wash, colour);
      }
    }
    return colour;
  }
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let element = walker.nextNode(); element; element = walker.nextNode()) {
    if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
    if (element.closest("[disabled], [aria-disabled='true'], [aria-hidden='true']")) continue;
    const style = getComputedStyle(element);

    const samples = [];
    const text = Array.from(element.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.nodeValue.trim())
      .join(" ")
      .trim();
    if (text) samples.push({ what: text, colour: style.color });
    if (element.matches("input, textarea")) {
      if (element.value) samples.push({ what: `typed "${element.value}"`, colour: style.color });
      else if (element.placeholder) {
        samples.push({
          what: `placeholder "${element.placeholder}"`,
          colour: getComputedStyle(element, "::placeholder").color,
        });
      }
    }
    if (samples.length === 0) continue;

    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    for (const sample of samples) {
      // Keep the worst of the background cases.
      let worst = null;
      for (const washes of washCases) {
        const behind = backdrop(element, washes);
        const front = over(rgba(sample.colour), behind);
        const value = ratio(front, behind);
        if (!worst || value < worst.value) worst = { value, front, behind };
      }
      results.push({
        text: sample.what.slice(0, 60),
        ratio: Math.round(worst.value * 100) / 100,
        needs: large ? 3 : 4.5,
        colours: `${hex(worst.front)} on ${hex(worst.behind)}`,
      });
    }
  }
  return results;
}

function controlsWithoutAName() {
  const nameOf = (el) => {
    const byId = (ids) =>
      (ids ?? "").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    return (
      el.getAttribute("aria-label") ||
      byId(el.getAttribute("aria-labelledby")) ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
      el.closest("label")?.textContent ||
      (el.matches("input, select, textarea") ? "" : el.textContent) ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      ""
    ).trim();
  };
  const controls = Array.from(
    document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex='-1'])"),
  )
    .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }))
    // Invisible markers a dialog uses to keep Tab inside it; never announced.
    .filter((el) => el.getAttribute("aria-hidden") !== "true");
  return {
    total: controls.length,
    unnamed: controls.filter((el) => !nameOf(el)).map((el) => el.outerHTML.slice(0, 120)),
  };
}

// `pass` marks the elements one Tab-through has already been to, so each
// control is counted once and the walk stops when it comes back round.
function focusRingOfActiveElement(pass) {
  const el = document.activeElement;
  if (!el || el === document.body || el.getAttribute("aria-hidden") === "true") return null;
  if (el.dataset.a11yTabPass === pass) return { alreadyVisited: true };
  el.dataset.a11yTabPass = pass;
  const style = getComputedStyle(el);
  const probe = document.createElement("canvas").getContext("2d");
  const same = (a, b) => {
    probe.fillStyle = a;
    const first = probe.fillStyle;
    probe.fillStyle = b;
    return first === probe.fillStyle;
  };
  return {
    element: (el.getAttribute("aria-label") || el.textContent || el.id || el.tagName).trim().slice(0, 40),
    ok:
      style.outlineStyle === "solid" &&
      style.outlineWidth === "2px" &&
      same(style.outlineColor, style.getPropertyValue("--accent")),
    found: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
  };
}

function movingThings() {
  const moving = [];
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = getComputedStyle(el, pseudo);
      const durations = `${style.transitionDuration},${style.animationDuration}`.split(",");
      if (durations.some((d) => parseFloat(d) > 0)) {
        moving.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}${pseudo ?? ""}`);
      }
    }
  }
  return moving;
}

// ------------------------------------------------------------- reporting

const report = { contrast: { dark: [], light: [] }, names: { total: 0, unnamed: [] }, problems: [] };
let tabPasses = 0;
const dialogsSeen = [];

async function inspect(target, state) {
  for (const theme of ["dark", "light"]) {
    // Colours fade from one theme to the other. Measure where they end up,
    // not a moment in between: fades are switched off while measuring.
    await target.evaluate((t) => {
      const still = document.createElement("style");
      still.id = "a11y-check-no-fades";
      still.textContent = "*, *::before, *::after { transition: none !important; }";
      document.head.append(still);
      document.documentElement.dataset.theme = t;
    }, theme);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const results = await target.evaluate(measureContrast);
    for (const result of results) report.contrast[theme].push({ ...result, state });
    await target.evaluate(() => document.getElementById("a11y-check-no-fades")?.remove());
  }
  await target.evaluate(() => delete document.documentElement.dataset.theme);
  const names = await target.evaluate(controlsWithoutAName);
  report.names.total += names.total;
  for (const html of names.unnamed) report.names.unnamed.push(`[${state}] ${html}`);
}

// Inside a dialog, start from wherever the dialog put the focus.
// `target` is where the app is: the page itself, or its frame when the app
// is inside the stand-in dashboard.
async function tabThroughEverything(page, state, { fromTheTop = true, target = page } = {}) {
  if (fromTheTop) await target.evaluate(() => document.activeElement?.blur());
  const pass = `pass-${++tabPasses}`;
  let checked = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const ring = await target.evaluate(focusRingOfActiveElement, pass);
    if (!ring) continue;
    if (ring.alreadyVisited) break;
    checked++;
    if (!ring.ok) report.problems.push(`focus ring [${state}] ${ring.element}: ${ring.found}`);
  }
  return checked;
}

// Every dialog must be the shared one, dim the screen behind it by 60%,
// and blur it only when no PDF preview is showing.
async function overlayRule(target, state) {
  const found = await target.evaluate(() => {
    const overlays = document.querySelectorAll('[data-slot="dialog-overlay"]');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const style = overlays.length ? getComputedStyle(overlays[overlays.length - 1]) : null;
    return {
      shared: dialogs.length > 0 && Array.from(dialogs).every((d) => d.dataset.slot === "dialog-content"),
      dim: style?.backgroundColor ?? "none",
      blur: style?.backdropFilter ?? "none",
      previewBehind: !!document.querySelector("canvas"),
    };
  });
  dialogsSeen.push({ state, ...found });
  if (!found.shared) report.problems.push(`dialog [${state}] is not the shared dialog`);
  if (!/0\.6\)$/.test(found.dim)) report.problems.push(`dialog [${state}] overlay is not a 60% dim (${found.dim})`);
  if (found.previewBehind && found.blur !== "none") report.problems.push(`dialog [${state}] blurs a PDF preview`);
  if (!found.previewBehind && !found.blur.startsWith("blur(")) report.problems.push(`dialog [${state}] does not blur a screen without a preview`);
}

// For dialogs that are not opened by a button (clicking a field, choosing
// a file): focus is inside, Tab stays inside, Escape closes it.
async function dialogWithoutOpener(page, state) {
  await page.getByRole("dialog").last().waitFor();
  await page.waitForTimeout(250);
  await overlayRule(page, state);
  const inside = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  const checks = { focusMovedIn: await inside(), tabStaysInside: true };
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    for (let waited = 0; !(await inside()) && waited < 600; waited += 100) {
      await page.waitForTimeout(100);
    }
    if (!(await inside())) checks.tabStaysInside = false;
  }
  // Counted in the page itself: a dialog underneath another one is hidden
  // from role lookups while the top one is open.
  const open = () => page.locator('[role="dialog"]').count();
  const before = await open();
  await page.keyboard.press("Escape");
  // The dialog takes a moment to fade out before it is removed.
  for (let waited = 0; (await open()) >= before && waited < 1500; waited += 100) {
    await page.waitForTimeout(100);
  }
  checks.escapeCloses = (await open()) === before - 1;
  for (const [check, ok] of Object.entries(checks)) {
    if (!ok) report.problems.push(`dialog [${state}] ${check} failed`);
  }
  return checks;
}

// Opens a dialog from the keyboard and checks the whole round trip.
async function dialogRoundTrip(page, openerName, state) {
  const opener = page.getByRole("button", { name: openerName, exact: true }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor();
  await page.waitForTimeout(250); // focus moves in once the dialog has opened
  const inside = () =>
    page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'));

  await overlayRule(page, state);
  const checks = { focusMovedIn: await inside(), tabStaysInside: true };
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    // A guard at each end of the dialog passes focus back in; give it a
    // moment before deciding focus has escaped.
    for (let waited = 0; !(await inside()) && waited < 600; waited += 100) {
      await page.waitForTimeout(100);
    }
    if (!(await inside())) {
      checks.tabStaysInside = false;
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        return `${el?.tagName} "${(el?.getAttribute("aria-label") || el?.textContent || "").trim().slice(0, 30)}"`;
      });
      report.problems.push(`dialog [${state}] after ${i + 1} Tab presses focus was on ${where}`);
    }
  }
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  checks.escapeCloses = (await page.getByRole("dialog").count()) === 0;
  checks.focusReturns = await opener.evaluate((el) => el === document.activeElement);

  for (const [check, ok] of Object.entries(checks)) {
    if (!ok) report.problems.push(`dialog [${state}] ${check} failed`);
  }
  return checks;
}

// --------------------------------------------------------------- screens

async function fillInScreen(app) {
  const pdf = await buildSamplePdf();
  const summary = {};

  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, [
    makeTemplate(pdf, { employerFields: COMPANY_DETAILS }),
    makeTemplate(pdf, { id: "tpl-blank", name: "Blank Form", boxes: [] }),
  ]);

  await page.getByRole("button", { name: /^Blank Form Last updated/ }).click();
  await page.getByText("This template doesn't have any fields yet.").waitFor();
  await inspect(page, "fill-in: template without fields");
  await page.getByRole("button", { name: "Back to templates" }).click();

  await openFillScreen(page, "Fake Form");
  await inspect(page, "fill-in: nothing typed yet");
  await page.getByLabel("Surname", { exact: true }).fill("Testperson");
  await page.getByLabel("Basic Salary", { exact: true }).fill("fifty thousand");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await page.getByLabel("Surname", { exact: true }).fill("Sampleton");
  await page.getByLabel("Net Pay", { exact: true }).fill("not a number");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  await page.getByRole("button", { name: "Person 2", exact: true }).click();
  await inspect(page, "fill-in: two people, a warning");

  await page.getByRole("button", { name: "Positions locked" }).click();
  await inspect(page, "fill-in: positions unlocked");
  await page.getByRole("button", { name: "Positions unlocked" }).click();

  summary.focusStops = await tabThroughEverything(page, "fill-in");

  summary.dialogs = {};
  for (const opener of ["Clear values", "Delete Person 1", "Clear all"]) {
    const button = page.getByRole("button", { name: opener, exact: true }).first();
    await button.click();
    await page.getByRole("dialog").waitFor();
    await inspect(page, `dialog opened by "${opener}"`);
    await page.waitForTimeout(250);
    summary.focusStops += await tabThroughEverything(page, `dialog "${opener}"`, { fromTheTop: false });
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").first().waitFor({ state: "hidden" });
    summary.dialogs[opener] = await dialogRoundTrip(page, opener, opener);
  }

  // Field settings (opened by clicking a field on the page) and the import
  // preview (opened by choosing a file) have no button to return focus to,
  // so only what happens inside them is checked.
  const canvasBox = await page.locator("canvas").first().boundingBox();
  await page.mouse.click(canvasBox.x + 300, canvasBox.y + 215);
  await page.getByRole("dialog").waitFor();
  await inspect(page, "dialog: field settings");
  await page.waitForTimeout(250);
  summary.focusStops += await tabThroughEverything(page, "dialog: field settings", { fromTheTop: false });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });

  const choose = async (name, content) => {
    await page.locator('input[type="file"]').setInputFiles(app.writeTempFile(name, content));
    await page.getByRole("dialog").waitFor();
  };
  await choose("payroll-fake.json", JSON.stringify(PAYROLL_ROWS));
  await inspect(page, "dialog: import preview");
  await page.getByRole("dialog").getByRole("button", { name: "Add to", exact: true }).click();
  await inspect(page, "dialog: import preview, Replace chosen");
  await page.getByRole("dialog").getByRole("button", { name: "Import 3 people" }).click();
  await inspect(page, "dialog: replace confirmation");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  await choose("broken.json", "{ not json");
  await inspect(page, "dialog: import preview, unusable file");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
  await choose("no-match.csv", "Department,Email\nTesting,nobody@example.test\n");
  await inspect(page, "dialog: import preview, no matching columns");
  await page.keyboard.press("Escape");
  await context.close();

  // Inside the stand-in dashboard: the notice, the header button, and the
  // preview with its company warning.
  const embedded = await app.newContext();
  const outer = await embedded.context.newPage();
  await outer.goto(STANDIN_URL);
  const frame = await (await outer.locator("#app").elementHandle()).contentFrame();
  await frame.getByText("Your templates").waitFor();
  await seedTemplates(frame, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
  await frame.getByText("Fake Form").waitFor();
  await outer.evaluate(
    (rows) =>
      window.hub.send(
        "send-data",
        { dataType: "payroll-result", rows, meta: { period: "2026-10" } },
        "a11y-check-delivery-1",
      ),
    OTHER_PAYROLL_ROWS,
  );
  await frame.locator('[role="status"]').waitFor();
  await openFillScreen(frame, "Fake Form");
  await frame.getByRole("dialog").waitFor();
  await inspect(frame, "in dashboard: import preview with company warning");
  await frame.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await frame.getByRole("dialog").first().waitFor({ state: "hidden" });
  await inspect(frame, "in dashboard: fill-in with data waiting");
  await embedded.context.close();

  // Reduce motion.
  const still = await app.newContext({ reducedMotion: "reduce" });
  const stillPage = await still.context.newPage();
  await stillPage.goto(app.appUrl);
  await stillPage.getByText("Your templates").waitFor();
  await seedTemplates(stillPage, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
  await openFillScreen(stillPage, "Fake Form");
  await stillPage.getByRole("button", { name: "Clear values" }).click();
  await stillPage.getByRole("dialog").waitFor();
  summary.stillMovingWithReduceMotion = await stillPage.evaluate(movingThings);
  await still.context.close();

  const moving = await app.newContext();
  const movingPage = await moving.context.newPage();
  await movingPage.goto(app.appUrl);
  await movingPage.getByText("Your templates").waitFor();
  await seedTemplates(movingPage, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
  await openFillScreen(movingPage, "Fake Form");
  summary.movingNormally = (await movingPage.evaluate(movingThings)).length;
  await moving.context.close();

  for (const thing of summary.stillMovingWithReduceMotion) {
    report.problems.push(`still moves with "reduce motion": ${thing}`);
  }
  return summary;
}

async function homeScreen(app) {
  const pdf = await buildSamplePdf();
  const summary = { dialogs: {} };
  const templates = [
    makeTemplate(pdf, { employerFields: COMPANY_DETAILS }),
    makeTemplate(pdf, { id: "tpl-blank", name: "Blank Form", boxes: [] }),
  ];

  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, []);
  await page.getByText("No templates yet").waitFor();
  summary.focusStops = await tabThroughEverything(page, "home: no templates");
  await seedTemplates(page, templates);
  await page.getByText("Blank Form").waitFor();
  summary.focusStops += await tabThroughEverything(page, "home");
  for (const opener of ["Rename", "Delete"]) {
    summary.dialogs[opener] = await dialogRoundTrip(page, opener, `home: ${opener}`);
  }
  await context.close();

  // Inside the stand-in dashboard: the header button and the waiting notice.
  const embedded = await app.newContext();
  const outer = await embedded.context.newPage();
  await outer.goto(STANDIN_URL);
  const frame = await (await outer.locator("#app").elementHandle()).contentFrame();
  await frame.getByText("Your templates").waitFor();
  await seedTemplates(frame, templates);
  await frame.getByText("Blank Form").waitFor();
  await outer.evaluate(
    (rows) =>
      window.hub.send(
        "send-data",
        { dataType: "payroll-result", rows, meta: { period: "2026-10" } },
        "a11y-check-delivery-2",
      ),
    OTHER_PAYROLL_ROWS,
  );
  await frame.locator('[role="status"]').waitFor();
  await frame.getByRole("heading", { name: "Your templates" }).click();
  summary.focusStops += await tabThroughEverything(outer, "home in dashboard, data waiting", {
    target: frame,
  });
  await embedded.context.close();

  // Reduce motion: the drifting background has to stop too.
  const still = await app.newContext({ reducedMotion: "reduce" });
  const stillPage = await still.context.newPage();
  await stillPage.goto(app.appUrl);
  await stillPage.getByText("Your templates").waitFor();
  await seedTemplates(stillPage, templates);
  await stillPage.getByText("Blank Form").waitFor();
  summary.stillMovingWithReduceMotion = await stillPage.evaluate(movingThings);
  await still.context.close();

  const moving = await app.newContext();
  const movingPage = await moving.context.newPage();
  await movingPage.goto(app.appUrl);
  await movingPage.getByText("Your templates").waitFor();
  await seedTemplates(movingPage, templates);
  await movingPage.getByText("Blank Form").waitFor();
  summary.movingNormally = (await movingPage.evaluate(movingThings)).length;
  await moving.context.close();

  for (const thing of summary.stillMovingWithReduceMotion) {
    report.problems.push(`home still moves with "reduce motion": ${thing}`);
  }
  return summary;
}

async function newTemplateScreen(app) {
  const pdf = await buildSamplePdf();
  const summary = { dialogs: {}, focusStops: 0 };

  async function open(options) {
    const { context } = await app.newContext(options);
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, []);
    await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
    await page.getByText("Upload a blank PDF").waitFor();
    return { context, page };
  }
  async function choosePdf(page) {
    await page.locator('input[type="file"]').setInputFiles(app.writeTempFile("fake-form.pdf", pdf));
    await page.getByLabel("Template name").waitFor();
    await waitForPdfPreview(page);
  }

  const { context, page } = await open();
  summary.focusStops += await tabThroughEverything(page, "new template: before choosing a file");
  await choosePdf(page);
  summary.focusStops += await tabThroughEverything(page, "new template: preview");
  summary.movingNormally = (await page.evaluate(movingThings)).length;
  await context.close();

  const still = await open({ reducedMotion: "reduce" });
  const before = await still.page.evaluate(movingThings);
  await choosePdf(still.page);
  summary.stillMovingWithReduceMotion = [...before, ...(await still.page.evaluate(movingThings))];
  await still.context.close();

  for (const thing of summary.stillMovingWithReduceMotion) {
    report.problems.push(`new template still moves with "reduce motion": ${thing}`);
  }
  return summary;
}

async function fieldEditorScreen(app) {
  const pdf = await buildSamplePdf();
  const summary = { dialogs: {}, focusStops: 0 };
  const templates = [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })];

  async function open(options) {
    const { context } = await app.newContext(options);
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, templates);
    await page.getByRole("button", { name: "Edit fields" }).click();
    await waitForPdfPreview(page);
    return { context, page };
  }

  const { context, page } = await open();
  summary.focusStops += await tabThroughEverything(page, "field editor");
  for (const opener of ['Rename field "Surname"', 'Delete field "Surname"']) {
    summary.dialogs[opener] = await dialogRoundTrip(page, opener, `field editor: ${opener}`);
  }

  // "Name this field" opens when a box has been drawn with the mouse, so
  // there is no button for focus to return to. Checked here: the cursor
  // starts in the name box, Tab stays inside, Escape closes it.
  const canvas = await page.locator("canvas").first().boundingBox();
  await page.mouse.move(canvas.x + 420, canvas.y + 420);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 520, canvas.y + 440, { steps: 6 });
  await page.mouse.up();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(250);
  await overlayRule(page, "field editor: Name this field");
  const naming = {
    cursorStartsInNameBox: await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") === "Name this field",
    ),
    tabStaysInside: true,
  };
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    if (!(await inside())) {
      await page.waitForTimeout(150);
      if (!(await inside())) naming.tabStaysInside = false;
    }
  }
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  naming.escapeCloses = (await page.getByRole("dialog").count()) === 0;
  summary.dialogs["Name this field (opened by drawing a box)"] = naming;
  for (const [check, ok] of Object.entries(naming)) {
    if (!ok) report.problems.push(`dialog [field editor: Name this field] ${check} failed`);
  }
  summary.movingNormally = (await page.evaluate(movingThings)).length;
  await context.close();

  const still = await open({ reducedMotion: "reduce" });
  summary.stillMovingWithReduceMotion = await still.page.evaluate(movingThings);
  await still.context.close();
  for (const thing of summary.stillMovingWithReduceMotion) {
    report.problems.push(`field editor still moves with "reduce motion": ${thing}`);
  }
  return summary;
}

async function companyDetailsScreen(app) {
  const pdf = await buildSamplePdf();
  const summary = { dialogs: {}, focusStops: 0 };
  const legacy = { "pdf-editor:employer-fields": JSON.stringify(COMPANY_DETAILS) };

  async function open(options) {
    const { context } = await app.newContext(options);
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, [makeTemplate(pdf)], legacy);
    await page.getByRole("button", { name: "Company details", exact: true }).click();
    await page.getByRole("button", { name: "Start blank" }).waitFor();
    return { context, page };
  }

  const { context, page } = await open();
  summary.focusStops += await tabThroughEverything(page, "company details: copy or start blank");
  await page.getByRole("button", { name: "Copy my existing company details" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  summary.focusStops += await tabThroughEverything(page, "company details: editor");
  const opener = 'Remove field "Company Name"';
  summary.dialogs[opener] = await dialogRoundTrip(page, opener, `company details: ${opener}`);
  summary.movingNormally = (await page.evaluate(movingThings)).length;
  await context.close();

  const still = await open({ reducedMotion: "reduce" });
  summary.stillMovingWithReduceMotion = await still.page.evaluate(movingThings);
  await still.context.close();
  for (const thing of summary.stillMovingWithReduceMotion) {
    report.problems.push(`company details still moves with "reduce motion": ${thing}`);
  }
  return summary;
}

// The dialogs not covered above: field settings (in the editor and on the
// fill-in screen), the import preview and its Replace confirmation.
async function remainingDialogs(app) {
  const pdf = await buildSamplePdf();
  const summary = { dialogs: {}, focusStops: 0, stillMovingWithReduceMotion: [], movingNormally: 0 };
  const { context } = await app.newContext();
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await page.getByText("Your templates").waitFor();
  await seedTemplates(page, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);

  await page.getByRole("button", { name: "Edit fields" }).click();
  await waitForPdfPreview(page);
  let canvas = await page.locator("canvas").first().boundingBox();
  await page.mouse.click(canvas.x + 300, canvas.y + 215);
  summary.dialogs["Field settings (field editor)"] = await dialogWithoutOpener(page, "field settings, field editor");
  await page.getByRole("button", { name: "Back to templates" }).click();

  await openFillScreen(page, "Fake Form");
  canvas = await page.locator("canvas").first().boundingBox();
  await page.mouse.click(canvas.x + 300, canvas.y + 215);
  summary.dialogs["Field settings (fill-in screen)"] = await dialogWithoutOpener(page, "field settings, fill-in screen");

  await page.getByLabel("Surname", { exact: true }).fill("Testperson");
  await page.getByRole("button", { name: "Add & fill next person" }).click();
  const choose = () =>
    page
      .locator('input[type="file"]')
      .setInputFiles(app.writeTempFile("payroll-fake.json", JSON.stringify(PAYROLL_ROWS)));
  await choose();
  summary.dialogs["Import preview"] = await dialogWithoutOpener(page, "import preview");

  // The Replace confirmation opens on top of the preview: Escape must close
  // only the confirmation and hand focus back to the Import button.
  await choose();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Add to", exact: true }).click();
  const importButton = page.getByRole("dialog").getByRole("button", { name: "Import 3 people" });
  await importButton.focus();
  await page.keyboard.press("Enter");
  await page.getByText("Replace existing people?").waitFor();
  const confirmation = await dialogWithoutOpener(page, "replace confirmation");
  confirmation.previewStaysOpen = (await page.locator('[role="dialog"]').count()) === 1;
  await page.waitForTimeout(200);
  confirmation.focusReturns = await importButton.evaluate((el) => el === document.activeElement);
  for (const check of ["previewStaysOpen", "focusReturns"]) {
    if (!confirmation[check]) report.problems.push(`dialog [replace confirmation] ${check} failed`);
  }
  summary.dialogs["Replace confirmation"] = confirmation;
  await context.close();
  return summary;
}

// Contrast and control names on every screen and dialog, including the
// ones not restyled yet: the colour tokens are shared, so a change to them
// reaches all of them.
async function everyScreen(app) {
  await walkThrough(app, inspect);
  return null;
}

const SCREENS = {
  "fill-in screen": fillInScreen,
  "home screen": homeScreen,
  "new-template screen": newTemplateScreen,
  "field editor": fieldEditorScreen,
  "company details": companyDetailsScreen,
  "remaining dialogs": remainingDialogs,
  "every screen (contrast and names)": everyScreen,
};

const app = await startApp();
const summaries = {};
try {
  for (const [name, run] of Object.entries(SCREENS)) summaries[name] = await run(app);
} finally {
  await app.close();
}

console.log(`Accessibility check: ${Object.keys(SCREENS).join(", ")}\n`);
for (const theme of ["dark", "light"]) {
  const all = report.contrast[theme];
  const failing = all.filter((r) => r.ratio < r.needs);
  const lowest = all.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  console.log(
    `Contrast, ${theme} theme: ${all.length} pieces of text checked, lowest ${lowest.ratio}:1 ` +
      `("${lowest.text}", ${lowest.colours}, in ${lowest.state}); ${failing.length} below AA.`,
  );
  const unique = new Map(failing.map((f) => [`${f.text}|${f.colours}`, f]));
  for (const f of unique.values()) {
    report.problems.push(`contrast ${theme}: ${f.ratio}:1 (needs ${f.needs}) "${f.text}" ${f.colours} [${f.state}]`);
  }
}
console.log(`Names: ${report.names.total} controls checked, ${report.names.unnamed.length} without a name.`);
for (const html of report.names.unnamed) report.problems.push(`no accessible name: ${html}`);
{
  const overPreview = dialogsSeen.filter((d) => d.previewBehind);
  const elsewhere = dialogsSeen.filter((d) => !d.previewBehind);
  console.log(
    `Dialog overlay: ${dialogsSeen.length} dialogs opened, all the shared dialog: ` +
      `${dialogsSeen.every((d) => d.shared) ? "yes" : "NO"}; ` +
      `${overPreview.length} over a PDF preview, blurred: ${overPreview.filter((d) => d.blur !== "none").length}; ` +
      `${elsewhere.length} on screens without one, blurred: ${elsewhere.filter((d) => d.blur !== "none").length}.`,
  );
}
for (const [name, summary] of Object.entries(summaries)) {
  if (!summary) continue;
  if (summary.focusStops > 0) {
    console.log(`Focus ring (${name}): ${summary.focusStops} Tab stops checked for a 2px solid accent outline.`);
  }
  for (const [opener, checks] of Object.entries(summary.dialogs)) {
    console.log(`Dialog "${opener}": ${Object.entries(checks).map(([k, v]) => `${k} ${v ? "yes" : "NO"}`).join(", ")}.`);
  }
  if (summary.movingNormally > 0) {
    console.log(
      `Reduce motion (${name}): ${summary.stillMovingWithReduceMotion.length} things still moving ` +
        `(${summary.movingNormally} have motion when it is not requested).`,
    );
  }
}

if (report.problems.length > 0) {
  console.log(`\nFAIL: ${report.problems.length} problem(s):`);
  for (const problem of report.problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS");
}
