import { describe, expect, it } from 'vitest';
import {
  HEIGHT,
  HIDDEN_ROWS,
  VISIBLE_HEIGHT,
  WIDTH,
  createBoard,
  parseBoardBottom,
  setCell,
  type Board,
} from '../../src/core/index.js';
import {
  MOVE_LEFT,
  HARD_DROP,
  activePiece,
  createGame,
  step,
  stepAll,
  tick,
  upcoming,
  type GameState,
} from '../../src/game/index.js';
import { cellRect, createLayout, draw, previewCellRect } from '../../src/render/index.js';
import { RecordingContext } from './fake-context.js';

/** Every pair is red/red: `colors[0]` is red, so fixtures can name the colour. */
const allRed = () => 0;

const CONFIG = { fallIntervalMs: 10_000, lockDelayMs: 0, chainStepMs: 300, spawnDelayMs: 0 };

const layout = createLayout({ cell: 20 });

const newGame = (board?: Board): GameState =>
  createGame({ rng: allRed, config: CONFIG, ...(board === undefined ? {} : { board }) });

/** A game with its first pair on the board. */
const started = (board?: Board): GameState => step(newGame(board), tick(0));

const render = (state: GameState, l = layout): RecordingContext => {
  const rec = new RecordingContext();
  draw(rec.ctx, state, l);
  return rec;
};

/** One `arc` per puyo, by construction — the glyphs are polylines. */
const puyos = (rec: RecordingContext): number => rec.count('arc');

const PREVIEW_PUYOS = layout.previewCount * 2;

describe('draw — what gets drawn at all', () => {
  it('draws the falling piece and the preview, and nothing else, on an empty board', () => {
    const rec = render(started());
    // The spawn child sits in the hidden row, so only the axis is on screen.
    expect(puyos(rec)).toBe(1 + PREVIEW_PUYOS);
  });

  it('never draws the hidden row into the playfield', () => {
    const empty = newGame();
    const withHidden = newGame(setCell(createBoard(), 0, 0, 'red'));
    expect(puyos(render(withHidden))).toBe(puyos(render(empty)));
  });

  it('draws 12 rows of a full board, not 13', () => {
    const full: Board = Array.from({ length: HEIGHT }, () =>
      Array.from({ length: WIDTH }, () => 'red' as const),
    );
    const rec = render(newGame(full)); // `spawning`: no piece yet.
    expect(puyos(rec)).toBe(VISIBLE_HEIGHT * WIDTH + PREVIEW_PUYOS);
    expect(puyos(rec)).not.toBe((VISIBLE_HEIGHT + HIDDEN_ROWS) * WIDTH + PREVIEW_PUYOS);
  });

  it('draws every settled puyo of a partial board', () => {
    const board = parseBoardBottom(
      `
      RG....
      RGB...
      RGBY..
      `,
      WIDTH,
      HEIGHT,
    );
    const rec = render(newGame(board));
    expect(puyos(rec)).toBe(9 + PREVIEW_PUYOS);
  });

  it('keeps every puyo inside the board rect or the preview rect', () => {
    const board = parseBoardBottom('RRRRRR\nGGGGGG', WIDTH, HEIGHT);
    const rec = render(started(board));
    const inside = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;
    for (const { x, y } of rec.arcCentres()) {
      const inBoard =
        inside(x, layout.board.x, layout.board.x + layout.board.w) &&
        inside(y, layout.board.y, layout.board.y + layout.board.h);
      const inNext =
        inside(x, layout.next.x, layout.next.x + layout.next.w) &&
        inside(y, layout.next.y, layout.next.y + layout.next.h);
      expect(inBoard || inNext).toBe(true);
    }
  });
});

describe('draw — where things are drawn', () => {
  it('puts the falling piece at its cell, and moves with it', () => {
    const before = started();
    const after = stepAll(before, [MOVE_LEFT, MOVE_LEFT]);
    const piece = activePiece(after);
    expect(piece).not.toBeNull();
    const rect = cellRect(layout, piece!.x, piece!.y);
    const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };

    const drawn = render(after).arcCentres();
    expect(drawn).toContainEqual({ ...centre, alpha: 1 });
    // ...and it is no longer drawn where it started.
    const start = cellRect(layout, 2, HIDDEN_ROWS);
    expect(drawn).not.toContainEqual({
      x: start.x + start.w / 2,
      y: start.y + start.h / 2,
      alpha: 1,
    });
  });

  it('draws a settled puyo at the cell it occupies, not one row off', () => {
    const board = setCell(createBoard(), 3, HEIGHT - 1, 'blue');
    const rect = cellRect(layout, 3, HEIGHT - 1);
    expect(rect.y + rect.h).toBe(layout.board.y + layout.board.h);
    expect(render(newGame(board)).arcCentres()).toContainEqual({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      alpha: 1,
    });
  });

  it('draws the preview pairs child-above-axis in their slots', () => {
    const state = started();
    const pairs = upcoming(state.queue, layout.previewCount);
    const centres = render(state).arcCentres();
    for (let slot = 0; slot < layout.previewCount; slot++) {
      expect(pairs[slot]).toBeDefined();
      for (const row of [0, 1]) {
        const r = previewCellRect(layout, slot, row);
        expect(centres).toContainEqual({ x: r.x + r.w / 2, y: r.y + r.h / 2, alpha: 1 });
      }
    }
  });

  it('scales with the layout: same state, bigger cells, bigger coordinates', () => {
    const state = started();
    const small = render(state, createLayout({ cell: 10 })).arcCentres();
    const big = render(state, createLayout({ cell: 40 })).arcCentres();
    expect(small.length).toBe(big.length);
    expect(big[0]!.x).toBeGreaterThan(small[0]!.x);
  });

  it('draws no preview puyos when the layout has no slots', () => {
    const rec = render(started(), createLayout({ cell: 20, previewCount: 0 }));
    expect(puyos(rec)).toBe(1);
  });
});

describe('draw — HUD and game over', () => {
  it('writes the score and the stat labels', () => {
    const texts = render(started()).texts();
    expect(texts).toContain('NEXT');
    expect(texts).toContain('LAST CHAIN');
    expect(texts).toContain('PIECES');
    expect(texts).toContain('CLEARED');
    expect(texts).toContain('BEST');
    expect(texts).toContain('0');
  });

  it('shows the chain score climbing as the chain plays out', () => {
    const board = parseBoardBottom('R.....\nR.....\nR.....', WIDTH, HEIGHT);
    const dropped = stepAll(started(board), [MOVE_LEFT, MOVE_LEFT, HARD_DROP]);
    expect(dropped.phase).toBe('resolving');

    const before = render(dropped).texts();
    const after = render(step(dropped, tick(CONFIG.chainStepMs))).texts();
    expect(before).toContain('0');
    // 5 cells * 10 * clamp(chainPower 0 + colourBonus 0 + groupBonus(5) 2) = 100
    expect(after).toContain('100');
    expect(after).toContain('1 chain');
  });

  it('draws GAME OVER, the blocked piece dimmed, and nothing dimmed after it', () => {
    const full: Board = Array.from({ length: HEIGHT }, () =>
      Array.from({ length: WIDTH }, () => 'red' as const),
    );
    const over = step(newGame(full), tick(0));
    expect(over.phase).toBe('gameover');

    const rec = render(over);
    expect(rec.texts()).toContain('GAME OVER');
    expect(rec.texts()).toContain('spawn blocked');

    const dimmed = rec.arcCentres().filter((a) => a.alpha < 1);
    expect(dimmed).toHaveLength(1); // the axis; the child is in the hidden row
    // `save`/`restore` put the alpha back: the preview is drawn at full opacity.
    expect(rec.arcCentres().slice(-1)[0]!.alpha).toBe(1);
  });

  it('draws no game-over overlay while the game is live', () => {
    expect(render(started()).texts()).not.toContain('GAME OVER');
  });
});

describe('draw — purity', () => {
  it('does not touch the state it is given', () => {
    const state = started(parseBoardBottom('RRR...', WIDTH, HEIGHT));
    const before = JSON.stringify(state);
    render(state);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('makes exactly the same calls for the same state', () => {
    const state = started(parseBoardBottom('RRGG..', WIDTH, HEIGHT));
    const a = render(state);
    const b = render(state);
    expect(JSON.stringify(b.calls)).toBe(JSON.stringify(a.calls));
  });

  it('keeps no state between calls: drawing another state first changes nothing', () => {
    const state = started();
    const alone = render(state);
    const rec = new RecordingContext();
    draw(rec.ctx, step(state, tick(0)), layout);
    const after = new RecordingContext();
    draw(after.ctx, state, layout);
    expect(JSON.stringify(after.calls)).toBe(JSON.stringify(alone.calls));
  });

  it('balances save and restore', () => {
    const rec = render(started());
    expect(rec.count('save')).toBe(rec.count('restore'));
    expect(rec.globalAlpha).toBe(1);
  });
});
