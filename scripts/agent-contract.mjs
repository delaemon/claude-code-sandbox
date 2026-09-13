// Does every engine actually read the same contract?
//
// `AGENTS.md` is the one file all three coding agents are supposed to read.
// That claim is worth exactly as much as its enforcement, and it fails in the
// quietest way available: each engine reaches the contract by a *different*
// mechanism, so breaking one of them leaves the other two working.
//
//   Claude Code   reads CLAUDE.md, which imports the contract with `@AGENTS.md`
//   Codex         reads a root file named AGENTS.md, natively
//   Gemini CLI    reads whatever `.gemini/settings.json` lists in context.fileName
//
// Delete the import line and Claude Code runs with no contract at all -- and
// Codex and Gemini stay green, so CI stays green, and a review sees one removed
// line in a markdown file. Rename the contract to `CONTRACT.md` and Claude Code
// and Gemini follow the rename correctly while Codex silently reads nothing.
// Neither produces an error anywhere. Both are a diff nobody would stop.
//
// So the wiring is asserted, per engine, by reading what that engine would read.
//
// It also refuses **duplication**, which is the other way one contract becomes
// three: an adapter that restates a section rather than importing it drifts
// from the original the first time only one of them is edited. A heading may
// appear in the contract or in an adapter, never in both.
//
// Exit 0 when every declared engine reaches the contract, 1 when one does not,
// 2 when it could not look, 3 when no engines are declared.
import fs from "node:fs";
import path from "node:path";
import { REPO, load } from "./config.mjs";

const cfg = load();
const engines = cfg.engines ?? {};
const declared = engines.supported ?? [];

if (declared.length === 0) {
  console.error("harness.config.json declares no `engines.supported`.");
  console.error("Nothing claims to read a shared contract, so there is nothing");
  console.error("to keep in step. Reporting did-not-run rather than a pass.");
  process.exit(3);
}

const CONTRACT = engines.contract ?? "AGENTS.md";
const contractPath = path.join(REPO, CONTRACT);

// ── the contract itself, before anything that points at it ──────────────────
// A positive first. Every wiring check below would pass just as happily
// against a contract file that is empty or missing, and would then be
// reporting that three engines agree about nothing.
let contractText;
try {
  contractText = fs.readFileSync(contractPath, "utf8");
} catch {
  console.error(`The contract file \`${CONTRACT}\` does not exist.`);
  console.error("Every engine below would be wired to nothing.");
  process.exit(1);
}
if (contractText.split("\n").filter((l) => l.trim()).length < 20) {
  console.error(`\`${CONTRACT}\` has almost nothing in it.`);
  console.error("Wiring three engines to an empty file is not a shared contract.");
  process.exit(1);
}

// ── how each engine reaches a contract ──────────────────────────────────────
//
// This is engine knowledge and belongs in code, not in config: a repository
// using this harness should not have to describe how Gemini CLI's settings
// file is shaped. What the repository declares is *which* engines it supports.
const ADAPTERS = {
  "claude-code": {
    reads: "CLAUDE.md",
    how: `an \`@${CONTRACT}\` import, or a symlink`,
    check() {
      const file = path.join(REPO, "CLAUDE.md");
      let stat;
      try {
        stat = fs.lstatSync(file);
      } catch {
        return `CLAUDE.md does not exist, and Claude Code reads no other file`;
      }
      if (stat.isSymbolicLink()) {
        const target = path.resolve(path.dirname(file), fs.readlinkSync(file));
        return target === contractPath
          ? null
          : `CLAUDE.md is a symlink to ${path.relative(REPO, target)}, not to ${CONTRACT}`;
      }
      // Code spans and fenced blocks are stripped: Claude Code's own import
      // parser skips them, so a `@AGENTS.md` shown as an example inside
      // backticks is not an import -- and counting it as one would report a
      // contract that is never actually loaded.
      const text = fs
        .readFileSync(file, "utf8")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/`[^`\n]*`/g, "");
      const imported = new RegExp(`(^|\\s)@${CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "m");
      return imported.test(text)
        ? null
        : `CLAUDE.md does not import ${CONTRACT}; Claude Code would read only CLAUDE.md`;
    },
  },

  codex: {
    reads: CONTRACT,
    how: "natively, by filename",
    check() {
      // Codex has no configuration to point elsewhere. The filename is the
      // whole interface, so a rename is the failure.
      return CONTRACT === "AGENTS.md"
        ? null
        : `Codex reads a root file named AGENTS.md and nothing else, but the contract here is \`${CONTRACT}\``;
    },
  },

  "gemini-cli": {
    reads: ".gemini/settings.json",
    how: "`context.fileName` listing the contract",
    check() {
      const file = path.join(REPO, ".gemini/settings.json");
      let settings;
      try {
        settings = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) {
        return fs.existsSync(file)
          ? `.gemini/settings.json is not valid JSON (${e.message}); Gemini CLI would fall back to GEMINI.md alone`
          : `.gemini/settings.json does not exist; Gemini CLI would read GEMINI.md alone`;
      }
      const names = settings.context?.fileName;
      const list = Array.isArray(names) ? names : names ? [names] : [];
      if (list.length === 0) {
        return `.gemini/settings.json sets no context.fileName; Gemini CLI would read GEMINI.md alone`;
      }
      return list.includes(CONTRACT)
        ? null
        : `.gemini/settings.json loads ${list.join(", ")} — ${CONTRACT} is not among them`;
    },
  },
};

// ── check each declared engine ──────────────────────────────────────────────
const problems = [];
let checked = 0;

for (const name of declared) {
  const adapter = ADAPTERS[name];
  if (!adapter) {
    // An engine this script does not know how to check is not an engine this
    // script may report as fine. Naming it in the config is a claim.
    problems.push(`\`${name}\` is declared but this check does not know how it reads a contract`);
    continue;
  }
  const problem = adapter.check();
  checked += 1;
  if (problem) {
    problems.push(`${name}: ${problem}`);
  } else {
    console.log(`  ok    ${name} reads ${CONTRACT} via ${adapter.reads} (${adapter.how})`);
  }
}

if (checked === 0) {
  console.error("No declared engine could be checked. Refusing to report agreement.");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(2);
}

// ── and that the contract was not copied instead of imported ────────────────
//
// An adapter that restates a section rather than pointing at it produces three
// contracts that agree today and disagree the first time one of them is
// edited. Headings are the cheap, reliable signal: a copied section brings its
// heading with it.
const headings = (text) =>
  text
    .replace(/```[\s\S]*?```/g, "")
    .split("\n")
    .filter((l) => /^#{1,6}\s+\S/.test(l))
    .map((l) => l.replace(/^#+\s+/, "").trim());

const contractHeadings = new Set(headings(contractText));
for (const file of ["CLAUDE.md", "GEMINI.md"]) {
  const full = path.join(REPO, file);
  if (!fs.existsSync(full)) continue;
  // A symlinked adapter *is* the contract; comparing it with itself would
  // report every heading as duplicated.
  if (fs.lstatSync(full).isSymbolicLink()) continue;
  const shared = headings(fs.readFileSync(full, "utf8")).filter((h) => contractHeadings.has(h));
  if (shared.length > 0) {
    problems.push(
      `${file} repeats ${shared.length} heading(s) from ${CONTRACT} (${shared.slice(0, 3).join(", ")}) — ` +
        "an adapter that restates the contract drifts from it",
    );
  }
}

if (problems.length > 0) {
  console.error("");
  console.error("These engines do not read the same contract:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error("Each engine reaches the contract by a different mechanism, so");
  console.error("breaking one leaves the others working and CI green. That is why");
  console.error("this is checked rather than assumed. See docs/ENGINES.md.");
  process.exit(1);
}

console.log("");
console.log(`${checked} engines, one contract: ${CONTRACT}`);
