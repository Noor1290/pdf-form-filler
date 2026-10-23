// Steps for using the "Form & images" tool, shared by its own tests, the
// walkthrough (visible text, contrast) and the accessibility check.
import { file } from "./fake-images.mjs";

// From the home screen.
export async function openFormImages(page) {
  await page.getByRole("button", { name: "Open Form & images", exact: true }).click();
  await page.getByText("Upload the form").waitFor();
}

export async function chooseForm(page, files, pageCount) {
  await page.getByTestId("form-input").setInputFiles(files);
  await page.getByText(`Page ${pageCount} of `, { exact: false }).first().waitFor();
}

// Drags with the mouse between two points given in millimetres from the
// top-left of page `pageNumber` as shown, `widthMm` wide.
export async function dragOnPage(page, pageNumber, widthMm, from, to, { release = true } = {}) {
  const surface = page.getByTestId(`draw-on-page-${pageNumber}`);
  await surface.scrollIntoViewIfNeeded();
  const box = await surface.boundingBox();
  const scale = box.width / widthMm;
  const at = ([x, y]) => [box.x + x * scale, box.y + y * scale];
  await page.mouse.move(...at(from));
  await page.mouse.down();
  await page.mouse.move(...at([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]), { steps: 5 });
  await page.mouse.move(...at(to), { steps: 5 });
  if (release) await page.mouse.up();
}

// Images are sharpened unless switched off; `sharpen: false` switches it
// off for an image that would be sharpened.
export async function chooseBoxImage(page, name, buffer, { sharpen = true } = {}) {
  await page.getByTestId("box-image-input").setInputFiles(file(name, buffer));
  await page.getByText("Image as placed:").waitFor();
  if (sharpen) return;
  const settings = page.locator('section[aria-label$=" settings"]');
  const switchOn = settings.getByRole("checkbox", { name: /^Sharpen with AI/ });
  if (await switchOn.count()) await switchOn.uncheck();
}

export async function addFullPageImages(page, files, { sharpen = true } = {}) {
  const before = await page.getByRole("button", { name: /^Remove "/ }).count();
  await page.getByTestId("full-page-images-input").setInputFiles(files);
  await page
    .getByRole("button", { name: /^Remove "/ })
    .nth(before + files.length - 1)
    .waitFor();
  if (sharpen) return;
  for (const { name } of files) {
    const row = page.getByRole("listitem").filter({ hasText: name });
    const switchOn = row.getByRole("checkbox", { name: /^Sharpen with AI/ });
    if (await switchOn.count()) await switchOn.uncheck();
  }
}

// Waits until the image's sharpening has finished, one way or the other.
export async function sharpeningDone(page) {
  await page
    .getByText(/^(Sharpened with AI|AI sharpening .* instead)/)
    .first()
    .waitFor({ timeout: 180_000 });
}
