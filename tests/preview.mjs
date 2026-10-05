// Checks that the PDF preview is left alone and that the layout holds when
// the window is narrow:
//   - nothing blurs, tints, fades or filters the rendered page, in either
//     theme, and nothing with a fill sits on top of it,
//   - the page is always drawn at its fixed 800px, never scaled,
//   - at a narrow width the page itself never scrolls sideways (the preview
//     scrolls inside its own frame instead) and every control stays reachable.
//
//   npm run check:preview
import { openFillScreen, seedTemplates, startApp } from "./helpers/app.mjs";
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
