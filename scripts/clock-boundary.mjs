// The rule CLAUDE.md called "the check" without anyone running it.
//
// Everything that makes code hard to test is pushed outward and main.ts absorbs
// all of it, so main.ts is the only file under src/ that may read a clock or
// generate randomness. That boundary is why the suite runs with no clock and
// nothing flakes, and it fails quietly: a stray setTimeout does not break a
// test, it makes one flaky months later.
//
// Comments are stripped first. Several files *describe* the rule in prose --
// "there is no Math.random anywhere under..." -- and a naive grep reports those
// as violations, which would make the check unusable and then ignored.
//
// Usage:  node scripts/clock-boundary.mjs [SRC_DIR]
// Exit 0 when the boundary holds, 1 when it does not, 2 when it could not look.
import fs from "node:fs";
import path from "node:path";

const SRC = process.argv[2] || "puyopuyo/src";
const ALLOWED = "main.ts";
const FORBIDDEN = /\b(Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame|Math\.random)\b/;

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`No ${SRC} to check — refusing to report a boundary as held.`);
  process.exit(2);
}

const files = walk(SRC);
if (files.length === 0) {
  console.error(`No TypeScript found under ${SRC} — refusing to report a pass.`);
  process.exit(2);
}

// The allowed file must actually use one of these, or the pattern has drifted
// and the whole check is asserting nothing.
const main = files.find((f) => path.basename(f) === ALLOWED);
if (!main || !FORBIDDEN.test(stripComments(fs.readFileSync(main, "utf8")))) {
  console.error(`${ALLOWED} uses none of these — the pattern no longer matches`);
  console.error("anything, so this check would pass against any code at all.");
  process.exit(2);
}

const violations = [];
for (const file of files) {
  if (path.basename(file) === ALLOWED) continue;
  stripComments(fs.readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
    const m = line.match(FORBIDDEN);
    if (m) violations.push(`${file}:${i + 1}: ${m[1]}`);
  });
}

if (violations.length > 0) {
  console.error("A clock or randomness escaped main.ts:");
  for (const v of violations) console.error(`  ${v}`);
  console.error("Time is an input: take it as tick(ms) or advance(ms) instead.");
  process.exit(1);
}
console.log(`clock boundary holds across ${files.length} files`);
