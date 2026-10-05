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
  function backdrop(element) {
    const chain = [];
    for (let e = element; e; e = e.parentElement) chain.unshift(e);
    let colour = { r: 255, g: 255, b: 255, a: 1 };
    for (const e of chain) {
      const bg = rgba(getComputedStyle(e).backgroundColor);
      if (bg.a > 0) colour = over(bg, colour);
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

    const behind = backdrop(element);
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    for (const sample of samples) {
      const front = over(rgba(sample.colour), behind);
      results.push({
        text: sample.what.slice(0, 60),
        ratio: Math.round(ratio(front, behind) * 100) / 100,
        needs: large ? 3 : 4.5,
        colours: `${hex(front)} on ${hex(behind)}`,
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

function focusRingOfActiveElement() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
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
async function tabThroughEverything(page, state, { fromTheTop = true } = {}) {
  if (fromTheTop) await page.evaluate(() => document.activeElement?.blur());
  const seen = new Set();
  let checked = 0;
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const ring = await page.evaluate(focusRingOfActiveElement);
    if (!ring) continue;
    const key = `${ring.element}`;
    if (seen.has(key) && seen.size > 3) break;
    seen.add(key);
    checked++;
    if (!ring.ok) report.problems.push(`focus ring [${state}] ${ring.element}: ${ring.found}`);
  }
  return checked;
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

  const checks = { focusMovedIn: await inside(), tabStaysInside: true };
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    // A guard at each end of the dialog passes focus back in; give it a
    // moment before deciding focus has escaped.
    if (!(await inside())) {
      await page.waitForTimeout(150);
      if (!(await inside())) checks.tabStaysInside = false;
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

// Contrast and control names on every screen and dialog, including the
// ones not restyled yet: the colour tokens are shared, so a change to them
// reaches all of them.
async function everyScreen(app) {
  await walkThrough(app, inspect);
  return null;
}

const SCREENS = { "fill-in screen": fillInScreen, "every screen (contrast and names)": everyScreen };

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
for (const [name, summary] of Object.entries(summaries)) {
  if (!summary) continue;
  console.log(`Focus ring (${name}): ${summary.focusStops} Tab stops checked for a 2px solid accent outline.`);
  for (const [opener, checks] of Object.entries(summary.dialogs)) {
    console.log(`Dialog "${opener}": ${Object.entries(checks).map(([k, v]) => `${k} ${v ? "yes" : "NO"}`).join(", ")}.`);
  }
  console.log(
    `Reduce motion (${name}): ${summary.stillMovingWithReduceMotion.length} things still moving ` +
      `(${summary.movingNormally} have motion when it is not requested).`,
  );
}

if (report.problems.length > 0) {
  console.log(`\nFAIL: ${report.problems.length} problem(s):`);
  for (const problem of report.problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS");
}
