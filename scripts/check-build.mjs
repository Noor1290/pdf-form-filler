// Production-build check. Builds the app, then confirms:
//   - nothing from the test tooling (Playwright, the test helpers, the
//     stand-in dashboard) ended up in the files that get published,
//   - every font is a local file,
//   - the built app, used for real in a browser, never asks any server
//     other than itself for anything.
//
//   npm run check:build
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { preview } from "vite";
import { buildSamplePdf, COMPANY_DETAILS, makeTemplate } from "../tests/helpers/fake-data.mjs";

execSync("npm run build", { stdio: "ignore" });

const dist = path.resolve("dist");
const files = fs
  .readdirSync(dist, { recursive: true })
  .map((file) => path.join(dist, String(file)))
  .filter((file) => fs.statSync(file).isFile());

const problems = [];

// 1. Nothing from the test tooling in the published files.
const TEST_ONLY = ["playwright", "__writerProbe", "writer-probe", "standin-dashboard", "UPDATE_RECORDINGS"];
const textFiles = files.filter((file) => /\.(js|mjs|css|html|json|svg)$/.test(file));
for (const file of textFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const marker of TEST_ONLY) {
    if (text.includes(marker)) problems.push(`${path.relative(dist, file)} contains "${marker}"`);
  }
}
console.log(`Test tooling in the build: ${problems.length === 0 ? "none" : "FOUND"} (${textFiles.length} files searched).`);

// 2. Fonts are bundled, not linked.
const fonts = files.filter((file) => /\.(woff2?|ttf|otf)$/.test(file));
const css = textFiles.filter((file) => file.endsWith(".css")).map((file) => fs.readFileSync(file, "utf8")).join("\n");
const remoteInCss = css.match(/url\(\s*["']?https?:[^)]*\)|@import\s+["']https?:[^;]*/g) ?? [];
for (const remote of remoteInCss) problems.push(`stylesheet loads something remote: ${remote}`);
console.log(`Fonts: ${fonts.length} local file(s); remote fonts or imports in the stylesheet: ${remoteInCss.length}.`);

// 3. Use the built app and record every request it makes.
const server = await preview({ logLevel: "silent", preview: { port: 5198, strictPort: false } });
const appUrl = server.resolvedUrls.local[0];
const origin = new URL(appUrl).origin;
const browser = await chromium.launch();
const context = await browser.newContext({ acceptDownloads: true });
const outside = [];
let localRequests = 0;
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith(`${origin}/`)) {
    localRequests++;
    return route.continue();
  }
  outside.push(url);
  return route.abort();
});

try {
  const page = await context.newPage();
  await page.goto(appUrl);
  await page.getByText("Your templates").waitFor();
  const pdf = await buildSamplePdf();
  await page.evaluate(
    (templates) => localStorage.setItem("pdf-editor:templates", templates),
    JSON.stringify([makeTemplate(pdf, { employerFields: COMPANY_DETAILS })]),
  );
  await page.reload();
  await page.getByRole("button", { name: /^Fake Form Last updated/ }).click();
  await page.waitForFunction(() => (document.querySelector("canvas")?.width ?? 0) > 310);
  await page.getByLabel("Surname", { exact: true }).fill("Testperson");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  await download;
  await page.getByRole("button", { name: "Edit fields" }).click();
  await page.waitForFunction(() => (document.querySelector("canvas")?.width ?? 0) > 310);
  await page.getByRole("button", { name: "Back to templates" }).click();
  await page.getByRole("button", { name: "Company details", exact: true }).click();
  await page.waitForTimeout(500);
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

for (const url of outside) problems.push(`the built app requested ${url}`);
console.log(`Requests while using the built app: ${localRequests} to itself, ${outside.length} to outside servers.`);

if (problems.length > 0) {
  console.log(`\nFAIL:`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: the build contains no test tooling and makes no outside requests.");
}
