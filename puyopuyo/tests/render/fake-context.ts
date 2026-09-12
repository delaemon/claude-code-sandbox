/**
 * A canvas context that draws nothing and remembers everything.
 *
 * Vitest runs in Node: there is no canvas, and there is no need for one. What
 * the tests actually want to assert is *what was drawn where*, which is a list
 * of calls — "78 arcs" catches the hidden row being drawn far more precisely
 * than looking at a picture would.
 *
 * Each call snapshots the style properties in force at the time, because
 * `fillStyle` at the moment of `fillRect` is part of what was drawn. `save`
 * and `restore` really do push and pop that state, so a test can assert that
 * the game-over piece was drawn at reduced alpha *and* that the alpha did not
 * leak into the calls after it.
 */

/** One recorded call, with the drawing state in force when it happened. */
export interface Call {
  readonly fn: string;
  readonly args: readonly number[];
  readonly text?: string;
  readonly fillStyle: string;
  readonly strokeStyle: string;
  readonly globalAlpha: number;
  readonly font: string;
  readonly textAlign: string;
}

const STATE_KEYS = [
  'fillStyle',
  'strokeStyle',
  'globalAlpha',
  'lineWidth',
  'font',
  'textAlign',
  'textBaseline',
  'lineJoin',
  'lineCap',
] as const;

type StateKey = (typeof STATE_KEYS)[number];
type StateSnapshot = Record<StateKey, unknown>;

const VOID_METHODS = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'ellipse',
  'rect',
  'roundRect',
  'fill',
  'stroke',
  'clip',
  'fillRect',
  'strokeRect',
  'clearRect',
  'translate',
  'scale',
  'setTransform',
  'setLineDash',
  'quadraticCurveTo',
  'bezierCurveTo',
] as const;

export class RecordingContext {
  readonly calls: Call[] = [];

  fillStyle: unknown = '#000000';
  strokeStyle: unknown = '#000000';
  globalAlpha = 1;
  lineWidth = 1;
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  lineJoin = 'miter';
  lineCap = 'butt';

  private readonly stack: StateSnapshot[] = [];

  constructor() {
    for (const name of VOID_METHODS) {
      (this as unknown as Record<string, (...args: number[]) => void>)[name] = (
        ...args: number[]
      ): void => {
        this.record(name, args);
      };
    }
  }

  save(): void {
    const snapshot = {} as StateSnapshot;
    for (const key of STATE_KEYS) snapshot[key] = this[key];
    this.stack.push(snapshot);
    this.record('save', []);
  }

  restore(): void {
    const snapshot = this.stack.pop();
    if (snapshot !== undefined) {
      for (const key of STATE_KEYS) {
        (this as unknown as Record<StateKey, unknown>)[key] = snapshot[key];
      }
    }
    this.record('restore', []);
  }

  fillText(value: string, x: number, y: number): void {
    this.record('fillText', [x, y], value);
  }

  strokeText(value: string, x: number, y: number): void {
    this.record('strokeText', [x, y], value);
  }

  measureText(value: string): { width: number } {
    return { width: value.length * 6 };
  }

  /** The context, typed for `draw`. It is a fake and makes no apology for it. */
  get ctx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }

  /** Every call to `fn`, in order. */
  of(fn: string): Call[] {
    return this.calls.filter((call) => call.fn === fn);
  }

  count(fn: string): number {
    return this.of(fn).length;
  }

  /** Every string passed to `fillText`, in order. */
  texts(): string[] {
    return this.of('fillText').map((call) => call.text ?? '');
  }

  /** Centres of every `arc`: one per puyo drawn. */
  arcCentres(): { x: number; y: number; alpha: number }[] {
    return this.of('arc').map((call) => ({
      x: call.args[0] ?? Number.NaN,
      y: call.args[1] ?? Number.NaN,
      alpha: call.globalAlpha,
    }));
  }

  private record(fn: string, args: readonly number[], text?: string): void {
    this.calls.push({
      fn,
      args,
      ...(text === undefined ? {} : { text }),
      fillStyle: String(this.fillStyle),
      strokeStyle: String(this.strokeStyle),
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
    });
  }
}
