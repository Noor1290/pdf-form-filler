// Visible-text check. Walks through every screen and dialog with fake data
// and records every string a person can meet: visible text, tooltips,
// aria-labels, placeholders and alert messages. The result is compared with
// tests/expected/visible-text.json, recorded before the redesign started.
//
// A redesign may not reword anything. The only differences allowed are the
// strings listed in tests/approved-strings.json, each one approved by hand.
//
//   npm run check:text                         compare
//   UPDATE_RECORDINGS=1 npm run check:text     re-record the baseline
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startApp } from "./helpers/app.mjs";
import { expectedPath } from "./helpers/recording.mjs";
import { collectStrings } from "./helpers/visible-text.mjs";
import { walkThrough } from "./helpers/walkthrough.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const approvedFile = path.join(here, "approved-strings.json");

function compare(baseline, current, approved) {
  const problems = [];
  const names = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const name of [...names].sort()) {
    const before = new Set(baseline[name] ?? []);
    const now = new Set(current[name] ?? []);
    if (!(name in current)) {
      problems.push({ kind: "MISSING SCREEN", text: name, name });
    }
    for (const text of now) {
      if (!before.has(text) && !approved.added.includes(text)) {
        problems.push({ kind: "NEW    ", text, name });
      }
    }
    for (const text of before) {
      if (!now.has(text) && !approved.removed.includes(text)) {
        problems.push({ kind: "REMOVED", text, name });
      }
    }
  }
  return problems;
}

const app = await startApp();
const states = {};
try {
  await walkThrough(app, async (target, name) => {
    states[name] = await collectStrings(target);
  });
} finally {
  await app.close();
}

const baselineFile = expectedPath("visible-text");
const total = new Set(Object.values(states).flat()).size;

if (process.env.UPDATE_RECORDINGS === "1") {
  fs.writeFileSync(baselineFile, `${JSON.stringify(states, null, 2)}\n`, "utf8");
  console.log(
    `Recorded ${Object.keys(states).length} screens and dialogs, ${total} different strings.`,
  );
} else {
  const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const approved = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
  const problems = compare(baseline, states, approved);
  console.log(
    `Checked ${Object.keys(states).length} screens and dialogs, ${total} different strings ` +
      `(${approved.added.length} approved new, ${approved.removed.length} approved removed).`,
  );
  if (problems.length > 0) {
    // Each differing string once, with where it is, not once per screen.
    const grouped = new Map();
    for (const { kind, text, name } of problems) {
      const key = `${kind}  ${text}`;
      grouped.set(key, [...(grouped.get(key) ?? []), name]);
    }
    console.log("");
    console.log(`FAIL: ${grouped.size} string(s) differ and are not approved:`);
    for (const [key, where] of grouped) {
      const places = where.length > 2 ? `on ${where.length} screens` : where.join("; ");
      console.log(`  ${key}   (${places})`);
    }
    process.exitCode = 1;
  } else {
    console.log("PASS: no visible text differs from the pre-redesign recording.");
  }
}
