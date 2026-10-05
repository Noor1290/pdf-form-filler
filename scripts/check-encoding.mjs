// Encoding check. Scans every text file changed since the pre-redesign
// commit (the point where the `redesign` branch left `main`) for:
//   - bytes that are not valid UTF-8,
//   - mojibake: the tell-tale sequences left behind when UTF-8 text is read
//     as Windows-1252 and saved again (a dash turning into three odd letters),
//   - any change in which non-ASCII characters a file contains, listed with
//     the lines involved so each one can be looked at.
//
//   npm run check:encoding
//
import { execFileSync } from "node:child_process";
import fs from "node:fs";

// Built from character codes, so no broken sequence is ever typed here.
const chars = (...codes) => String.fromCodePoint(...codes);
const MOJIBAKE = [
  [chars(0xe2, 0x20ac), "a-circumflex + euro sign (a broken dash, quote or ellipsis)"],
  [chars(0xe2, 0x2020), "a-circumflex + dagger (a broken arrow)"],
  [chars(0xe2, 0x80), "a-circumflex + control character (a broken dash or quote)"],
  [chars(0xef, 0xbf, 0xbd), "i-diaeresis, inverted question mark, half (a broken replacement character)"],
  [chars(0xfffd), "replacement character (text that was already lost)"],
];
// A-tilde or A-circumflex followed by another character from the same
// range: how accented letters, middle dots and non-breaking spaces break.
const MOJIBAKE_PAIR = new RegExp(
  `[${chars(0xc3)}${chars(0xc2)}][${chars(0x80)}-${chars(0xbf)}]`,
);

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|jsx|json|css|html|md|yml|yaml|svg|txt)$/i;

// Not part of the redesign's own work, and scanned separately on purpose:
// the redesign prompt quotes the mojibake examples it warns about, and
// hub_docs/ is a copy of another project's files.
const NOT_SCANNED = [/^docs\/Redesign prompt/i, /^hub_docs\//, /^package-lock\.json$/];

const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"], // a new file has no earlier version; that is not an error
  });

const base = git("merge-base", "HEAD", "main").trim();
const changed = new Set(
  [
    ...git("diff", "--name-only", "-z", base).split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean),
);

const files = [...changed]
  .filter((file) => TEXT_FILE.test(file))
  .filter((file) => !NOT_SCANNED.some((pattern) => pattern.test(file)))
  .filter((file) => fs.existsSync(file))
  .sort();

const nonAscii = (text) => {
  const counts = new Map();
  for (const char of text) {
    if (char.codePointAt(0) > 127) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
};
const name = (char) =>
  `"${char}" U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
const linesWithNonAscii = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => nonAscii(line).size > 0)
    .map((line) => line.trim());

const failures = [];
const reviews = [];

for (const file of files) {
  const bytes = fs.readFileSync(file);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    failures.push(`${file}: not valid UTF-8`);
    continue;
  }

  text.split(/\r?\n/).forEach((line, index) => {
    for (const [pattern, meaning] of MOJIBAKE) {
      if (line.includes(pattern)) failures.push(`${file}:${index + 1}: ${meaning}`);
    }
    if (MOJIBAKE_PAIR.test(line)) {
      failures.push(`${file}:${index + 1}: a letter pair that looks like broken UTF-8`);
    }
  });

  let before = null;
  try {
    before = git("show", `${base}:${file}`);
  } catch {
    // new file: nothing to compare with
  }

  const now = nonAscii(text);
  const was = before === null ? new Map() : nonAscii(before);
  const differing = [...new Set([...now.keys(), ...was.keys()])].filter(
    (char) => (now.get(char) ?? 0) !== (was.get(char) ?? 0),
  );
  if (differing.length === 0) continue;

  const oldLines = new Set(before === null ? [] : linesWithNonAscii(before));
  const newLines = new Set(linesWithNonAscii(text));
  reviews.push({
    file,
    isNew: before === null,
    characters: differing.map(
      (char) => `${name(char)}: ${was.get(char) ?? 0} -> ${now.get(char) ?? 0}`,
    ),
    added: [...newLines].filter((line) => !oldLines.has(line)),
    removed: [...oldLines].filter((line) => !newLines.has(line)),
  });
}

console.log(`Encoding check: ${files.length} changed text file(s) since ${base.slice(0, 7)}.`);

if (reviews.length > 0) {
  console.log("\nNon-ASCII characters that changed (look at each one):");
  for (const review of reviews) {
    console.log(`\n  ${review.file}${review.isNew ? " (new file)" : ""}`);
    for (const line of review.characters) console.log(`    ${line}`);
    for (const line of review.added) console.log(`    + ${line.slice(0, 140)}`);
    for (const line of review.removed) console.log(`    - ${line.slice(0, 140)}`);
  }
} else {
  console.log("No file gained or lost a non-ASCII character.");
}

if (failures.length > 0) {
  console.log(`\nFAIL: ${failures.length} encoding problem(s):`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS: every changed file is valid UTF-8 with no mojibake.");
}
