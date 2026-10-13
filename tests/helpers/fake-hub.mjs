// A stand-in for the Payroll Hub dashboard that keeps PDF templates and
// files, for the tests. It runs inside the stand-in dashboard page and
// follows hub_docs/INTEGRATION.md ("PDF form filler: templates in the
// dashboard"): the same actions, the same refusals, the same rules as the
// database (revision last seen, names unique, the file first).
//
// `createFakeHub` is turned into text and put in the page, so it must not
// use anything from outside itself.
import { HUB_ORIGIN } from "./app.mjs";

export const TEMPLATES_STANDIN_URL = `${HUB_ORIGIN}/standin-dashboard-with-templates/`;

export function createFakeHub(seed) {
  const state = {
    supported: seed.supported !== false,
    brn: seed.brn || "C1234567",
    label: seed.label || "ABC Co Ltd",
    role: seed.role || "admin",
    // template id -> row (with body)
    templates: new Map((seed.templates || []).map((row) => [row.template_id, { ...row }])),
    // sha256 -> base64
    files: new Map(Object.entries(seed.files || {})),
    others: seed.others || [{ brn: "C0000001", name: "New Venture Ltd" }],
    copies: [],
    // Every message from the app about templates and files, without file content.
    log: [],
    // The next message matching { dataType, action } is refused with { code, error }.
    // `store: true` carries it out first; `silent: true` sends no answer at all.
    failNext: null,
    // Stores the next save with a changed body, as a faulty store would.
    corruptNextSave: false,
    delayMs: 0,
    savesRunning: 0,
    mostSavesAtOnce: 0,
  };

  const refuse = (code, error) => ({ ok: false, code, error });
  const meta = () => ({ label: state.label, brn: state.brn, role: state.role });
  const sameBrn = (brn) => String(brn).trim().toUpperCase() === state.brn.toUpperCase();
  const summary = ({ body: _body, ...row }) => ({ ...row, updated_by_you: true });
  const nameTaken = (name, exceptId) =>
    [...state.templates.values()].some(
      (t) => t.template_id !== exceptId && t.name.toLowerCase() === name.toLowerCase(),
    );

  async function sha256(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { hash: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""), bytes };
  }

  async function request(dataType, params) {
    if (params.brn !== undefined && !sameBrn(params.brn)) {
      return refuse("wrong-company", "The dashboard has a different company selected.");
    }
    const answer = (rows) => ({ ok: true, dataType, rows, meta: meta() });
    if (dataType === "pdf-file") {
      if (params.action === "exists") return answer([{ sha256: params.sha256, exists: state.files.has(params.sha256) }]);
      if (params.action === "download") {
        const data = state.files.get(params.sha256);
        if (data === undefined) return refuse("not-found", "This company has no such PDF file in the dashboard.");
        return answer([{ sha256: params.sha256, bytes: atob(data).length, data }]);
      }
      return refuse("invalid", '"action" is missing or not valid.');
    }
    switch (params.action) {
      case "list":
        return answer([...state.templates.values()].map(summary));
      case "load": {
        const row = state.templates.get(params.template_id);
        return row ? answer([{ ...row, updated_by_you: true }]) : refuse("not-found", "This company has no such PDF template.");
      }
      case "companies":
        return answer(state.others);
      default:
        return refuse("invalid", '"action" is missing or not valid.');
    }
  }

  async function save(dataType, row) {
    if (!sameBrn(row.brn)) return refuse("wrong-company", "The dashboard has a different company selected.");
    if (dataType === "pdf-file") {
      if (state.role !== "admin") return refuse("forbidden", "Only an admin of this company can add a PDF form.");
      const { hash, bytes } = await sha256(row.data);
      if (bytes.length > 5 * 1024 * 1024) return refuse("too-large", "The PDF is larger than the dashboard stores (5 MB).");
      if (hash !== row.sha256) return refuse("invalid", "The file is not the one its hash names. Nothing was stored.");
      const already = state.files.has(hash);
      state.files.set(hash, row.data);
      return { ok: true, result: { sha256: hash, bytes: bytes.length, already_there: already } };
    }

    if (row.action === "copy-to-company") {
      const source = state.templates.get(row.template_id);
      if (!source) return refuse("not-found", "This company has no such PDF template.");
      const target = state.others.find((o) => o.brn === row.to_brn);
      if (!target) return refuse("not-found", "You have no other company with that BRN in the dashboard.");
      state.copies.push({ to_brn: row.to_brn, name: row.name, new_template_id: row.new_template_id, body: source.body, pdf_sha256: source.pdf_sha256 });
      return { ok: true, result: { action: "copy-to-company", template_id: row.new_template_id, name: row.name, revision: 1, to_company: target.name } };
    }

    if (state.role !== "admin") return refuse("forbidden", "Only an admin of this company can change its PDF templates.");
    const existing = state.templates.get(row.template_id);

    if (row.action === "delete") {
      if (!existing) return refuse("not-found", "The dashboard has no such item.");
      if (existing.revision !== row.expected_revision) return refuse("stale", "It was saved by someone else since you loaded it.");
      state.templates.delete(row.template_id);
      return { ok: true, result: { action: "delete", template_id: row.template_id, name: existing.name } };
    }

    if (row.action !== "save") return refuse("invalid", '"action" is missing or not valid.');
    if (!state.files.has(row.pdf_sha256)) return refuse("not-found", "The PDF file is not in the dashboard for this company. Send the file first, then save again.");
    if (!existing && row.expected_revision !== 0) return refuse("not-found", "The dashboard has no such item.");
    if (existing && existing.revision !== row.expected_revision) return refuse("stale", "It was saved by someone else since you loaded it.");
    if (nameTaken(row.name, row.template_id)) return refuse("invalid", "This company already has one with that name.");

    const stored = {
      template_id: row.template_id,
      name: row.name,
      revision: (existing ? existing.revision : 0) + 1,
      body: state.corruptNextSave ? { ...row.body, boxes: [] , changedByFaultyStore: true } : row.body,
      pdf_sha256: row.pdf_sha256,
      pdf_file_name: row.pdf_file_name,
      pdf_bytes: row.pdf_bytes,
      pdf_pages: row.pdf_pages,
      updated_at: new Date().toISOString(),
    };
    state.corruptNextSave = false;
    state.templates.set(stored.template_id, stored);
    return { ok: true, result: { action: "save", template_id: stored.template_id, name: stored.name, revision: stored.revision, updated_at: stored.updated_at } };
  }

  // Answers one message from the app. Resolves to the payload to send back,
  // or to undefined when no answer is to be sent.
  async function handle(type, payload) {
    const isRequest = type === "request-data";
    const command = isRequest ? payload.params || {} : (payload.rows || [])[0] || {};
    const { data: _data, ...withoutFile } = command;
    state.log.push({ kind: isRequest ? "request" : "save", dataType: payload.dataType, ...withoutFile, sentFile: "data" in command });

    if (!state.supported) {
      return { ok: false, error: `This app is not registered to ${isRequest ? "receive" : "send"} this kind of data.` };
    }

    const failing = state.failNext;
    const matches = failing && failing.dataType === payload.dataType && failing.action === command.action;
    if (matches) state.failNext = null;

    const isSave = !isRequest && payload.dataType === "pdf-template" && command.action === "save";
    if (isSave) {
      state.savesRunning += 1;
      state.mostSavesAtOnce = Math.max(state.mostSavesAtOnce, state.savesRunning);
    }
    if (state.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.delayMs));

    let answer;
    if (matches && !failing.store) answer = undefined;
    else answer = isRequest ? await request(payload.dataType, command) : await save(payload.dataType, command);
    if (isSave) state.savesRunning -= 1;

    if (matches) return failing.silent ? undefined : { ok: false, code: failing.code, error: failing.error || "The dashboard could not confirm it." };
    return answer;
  }

  return { state, handle };
}

// The stand-in dashboard page: the app in a frame, and the fake hub
// answering its messages about templates and files.
export function templatesStandinHtml(appUrl, appOrigin) {
  return `<!doctype html><html><head><title>Stand-in dashboard with templates (test)</title></head>
<body style="margin:0">
<iframe id="app" src="${appUrl}" style="width:1440px;height:1000px;border:0"></iframe>
<script>
  const frame = document.getElementById("app");
  ${createFakeHub.toString()}
  window.hub = createFakeHub(window.__hubSeed || {});
  window.received = [];
  const post = (type, payload, id) =>
    frame.contentWindow.postMessage({ type, from: "dashboard", to: "pdf-editor", version: 1, id, payload }, "${appOrigin}");
  window.addEventListener("message", async (event) => {
    if (event.source !== frame.contentWindow) return;
    const { type, id, payload } = event.data;
    window.received.push({ type, origin: event.origin });
    if (type === "ready") post("ping", {}, "ping-" + String(Date.now()).padStart(13, "0"));
    if (type !== "request-data" && type !== "send-data") return;
    if (payload.dataType !== "pdf-template" && payload.dataType !== "pdf-file") return;
    const answer = await window.hub.handle(type, payload);
    if (answer !== undefined) post(type === "request-data" ? "response-data" : "received", answer, id);
  });
</script></body></html>`;
}

// Opens the app inside the stand-in dashboard with templates. `seed` is
// what the dashboard holds; `browser` is what this browser's own storage
// holds for the app before it starts.
export async function openTemplatesStandin(app, seed, browser = {}) {
  const { context, outsideRequests } = await app.newContext();
  await context.route(TEMPLATES_STANDIN_URL, (route) =>
    route.fulfill({ contentType: "text/html", body: templatesStandinHtml(app.appUrl, app.appOrigin) }),
  );
  await context.addInitScript(
    ([hubSeed, appOrigin, storage]) => {
      window.__hubSeed = hubSeed;
      if (location.origin === appOrigin && !sessionStorage.getItem("seeded")) {
        sessionStorage.setItem("seeded", "1");
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
      }
    },
    [seed, app.appOrigin, browser],
  );
  const page = await context.newPage();
  await page.goto(TEMPLATES_STANDIN_URL);
  const frame = await (await page.locator("#app").elementHandle()).contentFrame();
  return { context, page, frame, outsideRequests };
}
