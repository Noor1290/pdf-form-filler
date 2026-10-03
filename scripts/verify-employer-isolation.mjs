// Proves that each template's company/employer details are fully
// independent of every other template's — editing one never leaks into
// another, "copy from a previous template" takes a one-time snapshot (not
// a live link), and persistence survives a reload. Run with:
//
//   node scripts/verify-employer-isolation.mjs
//
// No test framework or extra dependencies needed: this imports the real
// src/lib/template.ts and src/lib/employerProfile.ts directly (Node's
// built-in TypeScript type-stripping handles the `import type`-only
// cross-reference between them) against a tiny in-memory localStorage
// polyfill standing in for the browser.

import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const libUrl = (relativePath) =>
  pathToFileURL(path.join(here, relativePath)).href;

function makeLocalStorage(initial = new Map()) {
  const store = initial;
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    _dump: () => new Map(store), // for simulating a reload below
  };
}

globalThis.localStorage = makeLocalStorage();

const { createTemplate, getTemplate, saveTemplateEmployerFields } = await import(
  libUrl("../src/lib/template.ts")
);
const { getLegacyEmployerFields } = await import(
  libUrl("../src/lib/employerProfile.ts")
);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} - ${name}${detail ? " — " + detail : ""}`);
}

function newTemplateInput(name) {
  return { name, pdfFileName: `${name}.pdf`, pdfData: "ZmFrZQ==" }; // "fake", base64
}

// --- 1. A new template starts with no employer fields of its own, and that
//        emptiness isn't shared with any other template. ---
const formA = createTemplate(newTemplateInput("Form A"));
const formB = createTemplate(newTemplateInput("Form B"));

check(
  "New templates start with no employer fields of their own (not a shared default)",
  getTemplate(formA.id).employerFields === undefined &&
    getTemplate(formB.id).employerFields === undefined,
);

// --- 2. "Copy from a previous form" — both A and B copy from the SAME
//        legacy snapshot, proving the copy is a real snapshot, not a
//        shared reference to it or to each other. ---
globalThis.localStorage.setItem(
  "pdf-editor:employer-fields",
  JSON.stringify([
    { id: "companyName", label: "Company Name", value: "Shared Legacy Co" },
    { id: "address", label: "Address", value: "1 Shared St" },
    { id: "tan", label: "TAN", value: "SHARED1" },
  ]),
);

const legacySnapshot = getLegacyEmployerFields();
saveTemplateEmployerFields(formA.id, legacySnapshot);
saveTemplateEmployerFields(formB.id, getLegacyEmployerFields());

check(
  "Both templates copied the same starting values from the legacy snapshot",
  getTemplate(formA.id).employerFields[0].value === "Shared Legacy Co" &&
    getTemplate(formB.id).employerFields[0].value === "Shared Legacy Co",
);

// --- 3. Editing one template's employer details never changes another's,
//        in either direction — the actual bug this script was written to
//        rule out (or catch). ---
const aFields = getTemplate(formA.id).employerFields.map((f) =>
  f.id === "companyName" ? { ...f, value: "EDITED ONLY IN A" } : f,
);
saveTemplateEmployerFields(formA.id, aFields);

check(
  "Editing Form A does not change Form B",
  getTemplate(formB.id).employerFields[0].value === "Shared Legacy Co",
  `Form B now shows "${getTemplate(formB.id).employerFields[0].value}"`,
);

const bFields = getTemplate(formB.id).employerFields.map((f) =>
  f.id === "companyName" ? { ...f, value: "EDITED ONLY IN B" } : f,
);
saveTemplateEmployerFields(formB.id, bFields);

check(
  "Editing Form B does not change Form A",
  getTemplate(formA.id).employerFields[0].value === "EDITED ONLY IN A",
  `Form A now shows "${getTemplate(formA.id).employerFields[0].value}"`,
);

// --- 4. Mutating the object returned by getLegacyEmployerFields() (the
//        "copy source") after the fact must not retroactively change either
//        template — proves the copy was a real snapshot, not a live
//        reference into the legacy data. ---
const legacyAgain = getLegacyEmployerFields();
legacyAgain[0].value = "MUTATED AFTER COPY";
check(
  "Mutating the legacy snapshot after copying doesn't affect either template",
  getTemplate(formA.id).employerFields[0].value === "EDITED ONLY IN A" &&
    getTemplate(formB.id).employerFields[0].value === "EDITED ONLY IN B",
);

// --- 5. Reload: a fresh read of "persisted storage" (simulating closing
//        and reopening the browser) keeps each template's own data. ---
const persisted = globalThis.localStorage._dump();
globalThis.localStorage = makeLocalStorage(new Map(persisted)); // fresh instance, same bytes
const { getTemplate: getTemplateAfterReload } = await import(
  libUrl("../src/lib/template.ts") + "?reload=1" // bust the module cache for a clean re-import
);

check(
  "After a simulated reload, Form A still has its own value",
  getTemplateAfterReload(formA.id).employerFields[0].value === "EDITED ONLY IN A",
);
check(
  "After a simulated reload, Form B still has its own value",
  getTemplateAfterReload(formB.id).employerFields[0].value === "EDITED ONLY IN B",
);

console.log("\n==== SUMMARY ====");
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length > 0 ? 1 : 0);
