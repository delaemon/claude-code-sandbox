import { test } from "node:test";
import assert from "node:assert/strict";
import { runArena } from "./arena.mjs";

test("the container beats the adversary the naive scanner loses to", () => {
  const r = runArena();
  assert.equal(r.escapes, 0, "a malicious vector escaped the container");
  assert.equal(r.falsePositives, 0, "the container flagged a benign artifact");
  assert.ok(r.naiveMisses > 0, "the naive scanner was supposed to be evaded");
});
