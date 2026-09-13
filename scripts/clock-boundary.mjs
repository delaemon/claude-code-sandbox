// Keep a named class of call out of everything but one file.
//
// The first project using this harness pushed everything that makes code hard
// to test outward, so exactly one file could read a clock or generate
// randomness. That boundary is why its suite ran with no clock and nothing
// flaked -- and it fails quietly: a stray setTimeout does not break a test, it
// makes one flaky months later.
//
// CLAUDE.md there called `grep` for those names "the check that it still
// holds". Nothing ran that grep. A guard described as existing, that did not.
//
// Configure via harness.config.json -> clockBoundary. Disabled by default,
// because the rule is a real design choice and not every project makes it.
//
// Comments are stripped first: files that *describe* the rule in prose are not
// violating it, and a check that reports them is a check nobody keeps.
//
// Exit 0 when the boundary holds, 1 when it does not, 2 when it could not look,
// 3 when it is not configured.
import fs from "node:fs";
import path from "node:path";
import { REPO, load } from "./config.mjs";

const cfg = load().clockBoundary ?? {};
if (!cfg.enabled) {
  console.error("clockBoundary is disabled in harness.config.json.");
  console.error("Reporting did-not-run rather than a pass.");
  process.exit(3);
}
if (!cfg.srcDir || !Array.isArray(cfg.forbidden) || cfg.forbidden.length === 0) {
  console.error("clockBoundary is enabled but has no srcDir or no forbidden list.");
  process.exit(2);
}

const SRC = path.join(REPO, cfg.srcDir);
const ALLOWED = cfg.allowedFile;
const FORBIDDEN = new RegExp(
  `\\b(${cfg.forbidden.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
);

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`No ${cfg.srcDir} to check — refusing to report a boundary as held.`);
  process.exit(2);
}
const files = walk(SRC);
if (files.length === 0) {
  console.error(`No source found under ${cfg.srcDir} — refusing to report a pass.`);
  process.exit(2);
}

// The allowed file must actually use one of these, or the pattern has drifted
// and the whole check is asserting nothing against any code at all.
if (ALLOWED) {
  const main = files.find((f) => path.basename(f) === ALLOWED);
  if (!main || !FORBIDDEN.test(stripComments(fs.readFileSync(main, "utf8")))) {
    console.error(`${ALLOWED} uses none of these — the pattern no longer matches`);
    console.error("anything, so this check would pass against any code at all.");
    process.exit(2);
  }
}

const violations = [];
for (const file of files) {
  if (ALLOWED && path.basename(file) === ALLOWED) continue;
  stripComments(fs.readFileSync(file, "utf8")).split("\n").forEach((line, i) => {
    const m = line.match(FORBIDDEN);
    if (m) violations.push(`${path.relative(REPO, file)}:${i + 1}: ${m[1]}`);
  });
}

if (violations.length > 0) {
  console.error(`A forbidden call escaped ${ALLOWED ?? "the boundary"}:`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`boundary holds across ${files.length} files`);
