import { describe, expect, it } from "vitest";
import { cellFace, formatElapsed, statusText } from "../src/pure/view";
import { newGame, reveal, toggleFlag } from "../src/pure/game";
import type { Cell } from "../src/pure/types";

const cell = (over: Partial<Cell> = {}): Cell => ({
  mine: false,
  adjacent: 0,
  state: "hidden",
  ...over,
});

describe("cellFace while the game is on", () => {
  it("shows nothing for a hidden cell, mine or not", () => {
    expect(cellFace(cell(), "playing")).toEqual({ text: "", kind: "hidden" });
    expect(cellFace(cell({ mine: true }), "playing")).toEqual({ text: "", kind: "hidden" });
  });

  it("shows a flag, and keeps a mine under it hidden", () => {
    // The whole point of a flag: it must not leak what is underneath.
    const overFlag = cellFace(cell({ state: "flagged" }), "playing");
    const overMine = cellFace(cell({ state: "flagged", mine: true }), "playing");
    expect(overFlag.text).toBe("⚑");
    expect(overFlag).toEqual(overMine);
  });

  it("shows the adjacent count on an opened cell, tagged by number", () => {
    expect(cellFace(cell({ state: "revealed", adjacent: 3 }), "playing"))
      .toEqual({ text: "3", kind: "open n3" });
    expect(cellFace(cell({ state: "revealed", adjacent: 8 }), "playing"))
      .toEqual({ text: "8", kind: "open n8" });
  });

  it("shows an opened empty cell as blank, with no number class", () => {
    const face = cellFace(cell({ state: "revealed", adjacent: 0 }), "playing");
    expect(face.text).toBe("");
    expect(face.kind).toBe("open");
    expect(face.kind).not.toMatch(/n\d/);
  });
});

describe("cellFace once the game is over", () => {
  it("opens up mines the player never found", () => {
    expect(cellFace(cell({ mine: true }), "lost")).toEqual({ text: "✹", kind: "mine" });
  });

  it("marks the mine that was stepped on differently from the rest", () => {
    const stepped = cellFace(cell({ mine: true, state: "revealed" }), "lost");
    const untouched = cellFace(cell({ mine: true }), "lost");
    expect(stepped.kind).toContain("blown");
    expect(stepped.kind).not.toBe(untouched.kind);
  });

  it("marks a flag that was wrong, and leaves a correct one as a flag", () => {
    expect(cellFace(cell({ state: "flagged", mine: true }), "won").kind).toBe("flagged");
    expect(cellFace(cell({ state: "flagged", mine: false }), "lost"))
      .toEqual({ text: "✗", kind: "flagged wrong" });
  });

  it("leaves an unopened cell with no mine hidden", () => {
    expect(cellFace(cell(), "lost")).toEqual({ text: "", kind: "hidden" });
  });
});

describe("statusText", () => {
  it("follows the game", () => {
    const g = newGame(3, 3, [4]);
    expect(statusText(g)).toBe("Playing");
    expect(statusText(reveal(g, 1, 1))).toBe("Boom");
    expect(statusText(reveal(toggleFlag(newGame(1, 2, [0]), 0, 0), 0, 1))).toBe("Cleared");
  });
});

describe("formatElapsed", () => {
  it("counts seconds and minutes", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1_000)).toBe("0:01");
    expect(formatElapsed(59_000)).toBe("0:59");
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(3_601_000)).toBe("60:01");
  });

  it("rounds down, so the clock never shows a second that has not finished", () => {
    expect(formatElapsed(1_999)).toBe("0:01");
    expect(formatElapsed(999)).toBe("0:00");
  });

  it("clamps a clock that went backwards instead of printing a negative", () => {
    // A laptop waking from sleep really does this.
    expect(formatElapsed(-5_000)).toBe("0:00");
    expect(formatElapsed(Number.NaN)).toBe("0:00");
  });
});
