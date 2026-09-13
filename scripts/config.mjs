// The one place that knows what this harness is pointed at.
//
// Every project-specific fact -- where the application lives, how to test it,
// which mutants to apply -- comes from harness.config.json and nowhere else.
// A script that hardcodes a directory is a script the next project has to edit.
//
// `requireApp` is the important part. When no application is configured the
// gates that need one must report **exit 3, did not run**, never 0. An
// unconfigured check that prints ok is precisely the failure this repository
// exists to refuse, and a template shipping one would teach the opposite of its
// own lesson.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// $HARNESS_CONFIG points the whole harness at a different config. It exists so
// the checks can be tested against a fixture: with `app.dir` null a template
// ships nothing for evals/run.sh to break, and a check nobody can exercise is
// the shape of failure this repository is about. Resolved against the repo so a
// case cannot reach outside it.
const CONFIG = path.resolve(REPO, process.env.HARNESS_CONFIG || "harness.config.json");

/** The parsed config. Throws rather than guessing when it is missing or invalid. */
export function load() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG, "utf8");
  } catch {
    console.error(`No harness.config.json at ${CONFIG}.`);
    console.error("Refusing to run with defaults invented here: a check that");
    console.error("guesses its own target is not checking anything in particular.");
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`harness.config.json is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

/**
 * The application directory, or exit 3 when none is configured.
 *
 * Exit 3 is the harness's "did not run": gates.sh renders it as a note, CI
 * treats it as neither pass nor fail. That distinction is the whole point.
 */
export function requireApp(what) {
  const cfg = load();
  const dir = cfg.app?.dir;
  if (!dir) {
    console.error(`${what} needs an application, and harness.config.json has`);
    console.error('`app.dir` set to null. Point it at your source tree.');
    console.error("Reporting this as did-not-run rather than as a pass.");
    process.exit(3);
  }
  const full = path.join(REPO, dir);
  if (!fs.existsSync(full)) {
    console.error(`harness.config.json names app.dir "${dir}", which does not exist.`);
    console.error("A configured target that is not there is a broken setup, not a pass.");
    process.exit(2);
  }
  return { cfg, dir, full };
}

/**
 * `node scripts/config.mjs --github-output` prints the config as GitHub Actions
 * step outputs, so .github/workflows/ci.yml holds no project-specific fact
 * either. Without this the workflow is the one file every new project still has
 * to hand-edit, and the one nobody remembers to.
 *
 * Values are refused rather than escaped if they span lines: a multi-line value
 * written in `key=value` form silently truncates, and a truncated test command
 * is a test step that passes by running something shorter.
 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes("--github-output")) {
    console.error("usage: node scripts/config.mjs --github-output");
    process.exit(2);
  }
  const cfg = load();
  const dir = cfg.app?.dir ?? "";
  const out = {
    app_dir: dir,
    app_install: cfg.app?.install ?? "npm ci",
    app_typecheck: cfg.app?.typecheck ?? "npm run typecheck",
    app_test: cfg.app?.test ?? "npm test",
    // Empty when unset, so the CI step gates on it and reports did-not-run
    // rather than running an empty command and calling the result a pass.
    app_smoke: dir ? (cfg.app?.smoke ?? "") : "",
    // Both gates need an application, so neither can be "on" without one --
    // otherwise a config with a stale clockBoundary block runs a check against
    // a source tree that is not there.
    clock_boundary: dir && cfg.clockBoundary?.enabled ? "on" : "off",
    mutants: dir ? String((cfg.mutants ?? []).length) : "0",
  };
  for (const [k, v] of Object.entries(out)) {
    if (String(v).includes("\n")) {
      console.error(`harness.config.json: ${k} spans more than one line.`);
      console.error("Refusing to emit it: it would be silently truncated.");
      process.exit(2);
    }
    console.log(`${k}=${v}`);
  }
}
