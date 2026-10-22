// The "Form & images" tool: a form (PDF or images), boxes holding images,
// full-page images at the end, one PDF downloaded. Every size is measured
// in the downloaded PDF itself (tests/helpers/read-pdf-images.mjs), never
// on screen only. All files are fake, made by tests/helpers/fake-images.mjs.
//
//   npm run test:form-images
import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, test } from "node:test";
import { startApp } from "./helpers/app.mjs";
import {
  A4,
  LETTER,
  buildFakeForm,
  file,
  makeImage,
  withExifOrientation,
} from "./helpers/fake-images.mjs";
import {
  addFullPageImages,
  chooseBoxImage,
  chooseForm,
  dragOnPage,
  openFormImages,
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
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 780, height: 500 }));
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
  await chooseBoxImage(page, "wide-logo.png", await makeImage(page, { width: 1000, height: 400 }));
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
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 550, height: 320 }));

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

  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 800, height: 500 }));
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

  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 600, height: 600 }));
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
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 780, height: 500 }));
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
  await chooseBoxImage(page, "photo.jpg", photo);
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
  await chooseBoxImage(page, "logo.png", await makeImage(page, { width: 100, height: 100 }));
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
    await addFullPageImages(page, [file("first.png", first), file("second.jpg", second)]);
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
  await addFullPageImages(page, [file("navy.png", navy), file("white.jpg", white)]);

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
  await chooseBoxImage(page, "photo.jpg", photo);
  await dragOnPage(page, 1, A4_MM.width, [100, 100], [160, 160]);
  await chooseBoxImage(page, "logo.png", logo);
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
