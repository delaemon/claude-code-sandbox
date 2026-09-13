// Drive the built application in a browser and assert what a player sees.
//
// The unit suite covers pure/ completely and cannot reach main.ts, which is by
// design: the clock boundary pushes everything untestable into one file. The
// consequence is that all the remaining risk is concentrated there, and nothing
// was looking at it. The first thing a browser found was a fresh 10-mine game
// reporting `0` mines remaining -- the readout was taken from a board whose
// mines are not laid until the first click. Fifty-two green tests had nothing
// to say about it.
//
// So this is the gate for the shell. It is deliberately a handful of
// user-visible facts, not a second test suite: anything that can be asserted
// about a pure function belongs in tests/ where it runs in milliseconds.
//
// Exit 0 when every check passes, 1 when one fails, 3 when it cannot run --
// no browser driver available is a did-not-run, never a pass.

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(APP, "dist");

// ── the browser driver, or exit 3 ───────────────────────────────────────────
// Resolved rather than imported, so a machine without it says so instead of
// crashing with a module-not-found that reads like a broken repository.
async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch {}
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    const entry = path.join(root, "playwright", "index.mjs");
    if (fs.existsSync(entry)) return (await import(entry)).chromium;
  } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.error("No playwright available, so the application was not driven.");
  console.error("Reporting did-not-run rather than a pass: the shell is the");
  console.error("part the unit suite cannot reach, and an unchecked shell that");
  console.error("prints ok is worse than one that says it was not checked.");
  process.exit(3);
}

// ── a built copy to serve ───────────────────────────────────────────────────
// Always built, never reused.
//
// This first only built when dist/ was missing, and the gate promptly reported
// a failure that had already been fixed: it was serving a bundle compiled from
// the broken source, minutes after the source was restored. A check that
// passes or fails on an artifact older than the change under test is not
// checking the change at all -- and the direction it errs in is the dangerous
// one, because a stale *green* build reads as a passing gate.
fs.rmSync(DIST, { recursive: true, force: true });
execFileSync("npm", ["run", "build"], { cwd: APP, stdio: "inherit" });
if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("The build produced no dist/index.html. Nothing to drive.");
  process.exit(2);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
  const file = path.join(DIST, rel);
  // Nothing outside dist/, even from a request this test wrote itself.
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(file));
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// ── checks ──────────────────────────────────────────────────────────────────
let failed = 0;
const ok = (what) => console.log(`  ok    ${what}`);
const bad = (what, detail) => {
  console.error(`  FAIL  ${what}`);
  if (detail) console.error(`        ${detail}`);
  failed++;
};
const is = (what, got, want) =>
  String(got) === String(want) ? ok(what) : bad(what, `expected ${want}, got ${got}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 520, height: 820 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));

  // The seed is pinned, so every run drives the identical board. Without it
  // this gate right-clicked a cell by index and failed at random whenever the
  // opening flood fill had already opened that one -- a red gate on correct
  // code, which is the fastest way to teach people to ignore a gate.
  const SEED = 20260913;
  await page.goto(`${origin}/?seed=${SEED}`, { waitUntil: "networkidle" });

  const cells = page.locator(".cell");
  is("the default board renders 9x9 cells", await cells.count(), 81);

  // The bug this file was written for. A fresh game's board holds no mines --
  // they are laid on the first click -- so a readout taken from the board says
  // zero, on a game that has ten.
  is("a fresh game reports its mines before any are laid", await page.locator("#mines").textContent(), "10");
  is("no seed is shown before the first click", await page.locator("#seed").textContent(), "—");
  is("the clock starts at zero", await page.locator("#time").textContent(), "0:00");

  // First click safety: mines are placed around it, so this can never lose.
  // Run over several fresh games, because one click landing safely is what
  // would happen most of the time even with the guarantee removed.
  // Every cell in turn, on a fresh game each time: the guarantee is that *any*
  // opening click is safe, and clicking one cell twelve times would not show
  // that. A pinned seed makes this exhaustive rather than lucky.
  let everLost = 0;
  let everSingleCell = 0;
  const openings = await cells.count();
  for (let i = 0; i < openings; i++) {
    await page.locator("#reset").click();
    await cells.nth(i).click();
    if ((await page.locator("#status").textContent()) !== "Playing") everLost++;
    if ((await page.locator(".cell.open").count()) < 2) everSingleCell++;
  }
  is(`all ${openings} possible opening clicks, none of them fatal`, everLost, 0);
  is("every opening click opened a region, not one cell", everSingleCell, 0);

  // The seed shown must be the seed asked for. This is what makes every
  // assertion above a statement about a known board rather than about luck,
  // so it is asserted rather than assumed.
  is("the board honours the pinned seed", await page.locator("#seed").textContent(), String(SEED));

  // Right-click flags, and the readout follows. The target is chosen by state,
  // not by index: a cell the opening already opened cannot be flagged, and
  // asking for one that happened to be open is how this check first failed.
  const stillHidden = page.locator(".cell.hidden").first();
  await stillHidden.click({ button: "right" });
  is("right-click draws a flag", await page.locator(".cell.flagged").count(), 1);
  is("flagging decrements the readout", await page.locator("#mines").textContent(), "9");
  await page.locator(".cell.flagged").first().click({ button: "right" });
  is("right-clicking again takes the flag off", await page.locator("#mines").textContent(), "10");
  is("unflagging leaves no flag behind", await page.locator(".cell.flagged").count(), 0);

  // The clock runs, and stops when the game does. Nothing in pure/ can check
  // this: the only clock in the application is in main.ts.
  const before = await page.locator("#time").textContent();
  await page.waitForTimeout(1400);
  const after = await page.locator("#time").textContent();
  before !== after
    ? ok(`the clock advances (${before} to ${after})`)
    : bad("the clock advances", `stuck at ${before}`);

  // Losing must stop it. Step on a mine by opening every cell until it ends.
  const total = await cells.count();
  for (let i = 0; i < total; i++) {
    if ((await page.locator("#status").textContent()) !== "Playing") break;
    await cells.nth(i).click();
  }
  const ended = await page.locator("#status").textContent();
  ended !== "Playing"
    ? ok(`the game ends when every cell is clicked (${ended})`)
    : bad("the game ends when every cell is clicked", "still playing after clicking all 81");

  const stoppedAt = await page.locator("#time").textContent();
  await page.waitForTimeout(1400);
  is("the clock stops when the game does", await page.locator("#time").textContent(), stoppedAt);

  // Changing difficulty starts a new game at the new size.
  await page.selectOption("#level", "Expert");
  is("switching to Expert lays out 30x16", await cells.count(), 480);
  is("switching resets the mine readout", await page.locator("#mines").textContent(), "99");
  is("switching resets the status", await page.locator("#status").textContent(), "Playing");

  problems.length === 0
    ? ok("no page errors")
    : bad("no page errors", problems.join(" | "));

  if (process.env.SMOKE_SHOT) {
    await page.screenshot({ path: process.env.SMOKE_SHOT, fullPage: true });
    console.log(`  shot  ${process.env.SMOKE_SHOT}`);
  }
} finally {
  await browser.close();
  server.close();
}

console.log("");
if (failed === 0) {
  console.log("smoke: the shell behaves");
  process.exit(0);
}
console.error(`smoke: ${failed} check(s) failed in the browser`);
process.exit(1);
