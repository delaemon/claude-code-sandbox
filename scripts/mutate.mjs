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
    name: "board-transposed",
    claim: "the geometry tests notice x and y swapped in cellRect",
    file: "puyopuyo/src/render/geometry.ts",
    find: "    x: layout.board.x + x * layout.cell,",
    replace: "    x: layout.board.x + y * layout.cell,",
  },
  {
    name: "hidden-row-ignored",
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
];

const only = process.argv.includes("--only")
  ? process.argv[process.argv.indexOf("--only") + 1] : null;

const repo = path.resolve(path.dirname(process.argv[1]), "..");
const applicable = MUTANTS.filter((m) => !only || m.name.includes(only));

if (applicable.length === 0) {
  console.error("No mutants selected — refusing to report that as all killed.");
  process.exit(2);
}

// The suite must pass unmutated, or a mutant "killing" it proves nothing.
try {
  execSync("npm test --silent", { cwd: path.join(repo, "puyopuyo"), stdio: "pipe" });
} catch {
  console.error("The suite fails before any mutation. Nothing here can be trusted.");
  process.exit(2);
}

let survived = 0;
for (const m of applicable) {
  const target = path.join(repo, m.file);
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

  fs.writeFileSync(target, mutated);
  let killed = false;
  try {
    execSync("npm test --silent", { cwd: path.join(repo, "puyopuyo"), stdio: "pipe" });
  } catch { killed = true; }
  fs.writeFileSync(target, original);

  if (killed) {
    console.log(`  killed   ${m.name}`);
  } else {
    console.log(`  SURVIVED ${m.name} — ${m.claim}`);
    survived += 1;
  }
}

console.log("");
console.log(`${applicable.length} mutants, ${applicable.length - survived} killed, ${survived} survived`);
process.exit(survived === 0 ? 0 : 1);
