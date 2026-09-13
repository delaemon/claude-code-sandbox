// security/container.mjs
//
// The strong side. It inspects all three surfaces of a model artifact --
// weights (pickle), card (text), manifest (provenance) -- reaches ONE verdict,
// and, when that verdict is not clean, quarantines the artifact so nothing
// downstream can load it. "Contain" here is concrete: a quarantined artifact's
// weights are withheld and replaced with the finding record.

import { scanPickle } from "./scanner.mjs";
import { scanText, scanManifest } from "./metadata.mjs";

const RANK = { clean: 0, suspicious: 1, critical: 2 };
const worst = (...vs) => vs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "clean");

/**
 * Inspect one artifact. Returns a report:
 *   { id, verdict, surfaces: {weights, card, manifest}, findings: [...],
 *     contained: boolean }
 * `contained` is true when a non-clean artifact has been withheld.
 */
export function inspect(artifact) {
  const weights = artifact.weights ? scanPickle(artifact.weights) : { verdict: "clean", findings: [] };
  const card = scanText(artifact.card);
  const manifest = scanManifest(artifact.manifest);

  const verdict = worst(weights.verdict, card.verdict, manifest.verdict);
  const findings = [
    ...weights.findings.map((f) => ({ surface: "weights", ...f })),
    ...card.findings.map((f) => ({ surface: "card", ...f })),
    ...manifest.findings.map((f) => ({ surface: "manifest", ...f })),
  ];

  return {
    id: artifact.id,
    vector: artifact.vector,
    verdict,
    contained: verdict !== "clean",
    surfaces: { weights: weights.verdict, card: card.verdict, manifest: manifest.verdict },
    findings,
  };
}

/**
 * Quarantine: strip the loadable payload from a non-clean artifact and hand
 * back a safe stub carrying the report. A caller that only ever loads the
 * returned object can never load a flagged artifact.
 */
export function quarantine(artifact, report) {
  if (!report.contained) return artifact;
  return {
    id: artifact.id,
    quarantined: true,
    verdict: report.verdict,
    findings: report.findings,
    weights: null,
    card: "[withheld: quarantined by container]",
  };
}

/** Inspect + quarantine an array of artifacts and summarise. */
export function contain(artifacts) {
  const reports = artifacts.map(inspect);
  const held = reports.filter((r) => r.contained).length;
  return {
    reports,
    quarantined: artifacts.map((a, i) => (reports[i].contained ? quarantine(a, reports[i]) : a)),
    summary: { total: reports.length, contained: held, passed: reports.length - held },
  };
}
