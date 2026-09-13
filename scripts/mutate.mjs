// Mutation testing: change the code, require the suite to notice.
//
// A passing suite proves the tests ran, not that they would catch anything.
// This repository has shipped tests that passed against a renderer ignoring its
// palette entirely, and the attempt to prove they bit did it by permuting the
// palette -- which passes, correctly, because the expectations are written
// against that same palette. The palette is a design choice, not a correctness
// property. What must fail is the renderer no longer using it per colour.
//
// So the mutants below damage behaviour, never data. Each names the claim it
// puts to the test, and a mutant the suite survives is the finding.
//
// Usage:  node scripts/mutate.mjs [--only <substring>]
// Exit 0 when every mutant is killed, 1 when one survives, 2 when it could not
// run at all -- which must not read as every mutant dying.
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MUTANTS = [
  {
    name: "renderer-ignores-colour",
    claim: "the render tests notice a renderer that paints every puyo one colour",
    file: "puyopuyo/src/render/draw.ts",
    find: "const style = styleFor(color);",
    replace: "const style = styleFor('red');",
  },
  {
    name: "cellrect-transposed",
    claim: "the geometry tests notice x and y swapped in the pixel mapping",
    file: "puyopuyo/src/render/geometry.ts",
    find: "    x: layout.board.x + x * layout.cell,",
    replace: "    x: layout.board.x + y * layout.cell,",
  },
  {
    name: "hidden-row-offset-dropped",
    claim: "the geometry tests notice the hidden-row offset being dropped",
    file: "puyopuyo/src/render/geometry.ts",
    find: "    y: layout.board.y + (y - layout.hiddenRows) * layout.cell,",
    replace: "    y: layout.board.y + y * layout.cell,",
  },
  {
    name: "chain-power-constant",
    claim: "the score tests notice a chain multiplier that never grows",
    file: "puyopuyo/src/score/tables.ts",
    find: "export function chainPower(chain: number): number {",
    replace: "export function chainPower(chain: number): number {\n  return 0;",
  },
  // --- the layers the first four never reached, and the two conventions
  // CLAUDE.md singles out as failing quietly.
  {
    name: "hidden-row-pops",
    claim: "the chain rules notice row 0 becoming poppable",
    file: "puyopuyo/src/core/resolve.ts",
    find: "  if (hiddenRows <= 0) return board;",
    replace: "  return board;",
  },
  {
    name: "gravity-does-not-fall",
    claim: "the gravity tests notice cells no longer settling",
    file: "puyopuyo/src/core/gravity.ts",
    find: "        next[write]![x] = cell;",
    replace: "        next[y]![x] = cell;",
  },
  {
    // Not DAS: setting the delay to 1e9 made the suite hang rather than fail,
    // which the run below reports as BROKEN rather than killed -- correctly, but
    // it is a mutant that tests nothing and costs a timeout. The key map fails
    // fast instead.
    name: "arrow-keys-swapped",
    claim: "the keyboard tests notice left and right exchanged",
    file: "puyopuyo/src/input/keyboard.ts",
    find: "  ArrowLeft: 'moveLeft',",
    replace: "  ArrowLeft: 'moveRight',",
  },
];

// `--only` with nothing after it, or an empty string, used to select every
// mutant: `!only` was true and the filter kept them all, so a caller who
// believed the run was narrow got a green for the whole suite.
let only = null;
if (process.argv.includes("--only")) {
  only = process.argv[process.argv.indexOf("--only") + 1];
  if (!only) {
    console.error("--only needs a value. Refusing to silently select everything.");
    process.exit(2);
  }
}

const repo = path.resolve(path.dirname(process.argv[1]), "..");

/**
 * Mutations run in a copy, never in the working tree.
 *
 * The first version wrote each mutant into puyopuyo/src and restored it after.
 * A `finally` covered an interrupt, but not the window itself: while a mutant
 * is applied the working tree holds deliberately broken code, and this session
 * commits on a Stop hook that fires every turn. The two overlapped -- a commit
 * was very nearly made with `ArrowLeft: 'moveRight'` staged. A check that can
 * ship the damage it creates is worse than no check.
 *
 * node_modules is 52 MB and identical, so it is symlinked rather than copied.
 */
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-"));
  const src = path.join(repo, "puyopuyo");
  const dst = path.join(dir, "puyopuyo");
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of ["src", "tests", "package.json", "tsconfig.json",
                       "vitest.config.ts", "index.html"]) {
    const from = path.join(src, entry);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dst, entry), { recursive: true });
  }
  const modules = path.join(src, "node_modules");
  if (!fs.existsSync(modules)) {
    console.error("puyopuyo/node_modules is missing — cannot run the suite.");
    console.error("Refusing to report that as every mutant dying.");
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(2);
  }
  fs.symlinkSync(modules, path.join(dst, "node_modules"));
  return { dir, puyopuyo: dst };
}
const applicable = MUTANTS.filter((m) => !only || m.name.includes(only));

if (applicable.length === 0) {
  console.error("No mutants selected — refusing to report that as all killed.");
  process.exit(2);
}

const ws = makeWorkspace();
process.on("exit", () => { try { fs.rmSync(ws.dir, { recursive: true, force: true }); } catch {} });

// The suite must pass unmutated, or a mutant "killing" it proves nothing.
try {
  execSync("npm test --silent", { cwd: ws.puyopuyo, stdio: "pipe" });
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
  const mutated = original.replace(m.find, m.replace);
  if (mutated === original) {
    console.error(`  MISS  ${m.name}: the mutation changed nothing`);
    process.exit(2);
  }

  // Restore in `finally`: the mutant is written into the real working tree, and
  // an interrupt between writing and restoring would leave it there.
  let output = "", threw = false;
  try {
    fs.writeFileSync(target, mutated);
    try {
      output = execSync("npm test", {
        cwd: ws.puyopuyo, stdio: "pipe", encoding: "utf8",
        // A mutant can hang the suite rather than fail it -- setting a DAS
        // delay to 1e9 did. Without a bound that stalls every caller of this,
        // gates.sh included.
        timeout: 180_000,
      });
    } catch (e) {
      threw = true;
      output = `${e.stdout || ""}${e.stderr || ""}`;
    }
  } finally {
    // The copy is thrown away either way; restoring keeps each mutant
    // independent of the last.
    fs.writeFileSync(target, original);
  }

  // A non-zero exit is not a kill. A mutant that only breaks the parser, or
  // names an undefined identifier, makes the run fail without any test having
  // asserted on the behaviour the mutant claims to test -- and would report as
  // a confident kill. So the output has to show the suite running and reporting
  // failed tests.
  // Strip ANSI first. vitest colours its summary when it thinks a terminal is
  // watching, which it does in CI and does not here, so the raw text reads
  // `Tests \x1b[1m\x1b[31m2 failed` there and `Tests  2 failed` locally. Matching
  // the raw output passed every mutant on this machine and reported the first
  // one BROKEN in CI -- a check whose verdict depended on where it ran.
  const plain = output.replace(/\u001b\[[0-9;]*m/g, "");
  const reported = /Tests\s+\d+\s+failed/.test(plain);
  const ran = /Test Files\s+\d+/.test(plain);
  if (threw && reported) {
    console.log(`  killed   ${m.name}`);
  } else if (threw) {
    // Print what actually happened. The first version of this branch said only
    // "does not compile, or it hangs", and when it fired in CI -- where the
    // suite behaves differently from a local run -- that message named two
    // guesses and no evidence, which is most of a wasted cycle.
    console.error(`  BROKEN   ${m.name}: the run failed without the suite`);
    console.error(`           reporting a failed test, so nothing asserted on`);
    console.error(`           its claim. Its output follows.`);
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
