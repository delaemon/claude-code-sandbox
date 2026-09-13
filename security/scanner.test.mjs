import { test } from "node:test";
import assert from "node:assert/strict";
import { disassemble, resolveGlobals, scanPickle } from "./scanner.mjs";
import { campaign } from "./adversary.mjs";

const byId = Object.fromEntries(campaign().map((a) => [a.id, a]));

test("disassemble walks a proto-0 GLOBAL+REDUCE without executing it", () => {
  const { ops } = disassemble(byId["v1-classic-pickle"].weights);
  const names = ops.map((o) => o.name);
  assert.ok(names.includes("GLOBAL"));
  assert.ok(names.includes("REDUCE"));
  assert.equal(names.at(-1), "STOP");
});

test("resolveGlobals resolves STACK_GLOBAL from the pushed strings", () => {
  const { ops } = disassemble(byId["v2-stack-global"].weights);
  const g = resolveGlobals(ops);
  assert.deepEqual(g.map((x) => `${x.module}.${x.name}`), ["os.system"]);
});

test("classic os.system pickle is critical", () => {
  assert.equal(scanPickle(byId["v1-classic-pickle"].weights).verdict, "critical");
});

// The biting cases: a scanner that only sees the classic form would miss
// these. If either drops below critical, the container is no longer stronger
// than the naive scanner and the whole demo collapses.
test("STACK_GLOBAL substring-evasion is still critical", () => {
  assert.equal(scanPickle(byId["v2-stack-global"].weights).verdict, "critical");
});

test("getattr(__import__) blocklist-evasion is still critical", () => {
  const r = scanPickle(byId["v4-composed-getattr"].weights);
  assert.equal(r.verdict, "critical");
  const mods = r.globals.map((g) => `${g.module}.${g.name}`);
  assert.ok(mods.includes("builtins.getattr"));
  assert.ok(mods.includes("builtins.__import__"));
});

test("builtins.eval is critical", () => {
  assert.equal(scanPickle(byId["v3-builtins-eval"].weights).verdict, "critical");
});

test("a benign empty-dict checkpoint is clean (no false positive)", () => {
  assert.equal(scanPickle(byId["b1-benign"].weights).verdict, "clean");
});

test("a dangerous global loaded but never invoked is only suspicious", () => {
  // GLOBAL os.system with no REDUCE/BUILD/etc.
  const bytes = Buffer.from("cos\nsystem\n.", "latin1");
  assert.equal(scanPickle(bytes).verdict, "suspicious");
});

test("an unknown opcode is not silently skipped", () => {
  const bytes = Buffer.from([0xff, 0x2e]); // undefined opcode then STOP
  const r = scanPickle(bytes);
  assert.ok(r.findings.some((f) => f.kind === "opcode-truncated"));
});
