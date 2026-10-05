// Checks that the PDF preview is left alone and that the layout holds when
// the window is narrow:
//   - nothing blurs, tints, fades or filters the rendered page, in either
//     theme, and nothing with a fill sits on top of it,
//   - the page is always drawn at its fixed 800px, never scaled,
//   - at a narrow width the page itself never scrolls sideways (the preview
//     scrolls inside its own frame instead) and every control stays reachable.
//
//   npm run check:preview
import {
  openFillScreen,
  seedTemplates,
  startApp,
  waitForPdfPreview,
} from "./helpers/app.mjs";
import { COMPANY_DETAILS, buildSamplePdf, makeTemplate } from "./helpers/fake-data.mjs";

function inspectPreview() {
  const page = document.querySelector("canvas");
  const rect = page.getBoundingClientRect();
  const problems = [];

  // Effects on the page or anything it sits inside.
  for (let el = page; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
    if (style.filter !== "none") problems.push(`${label} has filter ${style.filter}`);
    if (style.backdropFilter !== "none") problems.push(`${label} has backdrop-filter ${style.backdropFilter}`);
    if (style.opacity !== "1") problems.push(`${label} has opacity ${style.opacity}`);
    if (style.mixBlendMode !== "normal") problems.push(`${label} has blend mode ${style.mixBlendMode}`);
    if (style.transform !== "none") problems.push(`${label} is transformed (${style.transform})`);
    if (el === page && style.boxShadow !== "none") problems.push(`page has a shadow or glow (${style.boxShadow})`);
    if (el !== page && style.backgroundImage !== "none") problems.push(`${label} has a background image or gradient`);
  }

  // Anything stacked on top of the page: a grid of sample points.
  const paint = document.createElement("canvas").getContext("2d");
  const alpha = (colour) => {
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = colour;
    paint.fillRect(0, 0, 1, 1);
    return paint.getImageData(0, 0, 1, 1).data[3];
  };
  const onTop = new Set();
  for (let fx = 0.05; fx < 1; fx += 0.1) {
    for (let fy = 0.05; fy < 1; fy += 0.1) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) continue;
      for (const el of document.elementsFromPoint(x, y)) {
        if (el === page) break;
        const style = getComputedStyle(el);
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")}`;
        onTop.add(label);
        if (el.tagName !== "CANVAS" && alpha(style.backgroundColor) > 0) {
          problems.push(`${label} covers the page with a fill (${style.backgroundColor})`);
        }
        if (style.backdropFilter !== "none" || style.filter !== "none") {
          problems.push(`${label} filters the page`);
        }
        if (style.boxShadow !== "none") problems.push(`${label} casts a shadow or glow on the page`);
      }
    }
  }

  return {
    problems: [...new Set(problems)],
    onTopOfPage: [...onTop],
    drawnAt: `${page.width}px`,
    shownAt: `${Math.round(rect.width - 2)}px`, // minus the 1px line each side
    pageBackgroundBehind: getComputedStyle(page.closest(".preview-frame") ?? page.parentElement).backgroundColor,
  };
}

function inspectLayout() {
  const frame = document.querySelector(".preview-frame");
  const offScreen = Array.from(document.querySelectorAll("button, input, a[href]"))
    .filter((el) => el.checkVisibility({ checkVisibilityCSS: true }) && !el.closest(".preview-frame"))
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left < -1 || r.right > innerWidth + 1;
    })
    .map((el) => (el.getAttribute("aria-label") || el.textContent || el.id).trim().slice(0, 30));
  return {
    windowWidth: innerWidth,
    pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1,
    previewScrollsInsideItsFrame: frame.scrollWidth > frame.clientWidth + 1,
    controlsCutOff: offScreen,
  };
}

const app = await startApp();
const problems = [];
try {
  const pdf = await buildSamplePdf();
  for (const width of [1440, 1100, 720, 420]) {
    const { context } = await app.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
    await openFillScreen(page, "Fake Form");
    await page.getByLabel("Surname", { exact: true }).fill("Testperson");

    const layout = await page.evaluate(inspectLayout);
    console.log(
      `Width ${String(width).padStart(4)}px: page scrolls sideways ${layout.pageScrollsSideways ? "YES" : "no"}, ` +
        `preview scrolls inside its frame ${layout.previewScrollsInsideItsFrame ? "yes" : "no (it fits)"}, ` +
        `controls cut off: ${layout.controlsCutOff.length}`,
    );
    if (layout.pageScrollsSideways) problems.push(`at ${width}px the whole page scrolls sideways`);
    for (const control of layout.controlsCutOff) problems.push(`at ${width}px "${control}" is cut off`);

    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      for (const positions of ["locked", "unlocked"]) {
        if (positions === "unlocked") await page.getByRole("button", { name: "Positions locked" }).click();
        const preview = await page.evaluate(inspectPreview);
        if (width === 1440) {
          console.log(
            `  ${theme}, positions ${positions}: page drawn at ${preview.drawnAt}, shown at ${preview.shownAt}; ` +
              `on top of it: ${preview.onTopOfPage.join(", ") || "nothing"}; effects found: ${preview.problems.length}`,
          );
        }
        if (preview.drawnAt !== "800px" || preview.shownAt !== "800px") {
          problems.push(`at ${width}px the page is drawn at ${preview.drawnAt} and shown at ${preview.shownAt}`);
        }
        for (const problem of preview.problems) problems.push(`${theme}, ${positions}, ${width}px: ${problem}`);
        if (positions === "unlocked") await page.getByRole("button", { name: "Positions unlocked" }).click();
      }
    }
    await context.close();
  }

  // The field editor: same rules, with the fields drawn on the page. The
  // only things allowed on top of it are the field outlines (no fill).
  for (const width of [1440, 720, 420]) {
    const { context } = await app.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
    await page.getByRole("button", { name: "Edit fields" }).click();
    await waitForPdfPreview(page);

    const layout = await page.evaluate(inspectLayout);
    const outlines = await page.evaluate(() => {
      const paint = document.createElement("canvas").getContext("2d");
      return Array.from(document.querySelectorAll(".react-draggable")).map((el) => {
        const style = getComputedStyle(el);
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = style.backgroundColor;
        paint.fillRect(0, 0, 1, 1);
        return {
          line: style.borderTopWidth,
          filled: paint.getImageData(0, 0, 1, 1).data[3] > 0,
          glow: style.boxShadow !== "none",
        };
      });
    });
    let effects = 0;
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      const preview = await page.evaluate(inspectPreview);
      effects += preview.problems.length;
      if (preview.drawnAt !== "800px" || preview.shownAt !== "800px") {
        problems.push(`field editor, ${width}px: page drawn at ${preview.drawnAt}, shown at ${preview.shownAt}`);
      }
      for (const problem of preview.problems) problems.push(`field editor, ${theme}, ${width}px: ${problem}`);
    }
    const lines = [...new Set(outlines.map((o) => o.line))].join(", ");
    console.log(
      `Field editor, width ${String(width).padStart(4)}px: page drawn and shown at 800px, effects on it ${effects}, ` +
        `${outlines.length} field outlines (${lines} line, filled ${outlines.filter((o) => o.filled).length}, ` +
        `glow ${outlines.filter((o) => o.glow).length}), page scrolls sideways ${layout.pageScrollsSideways ? "YES" : "no"}, ` +
        `controls cut off: ${layout.controlsCutOff.length}`,
    );
    if (outlines.some((o) => o.filled || o.glow || parseFloat(o.line) > 2)) {
      problems.push(`field editor, ${width}px: a field outline has a fill, a glow or a line thicker than 2px`);
    }
    if (layout.pageScrollsSideways) problems.push(`field editor: at ${width}px the whole page scrolls sideways`);
    for (const control of layout.controlsCutOff) problems.push(`field editor: at ${width}px "${control}" is cut off`);
    await context.close();
  }

  // The new-template screen: the same rules for its preview. Here the page
  // is drawn at 800px and, as before the redesign, shown smaller only when
  // the window is too narrow for it (it shrinks to fit, never crops).
  for (const width of [1440, 720, 420]) {
    const { context } = await app.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, []);
    await page.getByRole("button", { name: "Upload a PDF", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles(app.writeTempFile("fake-form.pdf", pdf));
    await waitForPdfPreview(page);

    const layout = await page.evaluate(inspectLayout);
    const shown = [];
    for (const theme of ["dark", "light"]) {
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
      const preview = await page.evaluate(inspectPreview);
      shown.push(preview.shownAt);
      if (preview.drawnAt !== "800px") problems.push(`new template, ${width}px: page drawn at ${preview.drawnAt}`);
      if (parseInt(preview.shownAt, 10) > 800) problems.push(`new template, ${width}px: page shown larger than drawn`);
      for (const problem of preview.problems) problems.push(`new template, ${theme}, ${width}px: ${problem}`);
    }
    const proportions = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      return Math.abs((rect.width - 2) / (rect.height - 2) - canvas.width / canvas.height) < 0.01;
    });
    console.log(
      `New template, width ${String(width).padStart(4)}px: page drawn at 800px, shown at ${shown[0]}, ` +
        `proportions kept ${proportions ? "yes" : "NO"}, page scrolls sideways ${layout.pageScrollsSideways ? "YES" : "no"}, ` +
        `controls cut off: ${layout.controlsCutOff.length}`,
    );
    if (!proportions) problems.push(`new template, ${width}px: the page is stretched or squashed`);
    if (layout.pageScrollsSideways) problems.push(`new template: at ${width}px the whole page scrolls sideways`);
    for (const control of layout.controlsCutOff) problems.push(`new template: at ${width}px "${control}" is cut off`);
    await context.close();
  }

  // A dialog dims the screen behind it. Where a PDF preview is showing it
  // must not blur it; elsewhere it dims and blurs.
  {
    const { context } = await app.newContext();
    const page = await context.newPage();
    await page.goto(app.appUrl);
    await page.getByText("Your templates").waitFor();
    await seedTemplates(page, [makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]);
    const overlay = () =>
      page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('[data-slot="dialog-overlay"]'));
        return { blur: style.backdropFilter, dim: style.backgroundColor };
      });

    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("dialog").waitFor();
    const onHome = await overlay();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });

    await openFillScreen(page, "Fake Form");
    await page.getByRole("button", { name: "Clear values" }).click();
    await page.getByRole("dialog").waitFor();
    const onPreviewScreen = await overlay();
    await context.close();

    console.log(
      `Dialog overlay: home screen ${onHome.dim} with ${onHome.blur}; ` +
        `fill-in screen ${onPreviewScreen.dim} with blur ${onPreviewScreen.blur}`,
    );
    if (onPreviewScreen.blur !== "none") problems.push("a dialog blurs the screen that shows the PDF preview");
    if (!onHome.blur.startsWith("blur(")) problems.push("a dialog on the home screen no longer blurs what is behind it");
    for (const [where, value] of [["home", onHome], ["fill-in", onPreviewScreen]]) {
      if (!/0\.6\)$/.test(value.dim)) problems.push(`the ${where} overlay is not a 60% dim (${value.dim})`);
    }
  }
} finally {
  await app.close();
}

if (problems.length > 0) {
  console.log(`\nFAIL: ${problems.length} problem(s):`);
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: the page is untouched in both themes and the layout holds at every width tried.");
}
