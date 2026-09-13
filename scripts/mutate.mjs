// Mutation testing: change the code, require the suite to notice.
//
// A passing suite proves the tests ran, not that they would catch anything. The
// first project using this harness shipped tests that passed against a renderer
// ignoring its palette entirely -- and the first attempt to prove they bit did
// it by permuting the palette, which passes, correctly, because the
// expectations are written against that same palette.
//
// So mutants must damage **behaviour**, never data. A mutant that edits a
// constant the tests also read is a mutant that proves nothing.
//
// Mutants are declared in harness.config.json. Each names the claim it puts to
// the test; a mutant the suite survives is the finding.
//
// Exit 0 when every mutant is killed, 1 when one survives, 2 when it could not
// run, 3 when nothing is configured.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireApp } from "./config.mjs";

const { cfg, dir: appDir, full: appFull } = requireApp("mutation testing");
const MUTANTS = cfg.mutants ?? [];
if (MUTANTS.length === 0) {
  console.error("harness.config.json declares no mutants.");
  console.error("Reporting did-not-run: zero mutants killed is not zero mutants surviving.");
  process.exit(3);
}

const only = (() => {
  if (!process.argv.includes("--only")) return null;
  // `--only` with nothing after it, or an empty string, used to select every
  // mutant: `!only` was true and the filter kept them all, so a caller who
  // believed the run was narrow got a green for the whole suite.
  const v = process.argv[process.argv.indexOf("--only") + 1];
  if (!v) {
    console.error("--only needs a value. Refusing to silently select everything.");
    process.exit(2);
  }
  return v;
})();

const applicable = MUTANTS.filter((m) => !only || m.name.includes(only));
if (applicable.length === 0) {
  console.error("No mutants selected — refusing to report that as all killed.");
  process.exit(2);
}

const TEST = cfg.app.test ?? "npm test";
const FAILED_RE = new RegExp(cfg.app.testReportsFailures ?? "\\b\\d+\\s+failed\\b");

/**
 * Mutations run in a copy, never in the working tree.
 *
 * The first version wrote each mutant into the source and restored it after. A
 * `finally` covered an interrupt, but not the window itself: while a mutant is
 * applied the working tree holds deliberately broken code, and a session that
 * commits on a Stop hook can pick it up. That nearly happened -- a commit was
 * one step from shipping a deliberately broken key map. A check that can ship
 * the damage it creates is worse than no check.
 */
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-"));
  const dst = path.join(dir, path.basename(appDir));
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(appFull)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    fs.cpSync(path.join(appFull, entry), path.join(dst, entry), { recursive: true });
  }
  const modules = path.join(appFull, "node_modules");
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(dst, "node_modules"));
  return { dir, app: dst };
}

const ws = makeWorkspace();
process.on("exit", () => { try { fs.rmSync(ws.dir, { recursive: true, force: true }); } catch {} });

// The suite must pass unmutated, or a mutant "killing" it proves nothing.
try {
  execSync(TEST, { cwd: ws.app, stdio: "pipe" });
} catch {
  console.error("The suite fails before any mutation. Nothing here can be trusted.");
  process.exit(2);
}

let survived = 0;
for (const m of applicable) {
  const target = path.join(ws.dir, m.file);
  let original;
  try { original = fs.readFileSync(target, "utf8"); } catch {
    console.error(`  MISS  ${m.name}: ${m.file} is gone — the mutant cannot be applied`);
    process.exit(2);
  }
  // A mutant that no longer matches tests nothing, and would report as killed
  // the moment the code it aims at is renamed. Exit 2, not 0.
  if (!original.includes(m.find)) {
    console.error(`  MISS  ${m.name}: the text it mutates is gone from ${m.file}`);
    console.error(`        looked for: ${m.find.trim()}`);
    process.exit(2);
  }

  let output = "", threw = false;
  try {
    fs.writeFileSync(target, original.replace(m.find, m.replace));
    try {
      output = execSync(TEST, {
        cwd: ws.app, stdio: "pipe", encoding: "utf8",
        // A mutant can hang the suite rather than fail it. Without a bound that
        // stalls every caller of this.
        timeout: 180_000,
      });
    } catch (e) {
      threw = true;
      output = `${e.stdout || ""}${e.stderr || ""}`;
    }
  } finally {
    fs.writeFileSync(target, original);
  }

  // Strip ANSI first. Runners colour their summary when they think a terminal
  // is watching, which they do in CI and do not through execSync -- so matching
  // raw output killed every mutant locally and reported the first as BROKEN in
  // CI. A verdict that depends on where it runs is not a verdict.
  const plain = output.replace(/\[[0-9;]*m/g, "");

  // A non-zero exit is not a kill. A mutant that only breaks the parser, or
  // hangs, makes the run fail without any test having asserted on the behaviour
  // the mutant claims to test -- and would report as a confident kill.
  if (threw && FAILED_RE.test(plain)) {
    console.log(`  killed   ${m.name}`);
  } else if (threw) {
    console.error(`  BROKEN   ${m.name}: the run failed without the suite`);
    console.error("           reporting a failed test, so nothing asserted on");
    console.error("           its claim. Its output follows.");
    const tail = plain.trim().split("\n").slice(-25);
    for (const line of tail) console.error(`           | ${line}`);
    if (tail.length === 0) console.error("           | (no output at all)");
    process.exit(2);
  } else {
    console.log(`  SURVIVED ${m.name} — ${m.claim}`);
    survived += 1;
  }
}

console.log("");
console.log(`${applicable.length} mutants, ${applicable.length - survived} killed, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
