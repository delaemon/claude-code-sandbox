// The shell. The only file in this application allowed to read a clock,
// generate randomness or touch the DOM.
//
// scripts/clock-boundary.mjs enforces the first two, by name, across app/src.
// Everything that decides anything lives in pure/ and is a function of its
// arguments, which is why the suite runs with no browser, no fake timers and
// nothing flaky.
//
// The order things happen in matters and is easy to get wrong later:
//   - mines are placed on the FIRST CLICK, not at start, so the opening move
//     can be guaranteed safe. Before that click there is a board of zeroes.
//   - the timer starts on that same first click and stops the moment the game
//     ends, so a finished board does not keep counting.

import { indexOf } from "./pure/board";
import { newGame, remainingAgainst, reveal, toggleFlag } from "./pure/game";
import { mulberry32, parseSeed, pickMines } from "./pure/rng";
import { cellFace, formatElapsed, statusText } from "./pure/view";
import type { Game } from "./pure/types";
import "./style.css";

interface Level {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly mines: number;
}

const LEVELS: readonly Level[] = [
  { name: "Beginner", width: 9, height: 9, mines: 10 },
  { name: "Intermediate", width: 16, height: 16, mines: 40 },
  { name: "Expert", width: 30, height: 16, mines: 99 },
];

const pinnedSeed = parseSeed(window.location.search);
let level: Level = LEVELS[0];
let game: Game = newGame(level.width, level.height, []);
let seed = 0;
let placed = false;
let startedAt: number | null = null;
let frozenElapsed = 0;
let ticker: number | null = null;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const boardEl = $<HTMLDivElement>("#board");
const statusEl = $<HTMLDivElement>("#status");
const minesEl = $<HTMLSpanElement>("#mines");
const timeEl = $<HTMLSpanElement>("#time");
const seedEl = $<HTMLSpanElement>("#seed");
const resetEl = $<HTMLButtonElement>("#reset");
const levelEl = $<HTMLSelectElement>("#level");

// ── the clock ───────────────────────────────────────────────────────────────
// Contained here so pure/ never sees one. formatElapsed takes a number.

function elapsedMs(): number {
  return startedAt === null ? frozenElapsed : Date.now() - startedAt;
}

function startClock(): void {
  if (ticker !== null) return;
  startedAt = Date.now() - frozenElapsed;
  ticker = window.setInterval(() => {
    timeEl.textContent = formatElapsed(elapsedMs());
  }, 250);
}

function stopClock(): void {
  if (ticker === null) return;
  frozenElapsed = elapsedMs();
  window.clearInterval(ticker);
  ticker = null;
  startedAt = null;
}

// ── new game ────────────────────────────────────────────────────────────────

function reset(): void {
  stopClock();
  frozenElapsed = 0;
  placed = false;
  // The seed is drawn once per game and shown, so a board worth complaining
  // about can be reproduced exactly. Everything downstream of it is a pure
  // function, which is the only reason that claim is true.
  // A seed in the query string pins every board in this page load, so a link
  // reproduces exactly what the person sending it saw -- and so the browser
  // gate gets the same board every run instead of whatever chance deals it.
  seed = pinnedSeed ?? Math.floor(Math.random() * 0xffffffff);
  game = newGame(level.width, level.height, []);
  render();
}

/**
 * Lay the mines, keeping the first click and its neighbours clear, then apply
 * that click to the board that results.
 */
function firstClick(x: number, y: number): void {
  const safe = indexOf(game.board, x, y);
  const mines = pickMines(game.board, level.mines, mulberry32(seed), safe);
  game = newGame(level.width, level.height, mines);
  placed = true;
  startClock();
}

// ── rendering ───────────────────────────────────────────────────────────────

function render(): void {
  boardEl.style.setProperty("--cols", String(game.board.width));
  boardEl.replaceChildren();

  for (let y = 0; y < game.board.height; y++) {
    for (let x = 0; x < game.board.width; x++) {
      const cell = game.board.cells[indexOf(game.board, x, y)];
      const face = cellFace(cell, game.status);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cell ${face.kind}`;
      button.textContent = face.text;
      button.dataset.x = String(x);
      button.dataset.y = String(y);
      button.setAttribute(
        "aria-label",
        `row ${y + 1} column ${x + 1}: ${face.text || cell.state}`,
      );
      boardEl.append(button);
    }
  }

  statusEl.textContent = statusText(game);
  statusEl.dataset.state = game.status;
  // Against the level, not against the board: mines are laid on the first
  // click, so the board holds none until then and this read 0 on a fresh
  // 10-mine game.
  minesEl.textContent = String(remainingAgainst(level.mines, game));
  timeEl.textContent = formatElapsed(elapsedMs());
  seedEl.textContent = placed ? String(seed) : "—";
  resetEl.textContent = game.status === "playing" ? "Restart" : "New game";
}

// ── input ───────────────────────────────────────────────────────────────────

function coordsOf(target: EventTarget | null): [number, number] | null {
  if (!(target instanceof HTMLElement)) return null;
  const cell = target.closest<HTMLElement>(".cell");
  if (!cell || cell.dataset.x === undefined || cell.dataset.y === undefined) return null;
  return [Number(cell.dataset.x), Number(cell.dataset.y)];
}

function onReveal(x: number, y: number): void {
  if (game.status !== "playing") return;
  if (!placed) firstClick(x, y);
  game = reveal(game, x, y);
  if (game.status !== "playing") stopClock();
  render();
}

boardEl.addEventListener("click", (event) => {
  const at = coordsOf(event.target);
  if (at) onReveal(at[0], at[1]);
});

boardEl.addEventListener("contextmenu", (event) => {
  const at = coordsOf(event.target);
  if (!at) return;
  event.preventDefault();
  // Flagging before the mines exist would be meaningless, and would also let a
  // player flag a cell the placer is about to have to keep clear.
  if (!placed) return;
  game = toggleFlag(game, at[0], at[1]);
  render();
});

resetEl.addEventListener("click", reset);

levelEl.addEventListener("change", () => {
  const chosen = LEVELS.find((l) => l.name === levelEl.value);
  if (chosen) level = chosen;
  reset();
});

for (const l of LEVELS) {
  const option = document.createElement("option");
  option.value = l.name;
  option.textContent = `${l.name} — ${l.width}×${l.height}, ${l.mines} mines`;
  levelEl.append(option);
}
levelEl.value = level.name;

reset();
