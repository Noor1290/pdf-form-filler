// The "Form & images" tool: a form (PDF or images), boxes holding images,
// full-page images at the end, one PDF downloaded. Every size is measured
// in the downloaded PDF itself (tests/helpers/read-pdf-images.mjs), never
// on screen only. All files are fake, made by tests/helpers/fake-images.mjs.
//
//   npm run test:form-images
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { seedTemplates, startApp } from "./helpers/app.mjs";
import { buildSamplePdf, makeTemplate } from "./helpers/fake-data.mjs";
import {
  A4,
  LETTER,
  buildFakeForm,
  buildScannedPdf,
  file,
  makeFakeScan,
  makeImage,
  withExifOrientation,
} from "./helpers/fake-images.mjs";
import {
  addFullPageImages,
  chooseBoxImage,
  chooseForm,
  cleaningDone,
  dragOnPage,
  openFormImages,
  sharpeningDone,
  switchCleaningOff,
} from "./helpers/form-images-tool.mjs";
import { readPdfImages, readStoredImages } from "./helpers/read-pdf-images.mjs";
import { readPdfText } from "./helpers/read-pdf.mjs";

const TIMEOUT = { timeout: 240_000 };
const A4_MM = { width: 210, height: 297 };

let app;
before(async () => {
  app = await startApp();
}, TIMEOUT);
after(async () => {
  await app?.close();
});

// ---------------------------------------------------------------- helpers

// Opens the tool on its own. Tall enough to show a whole A4 page.
async function openTool() {
  const { context, outsideRequests } = await app.newContext({
    viewport: { width: 1440, height: 1300 },
  });
  const page = await context.newPage();
  await page.goto(app.appUrl);
  await openFormImages(page);
  return { page, context, outsideRequests };
}

async function boxLabel(page, label) {
  return (await page.getByTestId(`box-${label}`).innerText()).trim();
}

async function setBoxSize(page, width, height) {
  await page.getByLabel("Box width in cm").fill(width);
  await page.getByLabel("Box height in cm").fill(height);
  await page.getByRole("button", { name: "Set size" }).click();
}

async function setLimit(page, width, height) {
  await page.getByLabel("Limit width in cm").fill(width);
  await page.getByLabel("Limit height in cm").fill(height);
  await page.getByRole("button", { name: "Set limit" }).click();
}

async function download(page) {
  const started = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  const done = await started;
  return { name: done.suggestedFilename(), bytes: fs.readFileSync(await done.path()) };
}

// Equal to within a hundredth of a millimetre.
function near(actual, expected, what) {
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${what}: ${actual.toFixed(3)} mm in the PDF, expected ${expected.toFixed(3)} mm`,
  );
}

function assertPlaced(image, { x, y, width, height }, what) {
  near(image.x, x, `${what}, left`);
  near(image.y, y, `${what}, top`);
  near(image.width, width, `${what}, width`);
  near(image.height, height, `${what}, height`);
}

const cm = (mm) => (mm / 10).toFixed(1);

// ---------------------------------------------------------------- the form

test("a PDF form with several pages: every page shown and numbered, each kept at its own size in the download", TIMEOUT, async () => {
  const { page, context, outsideRequests } = await openTool();
  const pdf = await buildFakeForm([{ size: A4 }, { size: LETTER }, { size: A4, rotate: 90 }]);
  await chooseForm(page, [file("fake-form.pdf", pdf)], 3);
  for (const number of [1, 2, 3]) {
    await page.getByText(`Page ${number} of 3`, { exact: true }).waitFor();
  }
  await page.getByText("fake-form.pdf (3 pages)").waitFor();

  const { bytes } = await download(page);
  const pages = await readPdfImages(bytes);
  assert.equal(pages.length, 3);
  near(pages[0].widthMm, 210, "page 1 width");
  near(pages[0].heightMm, 297, "page 1 height");
  near(pages[1].widthMm, 215.9, "page 2 (Letter) width");
  near(pages[1].heightMm, 279.4, "page 2 (Letter) height");
  // Saved turned: seen as landscape, as in the original.
  near(pages[2].widthMm, 297, "page 3 (turned) width");
  near(pages[2].heightMm, 210, "page 3 (turned) height");
  const text = await readPdfText(bytes);
  for (const number of [1, 2, 3]) {
    assert.ok(
      text[number - 1].items.some((item) => item.text === `FAKE FORM page ${number}`),
      `page ${number} still has its text`,
    );
  }
  assert.deepEqual(outsideRequests, []);
  await context.close();
});

test("images as the form: each becomes one A4 page (landscape for a landscape image), the whole image fitted and centred, the JPEG kept byte for byte", TIMEOUT, async () => {
  const { page, context } = await openTool();
  const portrait = await makeImage(page, { width: 600, height: 900, type: "jpeg" });
  const landscape = await makeImage(page, { width: 900, height: 600 });
  // Stored lying down (400 × 200) with the note "turn a quarter right":
  // seen standing up, 200 × 400, so its page is portrait.
  const sideways = withExifOrientation(await makeImage(page, { width: 400, height: 200, type: "jpeg" }), 6);
  await chooseForm(
    page,
    [file("scan-1.jpg", portrait), file("scan-2.png", landscape), file("scan-3.jpg", sideways)],
    3,
  );
  await page.getByText("scan-1.jpg (3 pages)").waitFor();
  // Every page is a scan and is cleaned; switched off here, to check the
  // images as they are (cleaning is tested below).
  await cleaningDone(page);
  await switchCleaningOff(page);

  const { name, bytes } = await download(page);
  assert.equal(name, "scan-1_completed.pdf");
  const pages = await readPdfImages(bytes);
  assert.equal(pages.length, 3);

  near(pages[0].widthMm, 210, "portrait image page width");
  near(pages[0].heightMm, 297, "portrait image page height");
  // 600 × 900 on 210 × 297: as tall as the page, centred across.
  assertPlaced(pages[0].images[0], { x: 6, y: 0, width: 198, height: 297 }, "portrait image");

  near(pages[1].widthMm, 297, "landscape image page width");
  near(pages[1].heightMm, 210, "landscape image page height");
  assertPlaced(pages[1].images[0], { x: 0, y: 6, width: 297, height: 198 }, "landscape image");

  near(pages[2].widthMm, 210, "sideways photo page width (portrait)");
  // 200 × 400 seen: 148.5 wide, 297 tall, centred.
  assertPlaced(pages[2].images[0], { x: 30.75, y: 0, width: 148.5, height: 297 }, "sideways photo");

  const stored = await readStoredImages(bytes);
  const jpegs = stored.filter((image) => image.filter === "/DCTDecode");
  assert.ok(jpegs.some((image) => image.bytes.equals(portrait)), "the JPEG is in the PDF unchanged");
  assert.ok(jpegs.some((image) => image.bytes.equals(sideways)), "the sideways JPEG is in the PDF unchanged");
  const png = stored.find((image) => image.filter === "/FlateDecode" && !image.isTransparencyMask);
  assert.deepEqual([png.width, png.height], [900, 600], "the PNG at its full size, stored losslessly");
  await context.close();
});

test("a file that is not a PDF or an image, or a PDF with images, is refused and says why", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await page
    .getByTestId("form-input")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("just notes") });
  await page
    .getByText(`"notes.txt" isn't a PDF or an image this tool can use (JPG or PNG).`)
    .waitFor();
  const pdf = await buildFakeForm([{ size: A4 }]);
  const image = await makeImage(page, { width: 100, height: 100 });
  await page.getByTestId("form-input").setInputFiles([file("form.pdf", pdf), file("logo.png", image)]);
  await page.getByText("Choose one PDF, or one or more images (JPG or PNG), not both.").waitFor();
  await page.getByText("Upload the form").waitFor();
  await context.close();
});

// ---------------------------------------------------------------- boxes

test("PROOF: a box of 7.8 × 5.0 cm measures 7.8 × 5.0 cm in the downloaded PDF", TIMEOUT, async (t) => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [20, 30], [60, 60]);
  await setBoxSize(page, "7.8", "5.0");
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 7.8 × 5.0 cm");
  // An image with the box's own proportions fills it exactly.
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 780, height: 500 }), { sharpen: false });
  await page.getByText("Image as placed: 7.8 × 5.0 cm").waitFor();

  const { bytes } = await download(page);
  const [measured] = (await readPdfImages(bytes))[0].images;
  t.diagnostic(
    `measured in the PDF: ${measured.width.toFixed(4)} × ${measured.height.toFixed(4)} mm, ` +
      `top-left at ${measured.x.toFixed(4)}, ${measured.y.toFixed(4)} mm`,
  );
  assertPlaced(measured, { x: 20, y: 30, width: 78, height: 50 }, "the 7.8 × 5.0 cm box's image");
  await context.close();
});

test("an image with other proportions: the whole image, centred in the box, and the size shown is the size in the PDF", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [20, 30], [60, 60]);
  await setBoxSize(page, "7.8", "5.0");
  // 1000 × 400 is wider than the box: as wide as the box, centred down.
  await chooseBoxImage(page, "wide-logo.png", await makeImage(page, { width: 1000, height: 400 }), { sharpen: false });
  const shown = await page.getByText(/^Image as placed:/).innerText();

  const [measured] = (await readPdfImages((await download(page)).bytes))[0].images;
  assertPlaced(measured, { x: 20, y: 39.4, width: 78, height: 31.2 }, "the wide image");
  assert.equal(shown, `Image as placed: ${cm(measured.width)} × ${cm(measured.height)} cm`);
  assert.equal(shown, "Image as placed: 7.8 × 3.1 cm");
  await context.close();
});

test("drawing and moving a box: the size shown while drawing is the size in the PDF, in whole millimetres", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [25, 40], [80, 72], { release: false });
  await page.getByText("5.5 × 3.2 cm", { exact: true }).waitFor();
  await page.mouse.up();
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 5.5 × 3.2 cm");
  await page.getByRole("button", { name: "Box 1, page 1, 5.5 × 3.2 cm" }).waitFor();

  // Moved 10 mm right and 5 mm down, by its middle.
  await dragOnPage(page, 1, A4_MM.width, [52, 56], [62, 61]);
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 550, height: 320 }), { sharpen: false });

  const [measured] = (await readPdfImages((await download(page)).bytes))[0].images;
  assertPlaced(measured, { x: 35, y: 45, width: 55, height: 32 }, "the drawn and moved box's image");
  await context.close();
});

test("a box can't be drawn, resized or typed past its 8 × 8 cm limit, and says so", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  const limitNotice = page.getByText(
    `A box can't be larger than its size limit, 8.0 × 8.0 cm. You can change a box's limit under "Size limit".`,
  );

  // Dragged 140 mm wide: it stops at 80 mm.
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [150, 40], { release: false });
  await page.getByText("8.0 × 3.0 cm · at its size limit", { exact: true }).waitFor();
  await limitNotice.waitFor();
  await page.mouse.up();
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 8.0 × 3.0 cm");

  // Resized from its bottom-right corner 30 mm further right, 20 mm down.
  await page.getByRole("button", { name: "Set size" }).click(); // clears the notice
  await dragOnPage(page, 1, A4_MM.width, [90, 40], [120, 60]);
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 8.0 × 5.0 cm");
  await limitNotice.waitFor();

  // Typed as something that is not a size: nothing changes, and it says so.
  await setBoxSize(page, "wide", "5.0");
  await page.getByText("Type a size in cm, for example 7.8.").waitFor();
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 8.0 × 5.0 cm");

  // Typed larger: kept at the limit.
  await setBoxSize(page, "9.5", "5.0");
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 8.0 × 5.0 cm");
  await limitNotice.waitFor();
  assert.equal(await page.getByLabel("Box width in cm").inputValue(), "8.0");

  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 800, height: 500 }), { sharpen: false });
  const [measured] = (await readPdfImages((await download(page)).bytes))[0].images;
  assertPlaced(measured, { x: 10, y: 10, width: 80, height: 50 }, "the box at its limit");
  await context.close();
});

test("changing a box's limit: a larger one lets it grow to it, a smaller one makes the box smaller and says so", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [60, 60]);

  await setLimit(page, "10", "10");
  await setBoxSize(page, "9.5", "9.5");
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 9.5 × 9.5 cm");
  // Resized 25 mm further: stops at the new limit.
  await dragOnPage(page, 1, A4_MM.width, [105, 105], [130, 130]);
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 10.0 × 10.0 cm");
  await page
    .getByText(`A box can't be larger than its size limit, 10.0 × 10.0 cm.`, { exact: false })
    .waitFor();

  await setLimit(page, "6", "6");
  await page
    .getByText("Box 1 was made smaller to fit its new size limit: it is now 6.0 × 6.0 cm.")
    .waitFor();
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 6.0 × 6.0 cm");
  assert.equal(await page.getByLabel("Limit width in cm").inputValue(), "6.0");

  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 600, height: 600 }), { sharpen: false });
  const [measured] = (await readPdfImages((await download(page)).bytes))[0].images;
  assertPlaced(measured, { x: 10, y: 10, width: 60, height: 60 }, "the box after its limit was lowered");
  await context.close();
});

test("boxes on a later page, and on a page saved turned, land exactly where they were drawn, the right way up", TIMEOUT, async () => {
  const { page, context } = await openTool();
  const pdf = await buildFakeForm([{ size: A4 }, { size: A4, rotate: 90 }]);
  await chooseForm(page, [file("fake-form.pdf", pdf)], 2);
  // Page 2 is seen landscape: 297 mm wide.
  await dragOnPage(page, 2, 297, [20, 30], [98, 80]);
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 7.8 × 5.0 cm");
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 780, height: 500 }), { sharpen: false });
  await page.getByRole("button", { name: "Box 1, page 2, 7.8 × 5.0 cm" }).waitFor();

  const pages = await readPdfImages((await download(page)).bytes);
  assert.equal(pages[0].images.length, 0, "nothing on page 1");
  const [measured] = pages[1].images;
  assertPlaced(measured, { x: 20, y: 30, width: 78, height: 50 }, "the box on the turned page");
  near(measured.topLeftPixelAt[0], 20, "the image's top-left pixel, across");
  near(measured.topLeftPixelAt[1], 30, "the image's top-left pixel, down");
  await context.close();
});

test("a phone photo stored sideways is placed upright, with its JPEG unchanged", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [90, 90]);
  const photo = withExifOrientation(await makeImage(page, { width: 400, height: 200, type: "jpeg" }), 6);
  await chooseBoxImage(page, "photo.jpg", photo, { sharpen: false });
  await page.getByText("Image as placed: 4.0 × 8.0 cm").waitFor();

  const { bytes } = await download(page);
  const [measured] = (await readPdfImages(bytes))[0].images;
  assertPlaced(measured, { x: 30, y: 10, width: 40, height: 80 }, "the upright photo");
  // Turned a quarter right: the stored top-left pixel is seen top-right.
  near(measured.topLeftPixelAt[0], 70, "the stored top-left pixel, across");
  near(measured.topLeftPixelAt[1], 10, "the stored top-left pixel, down");
  const [stored] = await readStoredImages(bytes);
  assert.equal(stored.filter, "/DCTDecode");
  assert.ok(stored.bytes.equals(photo), "the JPEG is in the PDF unchanged");
  await context.close();
});

test("deleting a box asks first, and removes it and its image from the PDF", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [50, 50]);
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 100, height: 100 }), { sharpen: false });
  await dragOnPage(page, 1, A4_MM.width, [100, 100], [150, 150]);
  await page.getByText("No image yet, so not in the PDF: Box 2.").waitFor();

  await page.getByRole("button", { name: "Box 1, page 1, 4.0 × 4.0 cm" }).click();
  await page.getByRole("button", { name: "Delete box" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Delete Box 1?").waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("box-Box 1").count(), 1, "Cancel keeps it");

  await page.getByRole("button", { name: "Delete box" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByTestId("box-Box 1").waitFor({ state: "detached" });
  const pages = await readPdfImages((await download(page)).bytes);
  assert.equal(pages[0].images.length, 0, "no image left on the page (Box 2 has none)");
  await context.close();
});

test("another form: boxes stay on their pages, and a box on a page the new form doesn't have is removed, saying so", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("three-pages.pdf", await buildFakeForm([{ size: A4 }, { size: A4 }, { size: A4 }]))], 3);
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [50, 50]);
  await dragOnPage(page, 3, A4_MM.width, [10, 10], [50, 50]);
  await page.getByRole("button", { name: "Use another form" }).click();
  await page.getByRole("dialog").getByText("Use another form?").waitFor();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("dialog").getByRole("button", { name: "Choose another form" }).click();
  await (await chooser).setFiles(file("one-page.pdf", await buildFakeForm([{ size: A4 }])));
  await page.getByText("one-page.pdf (1 page)").waitFor();
  await page.getByText("Removed because the new form has no such page: Box 2.").waitFor();
  await page.getByRole("button", { name: "Box 1, page 1, 4.0 × 4.0 cm" }).waitFor();
  assert.equal(await page.getByTestId("box-Box 2").count(), 0);
  // The download's name follows the new form.
  assert.equal(await page.getByLabel("File name").inputValue(), "one-page_completed.pdf");
  await context.close();
});

// ------------------------------------------------------- full-page images

test("full-page images come after the form's last page, in the order chosen, and can be removed", TIMEOUT, async () => {
  for (const formPages of [1, 3]) {
    const { page, context } = await openTool();
    const form = await buildFakeForm(Array.from({ length: formPages }, () => ({ size: A4 })));
    await chooseForm(page, [file("fake-form.pdf", form)], formPages);
    const first = await makeImage(page, { width: 600, height: 400 });
    const second = await makeImage(page, { width: 300, height: 500, type: "jpeg" });
    await addFullPageImages(page, [file("first.png", first), file("second.jpg", second)], {
      sharpen: false,
    });
    await page.getByText(`Page ${formPages + 1}`, { exact: true }).waitFor();
    await page.getByText(`Page ${formPages + 2}`, { exact: true }).waitFor();
    await page.getByText(`Page ${formPages + 2} of ${formPages + 2} (full-page image)`).waitFor();

    const sizes = async () =>
      (await readPdfImages((await download(page)).bytes)).map((p) =>
        p.images.map((image) => `${image.pixelWidth}x${image.pixelHeight}`).join(),
      );
    const blank = Array(formPages).fill("");
    assert.deepEqual(await sizes(), [...blank, "600x400", "300x500"]);

    await page.getByRole("button", { name: `Move "second.jpg" up` }).click();
    assert.deepEqual(await sizes(), [...blank, "300x500", "600x400"]);

    await page.getByRole("button", { name: `Remove "first.png"` }).click();
    await page.getByRole("dialog").getByText(`"first.png" and its page will be removed from the PDF.`).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: `Remove "first.png"` }).waitFor({ state: "detached" });
    assert.deepEqual(await sizes(), [...blank, "300x500"]);
    await context.close();
  }
});

test("a full-page image: portrait A4, as large as fits inside the margin, centred, the rest filled with the colour of its edges", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  const navy = await makeImage(page, { width: 600, height: 400, edge: "#1b2a4a" });
  const white = await makeImage(page, { width: 400, height: 600, edge: "#ffffff", middle: "#c0392b", type: "jpeg" });
  await addFullPageImages(page, [file("navy.png", navy), file("white.jpg", white)], { sharpen: false });

  let pages = await readPdfImages((await download(page)).bytes);
  near(pages[1].widthMm, 210, "full page width");
  near(pages[1].heightMm, 297, "full page height");
  // 600 × 400 inside 190 × 277 (10 mm margin): 190 wide, centred down.
  assertPlaced(pages[1].images[0], { x: 10, y: 85.1667, width: 190, height: 126.6667 }, "navy image, 10 mm margin");
  assert.deepEqual(pages[1].fills[0], [27, 42, 74], "the navy page is filled navy");
  assert.ok(pages[2].fills[0].every((value) => value >= 250), `the white page is filled white (${pages[2].fills[0]})`);
  // 400 × 600 inside 190 × 277: 277 tall, centred across.
  assertPlaced(pages[2].images[0], { x: 12.6667, y: 10, width: 184.6667, height: 277 }, "white image");

  await page.getByLabel("Margin around each image (mm)").fill("20");
  await page.getByRole("button", { name: "Set margin" }).click();
  pages = await readPdfImages((await download(page)).bytes);
  assertPlaced(pages[1].images[0], { x: 20, y: 91.8333, width: 170, height: 113.3333 }, "navy image, 20 mm margin");
  await context.close();
});

test("full resolution: a JPEG is embedded unchanged (once, however often used), a PNG losslessly at its full size", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  const photo = await makeImage(page, { width: 2400, height: 1600, type: "jpeg", quality: 0.95 });
  const logo = await makeImage(page, { width: 1200, height: 900 });
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [70, 70]);
  await chooseBoxImage(page, "photo.jpg", photo, { sharpen: false });
  await dragOnPage(page, 1, A4_MM.width, [100, 100], [160, 160]);
  await chooseBoxImage(page, "logo.png", logo, { sharpen: false });
  await addFullPageImages(page, [file("photo-again.jpg", photo)]);

  const stored = await readStoredImages((await download(page)).bytes);
  const jpegs = stored.filter((image) => image.filter === "/DCTDecode");
  assert.equal(jpegs.length, 2, "the box's photo and the full-page photo (chosen twice)");
  for (const jpeg of jpegs) {
    assert.ok(jpeg.bytes.equals(photo), "the JPEG's bytes are the original file's");
    assert.deepEqual([jpeg.width, jpeg.height], [2400, 1600]);
  }
  const png = stored.find((image) => image.filter === "/FlateDecode" && !image.isTransparencyMask);
  assert.deepEqual([png.width, png.height], [1200, 900], "the PNG at its full size");
  await context.close();
});

// -------------------------------------------------------------- download

test("the download is named after the form with _completed, and the name can be changed", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("Form TM 1.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  assert.equal(await page.getByLabel("File name").inputValue(), "Form TM 1_completed.pdf");
  assert.equal((await download(page)).name, "Form TM 1_completed.pdf");
  await page.getByLabel("File name").fill("Fake company TM1");
  assert.equal((await download(page)).name, "Fake company TM1.pdf");
  await context.close();
});

// ---------------------------------------------------------------- leaving

test("leaving asks first: Stay keeps everything, Leave goes back to the templates", TIMEOUT, async () => {
  const { page, context, outsideRequests } = await openTool();
  // With nothing chosen yet, it leaves at once.
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByText("Your templates").waitFor();

  await page.getByRole("button", { name: "Open Form & images" }).click();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [10, 10], [50, 50]);
  await page.getByRole("button", { name: "Back to templates" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("The form and images you added will be cleared.").waitFor();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await boxLabel(page, "Box 1"), "Box 1 · 4.0 × 4.0 cm");

  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await page.getByText("Your templates").waitFor();
  // Nothing about the form was stored.
  const stored = await page.evaluate(() => Object.keys(localStorage));
  assert.ok(!stored.some((key) => /form-images/i.test(key)), `stored: ${stored.join(", ")}`);
  assert.deepEqual(outsideRequests, [], "nothing was sent anywhere");
  await context.close();
});

// ------------------------------------------------------------- sharpening
//
// The test browser has no graphics card, so the model runs on the
// processor (WebAssembly), as on a computer without WebGPU.

// Every request for the model or the runtime, by the page.
function countDownloads(page) {
  const seen = { model: 0, runtime: 0 };
  page.on("request", (request) => {
    const url = request.url();
    if (/\/models\/realesr-general-x4v3\.onnx$/.test(url)) seen.model++;
    if (/\.wasm$/.test(url)) seen.runtime++;
  });
  return seen;
}

async function aFormWithABox(page, from, to) {
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, from, to);
}

function storedSizes(stored) {
  return stored
    .filter((image) => !image.isTransparencyMask)
    .map((image) => `${image.filter} ${image.width}x${image.height}`)
    .sort();
}

test("how sharp each image will print is shown; sharpening is on by default for every image that needs it, in a box or on a full page, and can be switched off", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await aFormWithABox(page, [10, 10], [50, 40]);
  // 400 px across 4.0 cm: 254 dpi.
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 400, height: 300 }));
  const boxSwitch = page.getByRole("checkbox", { name: "Sharpen with AI (254 dpi at this size)" });
  assert.equal(await boxSwitch.isChecked(), true, "on for an image in a box");
  // Switched off: no sharpening, and nothing for the download to wait for.
  await boxSwitch.uncheck();
  assert.equal(await page.getByText(/^Sharpening…|^Waiting to be sharpened/).count(), 0);

  // 100 px across 19 cm: 13 dpi.
  await addFullPageImages(page, [file("tiny.png", await makeImage(page, { width: 100, height: 80 }))]);
  const pageSwitch = page.getByRole("checkbox", { name: "Sharpen with AI (13 dpi at this size)" });
  assert.equal(await pageSwitch.isChecked(), true, "on for a full-page image");
  await sharpeningDone(page);

  // 1000 px across 4.0 cm: nothing to sharpen.
  await chooseBoxImage(page, "big-logo.png", await makeImage(page, { width: 1000, height: 750 }));
  await page.getByText("635 dpi at this size: sharp enough.").waitFor();
  await context.close();
});

test("AI sharpening: enlarged by the model to 300 dpi at the printed size, embedded losslessly in exactly the same place; the model is downloaded once", TIMEOUT, async (t) => {
  const { page, context, outsideRequests } = await openTool();
  const downloads = countDownloads(page);
  await aFormWithABox(page, [20, 30], [40, 45]);
  // 64 px across 2.0 cm: 81 dpi. Sharpened, it needs 236 px (300 dpi),
  // which four times 64 (256) covers.
  await chooseBoxImage(page, "small-logo.jpg", await makeImage(page, { width: 64, height: 48, type: "jpeg" }));
  assert.equal(
    await page.getByRole("checkbox", { name: "Sharpen with AI (81 dpi at this size)" }).isChecked(),
    true,
    "on without being asked",
  );
  await page.getByText("Sharpened with AI: prints at 300 dpi.").waitFor({ timeout: 180_000 });
  // 40 px across 19 cm: even four times as large, 21 dpi.
  await addFullPageImages(page, [file("tiny.png", await makeImage(page, { width: 40, height: 30 }))]);
  await page.getByText("Sharpened with AI: prints at 21 dpi.").waitFor({ timeout: 180_000 });

  const { bytes } = await download(page);
  assert.deepEqual(
    storedSizes(await readStoredImages(bytes)),
    ["/FlateDecode 160x120", "/FlateDecode 236x177"],
    "both stored losslessly (the JPEG was not recompressed), at 300 dpi or four times their size",
  );
  const pages = await readPdfImages(bytes);
  assertPlaced(pages[0].images[0], { x: 20, y: 30, width: 20, height: 15 }, "the sharpened box image");
  assertPlaced(pages[1].images[0], { x: 10, y: 77.25, width: 190, height: 142.5 }, "the sharpened full-page image");
  // The page is filled with the colour the sharpened image's edges have
  // (sharpening shifts the shade a little), so no frame shows around it.
  const fill = pages[1].fills[0];
  const edge = pages[1].images[0].edgeColour;
  t.diagnostic(`full page: fill ${fill}, sharpened image's edges ${edge}`);
  assert.ok(fill.every((value, c) => Math.abs(value - edge[c]) <= 1), `fill ${fill} matches edges ${edge}`);

  // Again, after a reload: from the browser's cache, not downloaded again.
  await page.reload();
  await openFormImages(page);
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await addFullPageImages(page, [file("tiny-again.png", await makeImage(page, { width: 40, height: 30 }))]);
  await page.getByText("Sharpened with AI: prints at 21 dpi.").waitFor({ timeout: 180_000 });
  t.diagnostic(`downloads: model ${downloads.model}, runtime ${downloads.runtime}`);
  assert.deepEqual(downloads, { model: 1, runtime: 1 }, "the model and the runtime are downloaded once");
  assert.deepEqual(outsideRequests, [], "only this app's own site was asked for anything");
  await context.close();
});

test("sharpening switched off: the original is embedded unchanged", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await aFormWithABox(page, [20, 30], [40, 45]);
  const logo = await makeImage(page, { width: 64, height: 48, type: "jpeg" });
  await chooseBoxImage(page, "small-logo.jpg", logo, { sharpen: false });
  const photo = await makeImage(page, { width: 300, height: 200, type: "jpeg" });
  await addFullPageImages(page, [file("photo.jpg", photo)], { sharpen: false });

  const stored = await readStoredImages((await download(page)).bytes);
  assert.equal(stored.length, 2);
  assert.ok(stored.every((image) => image.filter === "/DCTDecode"));
  assert.ok(stored.some((image) => image.bytes.equals(logo)), "the box's JPEG unchanged");
  assert.ok(stored.some((image) => image.bytes.equals(photo)), "the full-page JPEG unchanged");
  await context.close();
});

test("when the model can't be downloaded: smooth resizing and gentle sharpening instead, and it says so", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await page.route("**/models/**", (route) => route.fulfill({ status: 404, body: "" }));
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await addFullPageImages(page, [file("tiny.png", await makeImage(page, { width: 50, height: 40 }))]);
  await page
    .getByText(
      "AI sharpening didn't work on this computer, so it was enlarged with smooth resizing and gentle sharpening instead: prints at 27 dpi.",
    )
    .waitFor({ timeout: 60_000 });
  const stored = await readStoredImages((await download(page)).bytes);
  assert.deepEqual(storedSizes(stored), ["/FlateDecode 200x160"], "four times as large, losslessly");
  await context.close();
});

test("when this computer would take too long: resizing instead, and it says so; the download waits until then", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  // 1600 × 1200 across 19 cm: 214 dpi. On the processor, piece by piece,
  // it would take several minutes.
  await addFullPageImages(page, [file("photo.png", await makeImage(page, { width: 1600, height: 1200 }))]);
  await page.getByText(/^Sharpening… \d+%$/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sharpening images…" }).isDisabled(), true);
  await page
    .getByText(
      "AI sharpening would take too long on this computer, so it was enlarged with smooth resizing and gentle sharpening instead: prints at 300 dpi.",
    )
    .waitFor({ timeout: 120_000 });
  const stored = await readStoredImages((await download(page)).bytes);
  // 300 dpi across 19 cm: 2244 px.
  assert.deepEqual(storedSizes(stored), ["/FlateDecode 2244x1683"]);
  await context.close();
});

test("before and after: both shown side by side, zoomed together", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await addFullPageImages(page, [file("tiny.png", await makeImage(page, { width: 60, height: 40 }))]);
  await sharpeningDone(page);
  await page.getByRole("button", { name: "Compare before and after" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Before and after").waitFor();
  await dialog.getByText("After", { exact: true }).waitFor();
  const images = dialog.locator("img");
  await images.nth(1).evaluate((image) => image.decode());
  // The "after" side is the image as it goes into the PDF: 240 × 160.
  assert.deepEqual(
    await images.nth(1).evaluate((image) => [image.naturalWidth, image.naturalHeight]),
    [240, 160],
  );
  await dialog.getByRole("button", { name: "4×" }).click();
  const widths = await images.evaluateAll((all) => all.map((image) => image.style.width));
  assert.deepEqual(widths, ["400%", "400%"]);
  await context.close();
});

// ------------------------------------------------------------ scan cleaning
//
// The fake scan (tests/helpers/fake-images.mjs) is downloaded with cleaning
// on and with it off, and the two pictures are compared pixel by pixel as
// the PDF holds them.

const lightness = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const closeTo = ([x, y], points, distance) =>
  points.some(([px, py]) => Math.abs(px - x) <= distance && Math.abs(py - y) <= distance);

async function scanPicture(page) {
  const [first] = await readPdfImages((await download(page)).bytes, { pixels: true });
  return first.images[0].pixels;
}

test("a scanned page is cleaned: the paper made white, the specks and the edge shadow removed; text, lines, stamps, signature and emblem kept", TIMEOUT, async (t) => {
  const { page, context } = await openTool();
  const { jpeg, where } = await makeFakeScan(page);
  await chooseForm(page, [file("scan.jpg", jpeg)], 1);
  await cleaningDone(page);
  const status = await page.getByText(/^Cleaned:/).innerText();
  t.diagnostic(status);
  assert.equal(status, "Cleaned: paper made white, 3 specks removed, 1 mark along the edge removed.");

  const after = await scanPicture(page);
  await switchCleaningOff(page);
  const before = await scanPicture(page);
  assert.deepEqual([after.width, after.height], [1240, 1754], "cleaned at the scan's own resolution");
  assert.deepEqual([before.width, before.height], [1240, 1754]);

  for (const point of where.paper) {
    assert.ok(lightness(before.at(...point)) < 240, `paper at ${point} was not white before`);
    assert.ok(after.at(...point).every((value) => value >= 250), `paper at ${point} is white: ${after.at(...point)}`);
  }
  // Every pixel of ink (dark before), other than what is removed, is
  // still dark after.
  let ink = 0;
  let stillInk = 0;
  for (let y = 0; y < before.height; y++) {
    for (let x = 40; x < before.width; x++) {
      if (closeTo([x, y], where.specks, 8) || lightness(before.at(x, y)) >= 100) continue;
      ink++;
      if (lightness(after.at(x, y)) < 130) stillInk++;
    }
  }
  t.diagnostic(`ink pixels kept: ${stillInk} of ${ink}`);
  assert.ok(ink > 20_000, "the fake scan has plenty of ink");
  assert.ok(stillInk / ink >= 0.995, `ink kept: ${stillInk} of ${ink}`);

  for (const point of where.redStamp) {
    const [r, g] = after.at(...point);
    assert.ok(r > g + 80, `the red stamp is still red at ${point}: ${after.at(...point)}`);
  }
  for (const point of where.paleStamp) {
    const [r, , b] = after.at(...point);
    assert.ok(b > r + 25 && lightness(after.at(...point)) < 245, `the pale stamp is kept at ${point}: ${after.at(...point)}`);
  }
  for (const point of [...where.specks, ...where.shadow]) {
    assert.ok(after.at(...point).every((value) => value >= 250), `removed at ${point}: ${after.at(...point)}`);
    assert.ok(lightness(before.at(...point)) < 120, `there was a mark at ${point} before`);
  }
  for (const point of where.footerStop) {
    assert.ok(lightness(after.at(...point)) < 130, "the footer's full stop, next to its text, is kept");
  }
  await context.close();
});

test("a PDF: its scanned page is cleaned (even with an invisible text layer); its text page is left exactly as it is", TIMEOUT, async () => {
  const { page, context } = await openTool();
  const { jpeg } = await makeFakeScan(page);
  await chooseForm(page, [file("scanned.pdf", await buildScannedPdf(jpeg))], 2);
  await cleaningDone(page);
  assert.equal(await page.getByRole("checkbox", { name: "Clean this scan" }).count(), 1, "only page 1 is a scan");

  const { bytes } = await download(page);
  const pages = await readPdfImages(bytes, { pixels: true });
  assert.equal(pages[0].images.length, 1);
  const cleaned = pages[0].images[0].pixels;
  assert.ok(cleaned.at(600, 250).every((value) => value >= 250), `the paper is white: ${cleaned.at(600, 250)}`);
  assert.ok(lightness(cleaned.at(600, 351)) < 130, `a form line is still dark: ${cleaned.at(600, 351)}`);
  assert.deepEqual([pages[0].images[0].pixelWidth, pages[0].images[0].pixelHeight], [1240, 1754], "at the scan's resolution");
  near(pages[0].widthMm, 210, "page 1 keeps its size");
  assert.equal(pages[1].images.length, 0);
  const text = await readPdfText(bytes);
  assert.ok(text[1].items.some((item) => item.text === "FAKE FORM page 2: real text"), "page 2 still has its text");
  const stored = await readStoredImages(bytes);
  assert.ok(!stored.some((image) => image.bytes.equals(jpeg)), "the scan was replaced by its cleaned picture");
  assert.ok(stored.every((image) => image.filter === "/FlateDecode"), "stored losslessly");

  // Switched off: the scanned page is copied exactly as it was.
  await switchCleaningOff(page);
  const original = await readStoredImages((await download(page)).bytes);
  assert.ok(original.some((image) => image.bytes.equals(jpeg)), "the scan's own JPEG, unchanged");
  await context.close();
});

test("a scan switched off goes into the PDF unchanged; the before and after can be compared", TIMEOUT, async () => {
  const { page, context } = await openTool();
  const { jpeg } = await makeFakeScan(page);
  await chooseForm(page, [file("scan.jpg", jpeg)], 1);
  await cleaningDone(page);

  await page.getByRole("button", { name: "Compare before and after" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText('"scan.jpg, page 1" Zoom in to see the difference; both sides move together.').waitFor();
  await dialog.locator("img").nth(1).waitFor();
  assert.equal(await dialog.locator("img").count(), 2);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  await switchCleaningOff(page);
  await page.getByText("Not cleaned: the page goes into the PDF as scanned.").waitFor();
  const stored = await readStoredImages((await download(page)).bytes);
  assert.equal(stored.length, 1);
  assert.ok(stored[0].bytes.equals(jpeg), "the scan's own JPEG, unchanged");
  await context.close();
});

// The cleaned picture of every page, in order.
async function scanPictures(page) {
  const pages = await readPdfImages((await download(page)).bytes, { pixels: true });
  return pages.map((one) => one.images[0].pixels);
}

async function cleaningStatuses(page) {
  return page.getByText(/^Cleaned:/).allInnerTexts();
}

// Pixels darker than `level` inside [left, top, right, bottom].
function darkIn(picture, [left, top, right, bottom], level) {
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) if (lightness(picture.at(x, y)) < level) count++;
  }
  return count;
}

test("the CamScanner footer is removed and listed, with the stray marks in the margin; a page without the footer says nothing of it; the form's shading, frame, text and ink are kept", TIMEOUT, async (t) => {
  const { page, context } = await openTool();
  const withFooter = await makeFakeScan(page, { extras: true, footer: "camscanner" });
  const without = await makeFakeScan(page, { extras: true });
  await chooseForm(page, [file("with-footer.jpg", withFooter.jpeg), file("without.jpg", without.jpeg)], 2);
  await cleaningDone(page);
  const statuses = await cleaningStatuses(page);
  t.diagnostic(statuses.join("\n"));
  assert.deepEqual(statuses, [
    'Cleaned: paper made white, 4 specks removed, 1 mark along the edge removed, 1 line in the margin removed, "Scanned with CamScanner" footer removed.',
    "Cleaned: paper made white, 4 specks removed, 2 marks along the edge removed, 1 line in the margin removed.",
  ]);

  const after = await scanPictures(page);
  await switchCleaningOff(page);
  const before = await scanPictures(page);

  // Before cleaning, on the yellowed paper, the footer's grey is darker
  // than 175; once the paper is white, darker than 215.
  const footerBox = withFooter.where.footerBox;
  assert.ok(darkIn(before[0], footerBox, 175) > 300, "the footer was there before");
  assert.equal(darkIn(after[0], footerBox, 250), 0, "the footer is gone, nothing of it left");

  for (const [index, { where }] of [withFooter, without].entries()) {
    const [b, a] = [before[index], after[index]];
    const which = `page ${index + 1}`;
    for (const point of [...where.marginSpeck, ...where.marginLine, ...where.edgeLine]) {
      assert.ok(lightness(b.at(...point)) < 150, `${which}: there was a mark at ${point} before`);
      assert.ok(a.at(...point).every((value) => value >= 250), `${which}: removed at ${point}: ${a.at(...point)}`);
    }
    // The shading stays light and even: not made white, not blotchy.
    for (const point of where.shading) {
      const light = lightness(a.at(...point));
      assert.ok(light > 200 && light < 247, `${which}: the shading is kept at ${point}: ${a.at(...point)}`);
    }
    const band = [660, 1115, 1055, 1165];
    const area = (band[2] - band[0]) * (band[3] - band[1]);
    const whitened = area - darkIn(a, band, 252);
    assert.ok(whitened / area < 0.02, `${which}: ${whitened} of ${area} pixels of the shading made white`);
    assert.ok(lightness(a.at(1061, 400)) < 130, `${which}: the frame line beside the margin speck is kept`);

    // Every pixel of ink, other than what is removed, is still dark.
    const removed = [...where.specks, ...where.marginSpeck, ...where.edgeLine];
    let ink = 0;
    let stillInk = 0;
    for (let y = 0; y < b.height; y++) {
      for (let x = 20; x < b.width; x++) {
        if (closeTo([x, y], removed, 8) || (y < 90 && x < 150)) continue;
        if (lightness(b.at(x, y)) >= 100) continue;
        ink++;
        if (lightness(a.at(x, y)) < 130) stillInk++;
      }
    }
    t.diagnostic(`${which}: ink pixels kept: ${stillInk} of ${ink}`);
    assert.ok(stillInk / ink >= 0.995, `${which}: ink kept: ${stillInk} of ${ink}`);
  }
  await context.close();
});

test("look-alikes of the footer stay: the same badge with other grey words, and the CamScanner words in black ink", TIMEOUT, async (t) => {
  const { page, context } = await openTool();
  const lookalike = await makeFakeScan(page, { footer: "lookalike" });
  const black = await makeFakeScan(page, { footer: "black" });
  await chooseForm(page, [file("lookalike.jpg", lookalike.jpeg), file("black.jpg", black.jpeg)], 2);
  await cleaningDone(page);
  const statuses = await cleaningStatuses(page);
  t.diagnostic(statuses.join("\n"));
  assert.deepEqual(statuses, [
    "Cleaned: paper made white, 3 specks removed.",
    "Cleaned: paper made white, 3 specks removed.",
  ]);

  const after = await scanPictures(page);
  await switchCleaningOff(page);
  const before = await scanPictures(page);
  for (const [index, { where }] of [lookalike, black].entries()) {
    // As in the test above: 175 on the yellowed paper, 215 once white.
    const was = darkIn(before[index], where.footerBox, 175);
    const is = darkIn(after[index], where.footerBox, 215);
    t.diagnostic(`page ${index + 1}: ${is} footer pixels after, ${was} before`);
    assert.ok(was > 300 && is >= was * 0.8, `page ${index + 1}: the footer is kept: ${is} of ${was}`);
  }
  await context.close();
});

// ------------------------------------------------------------ saved layouts

const LAYOUTS_KEY = "pdf-editor:form-image-layouts";

async function saveLayoutAs(page, name) {
  await page.getByLabel("Layout name").fill(name);
  await page.getByRole("button", { name: /^(Save layout|Replace saved layout)$/ }).click();
}

test("a layout is saved in this browser: the boxes (page, place, size, limit) and the margin, never the form or the images; it loads on a new form of the same kind", TIMEOUT, async () => {
  const { page, context } = await openTool();
  const form = await buildFakeForm([{ size: A4 }, { size: A4 }]);
  await chooseForm(page, [file("Form TM 1 (fake).pdf", form)], 2);
  await dragOnPage(page, 1, A4_MM.width, [20, 30], [60, 60]);
  await setBoxSize(page, "7.8", "5.0");
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 780, height: 500 }), { sharpen: false });
  await dragOnPage(page, 2, A4_MM.width, [100, 150], [130, 170]);
  await setLimit(page, "10", "10");
  await page.getByLabel("Margin around each image (mm)").fill("15");
  await page.getByRole("button", { name: "Set margin" }).click();

  await saveLayoutAs(page, "Form TM 1");
  await page
    .getByText('Saved "Form TM 1" in this browser: 2 boxes and the full-page margin. The form and the images are not saved.')
    .waitFor();
  await page.getByText("2 boxes, for 2 pages").waitFor();
  const stored = JSON.parse(await page.evaluate((key) => localStorage.getItem(key), LAYOUTS_KEY));
  assert.deepEqual(
    stored.map(({ savedAt: _, ...layout }) => layout),
    [
      {
        name: "Form TM 1",
        pages: [{ widthMm: 210, heightMm: 297 }, { widthMm: 210, heightMm: 297 }],
        boxes: [
          { page: 1, xMm: 20, yMm: 30, widthMm: 78, heightMm: 50, limitWidthMm: 80, limitHeightMm: 80 },
          { page: 2, xMm: 100, yMm: 150, widthMm: 30, heightMm: 20, limitWidthMm: 100, limitHeightMm: 100 },
        ],
        marginMm: 15,
      },
    ],
    "only the boxes and the margin: no image, no form",
  );
  const templates = await page.evaluate(() => localStorage.getItem("pdf-editor:templates"));
  assert.ok(!templates?.includes("Form TM 1"), "not a template");

  // A new form of the same kind, after leaving and coming back.
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await openFormImages(page);
  await chooseForm(page, [file("Form TM 1 (another, fake).pdf", form)], 2);
  await page.getByRole("button", { name: 'Load layout "Form TM 1"' }).click();
  await page
    .getByText('Loaded "Form TM 1": 2 boxes and a 15 mm full-page margin. Choose the image for each box.')
    .waitFor();
  await page.getByRole("button", { name: "Box 1, page 1, 7.8 × 5.0 cm" }).waitFor();
  await page.getByRole("button", { name: "Box 2, page 2, 3.0 × 2.0 cm" }).click();
  assert.equal(await page.getByLabel("Limit width in cm").inputValue(), "10.0");
  assert.equal(await page.getByLabel("Margin around each image (mm)").inputValue(), "15");
  await page.getByText("No image yet, so not in the PDF: Box 1, Box 2.").waitFor();
  await context.close();
});

test("loading a layout on a different form says what differs, leaves out boxes on missing pages, and asks first when there are boxes already", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("two-pages.pdf", await buildFakeForm([{ size: A4 }, { size: A4 }]))], 2);
  await dragOnPage(page, 1, A4_MM.width, [20, 30], [60, 60]);
  await dragOnPage(page, 2, A4_MM.width, [20, 30], [60, 60]);
  await saveLayoutAs(page, "Two pages");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Use another form" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Choose another form" }).click();
  await (await chooser).setFiles(file("letter.pdf", await buildFakeForm([{ size: LETTER }])));
  await page.getByText("letter.pdf (1 page)").waitFor();

  // Box 1 is still there from before: loading asks first.
  await page.getByRole("button", { name: 'Load layout "Two pages"' }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText('Load "Two pages"?').waitFor();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: 'Load layout "Two pages"' }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Load layout" }).click();
  await page
    .getByText(
      '"Two pages" was saved for a form of 2 pages of 21.0 × 29.7 cm; this form has 1 page of 21.5 × 27.9 cm. Its boxes on page 2 were left out. Check the boxes, and move or resize them where needed.',
    )
    .waitFor();
  assert.equal(await page.getByRole("button", { name: /^Box \d, page/ }).count(), 1);
  await context.close();
});

test("deleting a saved layout asks first; layouts are kept in this browser only, never in a backup", TIMEOUT, async () => {
  const { page, context } = await openTool();
  await chooseForm(page, [file("fake-form.pdf", await buildFakeForm([{ size: A4 }]))], 1);
  await dragOnPage(page, 1, A4_MM.width, [20, 30], [60, 60]);
  await saveLayoutAs(page, "Fake layout to delete");
  await saveLayoutAs(page, "Fake layout to keep");

  await page.getByRole("button", { name: 'Delete layout "Fake layout to delete"' }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText('"Fake layout to delete" will be removed from this browser. No form or image is affected.').waitFor();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: 'Load layout "Fake layout to delete"' }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: 'Load layout "Fake layout to keep"' }).waitFor();

  // A backup of this browser's templates does not carry layouts.
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave" }).click();
  await seedTemplates(page, [makeTemplate(await buildSamplePdf())], {
    [LAYOUTS_KEY]: await page.evaluate((key) => localStorage.getItem(key), LAYOUTS_KEY),
  });
  const backup = page.waitForEvent("download");
  await page.getByRole("button", { name: "Back up" }).click();
  const text = fs.readFileSync(await (await backup).path(), "utf8");
  assert.ok(text.includes("Fake Form"), "the backup has the template");
  assert.ok(!text.includes("Fake layout to keep"), "and no layout");
  await context.close();
});
