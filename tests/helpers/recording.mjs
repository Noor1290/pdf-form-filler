// Compares what a test observed against the saved expected result in
// tests/expected/. Recordings are only ever (re)written on purpose:
//   UPDATE_RECORDINGS=1 npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expectedDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "expected",
);

export function expectedPath(name) {
  return path.join(expectedDir, `${name}.json`);
}

export function checkRecording(name, observed) {
  const file = expectedPath(name);
  // Through JSON and back, so the comparison sees exactly what is stored.
  const actual = JSON.parse(JSON.stringify(observed));

  if (process.env.UPDATE_RECORDINGS === "1") {
    fs.mkdirSync(expectedDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    return;
  }
  assert.ok(
    fs.existsSync(file),
    `No saved recording "${name}". Create it with UPDATE_RECORDINGS=1 npm test`,
  );
  assert.deepStrictEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")));
}
