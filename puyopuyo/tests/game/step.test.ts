import { describe, expect, it } from 'vitest';
import { HEIGHT, WIDTH, formatBoard, parseBoardBottom, type Board } from '../../src/core/index.js';
import {
  HARD_DROP,
  MOVE_LEFT,
  MOVE_RIGHT,
  ROTATE_CW,
  SOFT_DROP,
  activePiece,
  createGame,
  step,
  stepAll,
  tick,
  type GameState,
  type Input,
} from '../../src/game/index.js';

/** Every pair is red/red, so fixtures can name the colour they expect. */
const allRed = () => 0;

/** Fast, explicit timings — every test drives them with exact tick inputs. */
const CONFIG = {
  fallIntervalMs: 100,
  lockDelayMs: 500,
  chainStepMs: 300,
  spawnDelayMs: 0,
};

const bottom = (text: string): Board => parseBoardBottom(text, WIDTH, HEIGHT);

/** The board as text, bottom `rows` rows only. */
const tail = (state: GameState, rows: number): string =>
  formatBoard(state.board).split('\n').slice(-rows).join('\n');

const newGame = (board?: Board, config: Partial<typeof CONFIG> = {}) =>
  createGame({
    rng: allRed,
    config: { ...CONFIG, ...config },
    ...(board === undefined ? {} : { board }),
  });

/** A game with its first pair on the board. */
const started = (board?: Board, config: Partial<typeof CONFIG> = {}) =>
  step(newGame(board, config), tick(0));

const piece = (state: GameState) => {
  const p = activePiece(state);
  if (p === null) throw new Error(`no active piece in phase ${state.phase}`);
  return p;
};

describe('spawning', () => {
  it('starts in the spawning phase with no piece: nothing happens without an input', () => {
    const game = newGame();
    expect(game.phase).toBe('spawning');
    expect(activePiece(game)).toBeNull();
  });

  it('ignores player actions while spawning', () => {
    const game = newGame();
    for (const input of [MOVE_LEFT, ROTATE_CW, HARD_DROP] as const) {
      expect(step(game, input)).toBe(game);
    }
  });

  it('puts the pair in the spawn column on the first tick, child in the hidden row', () => {
    const state = started();
    expect(state.phase).toBe('falling');
    expect(piece(state)).toMatchObject({ x: 2, y: 1, rotation: 0 });
    expect(state.queue.index).toBe(1);
  });

  it('waits out a spawn delay', () => {
    const game = newGame(undefined, { spawnDelayMs: 200 });
    const waited = step(game, tick(150));
    expect(waited.phase).toBe('spawning');
    expect(step(waited, tick(50)).phase).toBe('falling');
  });
});

describe('falling under gravity', () => {
  it('falls one row per fallIntervalMs and keeps the remainder', () => {
    const a = step(started(), tick(100));
    expect(piece(a).y).toBe(2);

    const b = step(a, tick(250));
    expect(piece(b).y).toBe(4);
    expect(b.phase === 'falling' ? b.fallAccMs : -1).toBe(50);
  });

  it('accumulates sub-interval ticks instead of dropping them', () => {
    const s = stepAll(started(), [tick(40), tick(40)]);
    expect(piece(s).y).toBe(1);
    expect(piece(step(s, tick(20))).y).toBe(2);
  });

  it('moves left and right, and refuses to leave the board', () => {
    const left = stepAll(started(), [MOVE_LEFT, MOVE_LEFT]);
    expect(piece(left).x).toBe(0);
    expect(step(left, MOVE_LEFT)).toBe(left);

    const right = stepAll(started(), [MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT, MOVE_RIGHT]);
    expect(piece(right).x).toBe(WIDTH - 1);
    expect(step(right, MOVE_RIGHT)).toBe(right);
  });

  it('soft drop moves one row and restarts the fall accumulator', () => {
    const s = step(started(), tick(60));
    const dropped = step(s, SOFT_DROP);
    expect(piece(dropped).y).toBe(2);
    expect(dropped.phase === 'falling' ? dropped.fallAccMs : -1).toBe(0);
  });
});

describe('lock delay', () => {
  it('enters locking when the piece grounds, and locks when the delay runs out', () => {
    const grounded = step(started(), tick(2000));
    expect(grounded.phase).toBe('locking');
    expect(piece(grounded).y).toBe(HEIGHT - 1);

    const waiting = step(grounded, tick(400));
    expect(waiting.phase).toBe('locking');
    expect(step(waiting, tick(100)).phase).toBe('resolving');
  });

  it('cancels locking when the player moves the piece off its ledge', () => {
    // A single puyo in the spawn column: the pair rests on it, then steps off.
    const grounded = step(started(bottom('..R...')), tick(2000));
    expect(grounded.phase).toBe('locking');
    expect(piece(grounded).y).toBe(HEIGHT - 2);

    const moved = step(grounded, MOVE_LEFT);
    expect(moved.phase).toBe('falling');
    expect(piece(moved)).toMatchObject({ x: 1, y: HEIGHT - 2 });
  });

  it('does not let a move refresh the delay while the piece stays grounded', () => {
    const grounded = stepAll(started(), [tick(2000), tick(300)]);
    expect(grounded.phase === 'locking' ? grounded.lockAccMs : -1).toBe(300);
    const moved = step(grounded, MOVE_LEFT);
    expect(moved.phase === 'locking' ? moved.lockAccMs : -1).toBe(300);
    expect(step(moved, tick(200)).phase).toBe('resolving');
  });

  it('soft drop on a resting piece does nothing', () => {
    const grounded = step(started(), tick(2000));
    expect(step(grounded, SOFT_DROP)).toBe(grounded);
  });

  it('locks immediately when lockDelayMs is 0', () => {
    expect(step(started(undefined, { lockDelayMs: 0 }), tick(2000)).phase).toBe('resolving');
  });
});

describe('hard drop', () => {
  it('drops to the floor and locks in the same input', () => {
    const state = step(started(), HARD_DROP);
    expect(state.phase).toBe('resolving');
    expect(tail(state, 2)).toBe('..R...\n..R...');
    expect(state.stats.piecesPlaced).toBe(1);
  });

  it('lands on top of a stack, not through it', () => {
    const state = step(started(bottom('..G...')), HARD_DROP);
    expect(tail(state, 3)).toBe('..R...\n..R...\n..G...');
  });

  it('drops a rotated pair side by side', () => {
    const state = stepAll(started(), [ROTATE_CW, HARD_DROP]);
    expect(tail(state, 1)).toBe('..RR..');
  });
});

describe('resolving a chain after a lock', () => {
  // Dropping a red pair into column 0 joins three reds; the green it uncovers
  // then falls and completes a second group. Chain of 2.
  const fixture = bottom(`
    ..G...
    ..RG..
    .RRGG.
  `);

  it('pops step by step as ticks arrive, then spawns the next pair', () => {
    const locked = stepAll(started(fixture), [MOVE_LEFT, MOVE_LEFT, HARD_DROP]);
    expect(locked.phase).toBe('resolving');
    expect(locked.lastResolve?.chainCount).toBe(2);
    expect(tail(locked, 3)).toBe('..G...\nR.RG..\nRRRGG.');

    const first = step(locked, tick(300));
    expect(first.phase).toBe('resolving');
    expect(tail(first, 2)).toBe('...G..\n..GGG.');

    const done = step(first, tick(300));
    expect(done.phase).toBe('spawning');
    expect(tail(done, 1)).toBe('......');
    expect(done.stats).toEqual({
      piecesPlaced: 1,
      chains: 1,
      longestChain: 2,
      totalCleared: 9,
      // step 1 clears 5 (group bonus 2): 5 * 10 * 2 = 100
      // step 2 clears 4 (chain power 8): 4 * 10 * 8 = 320
      score: 420,
    });
  });

  it('ignores player actions while a chain is resolving', () => {
    const locked = stepAll(started(fixture), [MOVE_LEFT, MOVE_LEFT, HARD_DROP]);
    for (const input of [MOVE_LEFT, ROTATE_CW, HARD_DROP, SOFT_DROP] as const) {
      expect(step(locked, input)).toBe(locked);
    }
  });

  it('passes through the resolving phase even when nothing pops', () => {
    const locked = step(started(), HARD_DROP);
    expect(locked.lastResolve?.chainCount).toBe(0);
    const next = step(locked, tick(0));
    expect(next.phase).toBe('spawning');
    expect(step(next, tick(0)).queue.index).toBe(2);
  });

  it('leaves the hidden row out of the chain', () => {
    // Column 0 is full to the top; its four reds span rows 0..3, so one of
    // them sits in the hidden row and the group is only 3 visible puyos.
    const hidden = bottom(`
      R.....
      R.....
      R.....
      R.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
    `);
    const state = step(started(hidden), HARD_DROP);
    expect(state.lastResolve?.chainCount).toBe(0);
    expect(formatBoard(state.board).split('\n')[0]).toBe('R.....');

    // The same column shifted down by one — four *visible* reds — does pop.
    const visible = bottom(`
      G.....
      R.....
      R.....
      R.....
      R.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
    `);
    const popped = step(started(visible), HARD_DROP);
    expect(popped.lastResolve?.chainCount).toBe(1);
    expect(popped.lastResolve?.totalCleared).toBe(4);
  });
});

describe('game over', () => {
  /** The spawn column, filled to the top of the visible field. */
  const blockedSpawn = bottom(`
    ..G...
    ..B...
    ..G...
    ..B...
    ..G...
    ..B...
    ..G...
    ..B...
    ..G...
    ..B...
    ..G...
    ..B...
  `);

  it('ends when the spawn column is blocked', () => {
    const state = step(newGame(blockedSpawn), tick(0));
    expect(state.phase).toBe('gameover');
    expect(state.phase === 'gameover' ? state.reason : '').toBe('spawn-blocked');
    // The queue is not advanced, so a UI can still show the pair that died.
    expect(state.queue.index).toBe(0);
  });

  it('does not end when some other column is full', () => {
    const fullEdge = bottom(`
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
      B.....
      G.....
    `);
    expect(step(newGame(fullEdge), tick(0)).phase).toBe('falling');
  });

  it('is terminal: every input after it is a no-op', () => {
    const over = step(newGame(blockedSpawn), tick(0));
    for (const input of [MOVE_LEFT, HARD_DROP, ROTATE_CW] as const) {
      expect(step(over, input)).toBe(over);
    }
    expect(step(over, tick(1000))).toMatchObject({ phase: 'gameover' });
  });

  it('is reached by playing: stacking the spawn column ends the game', () => {
    // Alternating green and blue pairs, so the stack never pops: six pairs
    // fill rows 1..12 of the spawn column and the seventh has nowhere to go.
    const script = [0.25, 0.25, 0.5, 0.5];
    let i = 0;
    let state: GameState = step(
      createGame({ rng: () => script[i++ % script.length]!, config: CONFIG }),
      tick(0),
    );
    for (let drop = 0; drop < 7 && state.phase !== 'gameover'; drop++) {
      state = stepAll(state, [HARD_DROP, tick(1000), tick(1000)]);
    }
    expect(state.phase).toBe('gameover');
    expect(state.stats.piecesPlaced).toBe(6);
    expect(formatBoard(state.board).split('\n')[0]).toBe('......');
  });
});

describe('the reducer is pure', () => {
  it('returns the same next state for the same input, and never mutates its argument', () => {
    const state = started(bottom('..G...'));
    const before = formatBoard(state.board);
    const a = step(state, HARD_DROP);
    const b = step(state, HARD_DROP);
    expect(b).toEqual(a);
    expect(formatBoard(state.board)).toBe(before);
    expect(piece(state)).toMatchObject({ x: 2, y: 1 });
  });

  it('tracks elapsed time from the ticks it is given, not from a clock', () => {
    const inputs: Input[] = [tick(100), tick(250), MOVE_LEFT, tick(50)];
    expect(stepAll(started(), inputs).elapsedMs).toBe(400);
  });

  it('rejects a nonsensical tick', () => {
    expect(() => step(started(), tick(-1))).toThrow(RangeError);
    expect(() => step(started(), tick(Number.NaN))).toThrow(RangeError);
  });
});
