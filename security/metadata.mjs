// security/metadata.mjs
//
// The two non-pickle surfaces of the same attack class the Black Hat / Hugging
// Face line of work covers: text smuggled through a model card (prompt
// injection aimed at whatever agent later reads the card), and a manifest that
// squats a trusted name (typo/owner confusion in a model hub). Neither is code
// execution on load, so the pickle scanner cannot see them; the container
// checks all three surfaces so "contained" means the whole artifact, not just
// its weights.

const INJECTION_PATTERNS = [
  { re: /ignore\s+(all\s+)?(the\s+)?previous\s+(instructions|context|prompt)/i, detail: "override of prior instructions" },
  { re: /disregard\s+(your\s+)?(earlier\s+)?(instructions|rules|system)/i, detail: "instruction disregard" },
  { re: /you\s+are\s+now\s+(a|an|in)\b/i, detail: "role reassignment" },
  { re: /system\s*prompt/i, detail: "system-prompt reference" },
  { re: /reveal|exfiltrate|leak\s+(the\s+)?(secret|token|key|credential)/i, detail: "secret exfiltration ask" },
  { re: /curl\s+[^\n]*\|\s*(sh|bash)/i, detail: "pipe-to-shell command" },
  { re: /base64\s+-d|eval\s*\(|os\.system|subprocess/i, detail: "embedded execution snippet" },
  { re: /when\s+you\s+(read|load|see)\s+this[,\s]/i, detail: "trigger-on-load instruction" },
];

export function scanText(card) {
  const text = String(card ?? "");
  const findings = [];
  for (const p of INJECTION_PATTERNS) {
    const m = text.match(p.re);
    if (m) findings.push({ kind: "prompt-injection", detail: p.detail, match: m[0].slice(0, 60) });
  }
  const verdict = findings.length ? "critical" : "clean";
  return { verdict, findings };
}

// A trusted repo name -> its legitimate owner. Real hubs carry a signed
// verification set; this stands in for one.
const KNOWN = {
  whisper: "openai",
  "clip-vit-base-patch32": "openai",
  "bert-base-uncased": "google",
  "llama-3": "meta-llama",
  "stable-diffusion-v1-5": "runwayml",
  "sentence-transformers": "sentence-transformers",
};

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

export function scanManifest(manifest) {
  const m = manifest ?? {};
  const repo = String(m.declaredRepo ?? "");
  const owner = String(m.declaredOwner ?? "");
  const findings = [];

  if (repo in KNOWN) {
    const expected = KNOWN[repo];
    if (owner !== expected) {
      const near = lev(owner.toLowerCase(), expected.toLowerCase()) <= 2;
      findings.push({
        kind: "namespace-squat",
        detail: `repo "${repo}" is owned by "${expected}", claimed by "${owner}"${near ? " (near-homoglyph of the real owner)" : ""}`,
      });
    }
  }
  if (!m.signedBy) {
    findings.push({ kind: "unsigned", detail: "artifact carries no publisher signature" });
  }

  let verdict = "clean";
  if (findings.some((f) => f.kind === "namespace-squat")) verdict = "critical";
  else if (findings.length) verdict = "suspicious";
  return { verdict, findings };
}
