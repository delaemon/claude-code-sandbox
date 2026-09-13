// Run the application's own smoke check, whatever it is.
//
// The clock boundary makes the core testable by pushing everything untestable
// into one file. The bill for that is concentration: all the remaining risk now
// sits in the shell, and unit tests cannot reach it by construction. The first
// browser ever pointed at this repository's application found a fresh ten-mine
// game reporting zero mines remaining, past fifty-two green tests.
//
// So there is a gate for the shell. The harness does not know how to drive a
// browser, and should not -- `app.smoke` is a command, exactly like `app.test`,
// and the application owns what it asserts. This file only runs it and keeps
// the exit codes honest.
//
// Exit 0 pass, 1 fail, 2 could not run, 3 not configured. **Exit 3 passes
// through from the command**: a smoke check that cannot find a browser driver
// must report did-not-run, and flattening that to a failure would train people
// to ignore a red gate on every machine without one.
import { spawnSync } from "node:child_process";
import { requireApp } from "./config.mjs";

const { cfg, dir, full } = requireApp("the smoke check");

const command = cfg.app?.smoke;
if (!command) {
  console.error("harness.config.json sets no `app.smoke`.");
  console.error("The unit suite cannot reach the shell -- the file that holds");
  console.error("the clock, the randomness and the DOM. Nothing is checking it.");
  console.error("Reporting did-not-run rather than a pass.");
  process.exit(3);
}

const run = spawnSync(command, {
  cwd: full,
  shell: true,
  stdio: "inherit",
  // A browser that hangs must not hang every caller of this, including CI.
  timeout: 10 * 60_000,
});

if (run.error) {
  console.error(`Could not run \`${command}\` in ${dir}: ${run.error.message}`);
  process.exit(2);
}
if (run.signal) {
  console.error(`\`${command}\` was killed by ${run.signal} — most likely the timeout.`);
  console.error("Reporting that as could-not-run, not as a pass.");
  process.exit(2);
}
process.exit(run.status ?? 2);
