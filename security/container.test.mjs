import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect, quarantine, contain } from "./container.mjs";
import { campaign } from "./adversary.mjs";

test("every malicious vector is contained and the benign one is not", () => {
  const { reports, summary } = contain(campaign());
  const malicious = campaign().filter((a) => a.malicious).length;
  assert.equal(summary.contained, malicious);
  assert.equal(summary.passed, campaign().length - malicious);
  for (const r of reports) {
    const expected = campaign().find((a) => a.id === r.id).malicious;
    assert.equal(r.contained, expected, `${r.id} containment`);
  }
});

test("quarantine withholds the loadable payload", () => {
  const bad = campaign().find((a) => a.id === "v1-classic-pickle");
  const q = quarantine(bad, inspect(bad));
  assert.equal(q.quarantined, true);
  assert.equal(q.weights, null);
  assert.ok(q.findings.length >= 1);
});

test("a clean artifact passes through quarantine untouched", () => {
  const good = campaign().find((a) => a.id === "b1-benign");
  const q = quarantine(good, inspect(good));
  assert.equal(q, good);
});
