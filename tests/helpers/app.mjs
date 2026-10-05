// Starts the real app (Vite dev server on a local port) and a browser for the
// tests. Every browser context is guarded: only the local app may be
// requested, the stand-in dashboard is answered from memory, and anything
// else is blocked and recorded so a test can assert that nothing tried to
// leave the machine.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { readPdfText } from "./read-pdf.mjs";
import { collectStrings, DIALOG } from "./visible-text.mjs";

// The only origin the bridge trusts. The page served "from" it below is a
// local test page: the request is answered by Playwright and never sent.
export const HUB_ORIGIN = "https://noor1290.github.io";
export const STANDIN_URL = `${HUB_ORIGIN}/standin-dashboard-for-tests/`;
const STORAGE_KEY = "pdf-editor:templates";

function standinHtml(appUrl, appOrigin) {
  return `<!doctype html><html><head><title>Stand-in dashboard (test)</title></head>
<body style="margin:0">
<iframe id="app" src="${appUrl}" style="width:1440px;height:1000px;border:0"></iframe>
<script>
  const frame = document.getElementById("app");
  window.hub = { received: [], requestReply: null };
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    window.hub.received.push({ origin: event.origin, message: event.data });
    if (event.data.type === "request-data" && window.hub.requestReply) {
      window.hub.send("response-data", window.hub.requestReply, event.data.id);
    }
  });
  window.hub.send = (type, payload, id) => {
    frame.contentWindow.postMessage(
      { type, from: "dashboard", to: "pdf-editor", version: 1, id, payload },
      "${appOrigin}",
    );
  };
</script></body></html>`;
}

export async function startApp() {
  const server = await createServer({
    logLevel: "silent",
    server: { port: 5199, strictPort: false },
  });
  await server.listen();
  const appUrl = server.resolvedUrls.local[0];
  const appOrigin = new URL(appUrl).origin;

  // A public page may not frame localhost in current Chromium. In production
  // the dashboard and the app share one origin, so that check never applies
  // there; it is switched off for the test browser only.
  const browser = await chromium.launch({
    args: ["--disable-features=LocalNetworkAccessChecks"],
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-filler-tests-"));

  async function newContext() {
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "UTC",
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const outsideRequests = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${appOrigin}/`)) return route.continue();
      if (url === STANDIN_URL) {
        return route.fulfill({
          contentType: "text/html",
          body: standinHtml(appUrl, appOrigin),
        });
      }
      outsideRequests.push(url);
      return route.abort();
    });
    return { context, outsideRequests };
  }

  // The dev server prepares its dependencies on first use and can reload
  // the page once while doing so; get that out of the way before any test.
  {
    const { context } = await newContext();
    const page = await context.newPage();
    await page.goto(appUrl);
    await page.getByText("Your templates").waitFor();
    await loadWriterProbe(page, appUrl);
    await page.waitForTimeout(1500);
    await context.close();
  }

  return {
    appUrl,
    appOrigin,
    tempDir,
    newContext,
    writeTempFile(name, content) {
      const file = path.join(tempDir, name);
      fs.writeFileSync(file, content);
      return file;
    },
    async close() {
      await browser.close();
      await server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export async function loadWriterProbe(target, appUrl) {
  await target.evaluate(
    (url) => import(/* @vite-ignore */ url),
    `${appUrl}tests/helpers/writer-probe.ts`,
  );
}

// `target` is a Page or a Frame throughout (the app runs in a frame when
// it is embedded in the stand-in dashboard).
export async function seedTemplates(target, templates, extraStorage = {}) {
  await target.evaluate(
    ([key, value, extra]) => {
      localStorage.clear();
      localStorage.setItem(key, value);
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
    },
    [STORAGE_KEY, JSON.stringify(templates), extraStorage],
  );
  await reloadApp(target);
}

// Waits for the reload to finish, so nothing reads the page it replaced.
export async function reloadApp(target) {
  if (typeof target.reload === "function") await target.reload();
  else await target.goto(target.url());
}

export async function readStoredTemplates(target) {
  // Typed values and people are saved a moment after the last change.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const raw = await target.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

const hundredth = (value) => Math.round(value * 100) / 100;

// Stored templates without the parts that differ on every run (random ids,
// timestamps, the PDF's own bytes), with values keyed by field name.
export function describeTemplates(templates, uploadedPdfBase64) {
  return templates.map((template) => {
    const nameById = new Map(template.boxes.map((box) => [box.id, box.name]));
    const byFieldName = (values = {}) =>
      Object.fromEntries(
        Object.entries(values)
          .map(([id, value]) => [nameById.get(id) ?? `unknown field ${id}`, value])
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    return {
      name: template.name,
      pdfFileName: template.pdfFileName,
      pdfStoredUnchanged:
        uploadedPdfBase64 === undefined
          ? "not checked"
          : template.pdfData === uploadedPdfBase64,
      fields: template.boxes.map(({ id: _id, x, y, width, height, ...style }) => ({
        ...style,
        x: hundredth(x),
        y: hundredth(y),
        width: hundredth(width),
        height: hundredth(height),
      })),
      formValues: byFieldName(template.values),
      people: (template.entries ?? []).map((entry) => byFieldName(entry.values)),
      companyDetails:
        template.employerFields?.map(({ label, value }) => ({ label, value })) ??
        "not set",
    };
  });
}

// Clicks Download PDF while the writer probe is recording, and returns what
// the app handed to the PDF writer plus the text read back from the file.
export async function downloadAndRead(page, target = page) {
  await target.evaluate(() => window.__writerProbe.start());
  const downloadStarted = page.waitForEvent("download");
  await target.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadStarted;
  const bytes = fs.readFileSync(await download.path());
  const handedToWriter = await target.evaluate(() => window.__writerProbe.stop());
  return {
    fileName: download.suggestedFilename(),
    handedToWriter: handedToWriter.map(roundWriterCall),
    readBack: await readPdfText(bytes),
  };
}

export function roundWriterCall(call) {
  return { ...call, x: hundredth(call.x), y: hundredth(call.y) };
}

export function dialogStrings(target) {
  return collectStrings(target, DIALOG);
}

export async function openFillScreen(target, templateName) {
  await target
    .getByRole("button", { name: new RegExp(`^${templateName} Last updated`) })
    .click();
  // Not a heading lookup: when dashboard data is waiting, the import preview
  // opens on top straight away and hides the screen behind it from role
  // queries. The preview canvas only exists once the screen is showing.
  await waitForPdfPreview(target);
}

// The preview canvas starts at the browser's default 300px and only gets
// its real size once the PDF has been drawn.
export async function waitForPdfPreview(target) {
  await target.locator("canvas").first().waitFor();
  await target.waitForFunction(() => {
    const canvas = document.querySelector("canvas");
    return !!canvas && canvas.width > 310;
  });
  // The page around the preview settles a moment after the PDF is drawn.
  // Wait until the preview has stopped moving, so a drag that starts now
  // isn't cut short by the layout shifting under the pointer.
  const canvas = target.locator("canvas").first();
  let previous = "";
  for (let steadyChecks = 0; steadyChecks < 3; ) {
    const current = JSON.stringify(await canvas.boundingBox());
    steadyChecks = current === previous ? steadyChecks + 1 : 0;
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function peopleCount(target) {
  return target.getByRole("button", { name: /^Person \d+$/ }).count();
}
