/**
 * Colours and glyphs.
 *
 * Five puyo colours have to be told apart by people who cannot tell red from
 * green, so hue is never the only signal: every colour also carries a distinct
 * **glyph** stamped on the puyo (triangle, square, diamond, cross, chevron) and
 * a distinct lightness. That is the cheap 80% of accessible colour — it costs
 * one extra path per puyo and survives a greyscale screenshot.
 *
 * No canvas import: this module is data.
 */

import type { Color } from '../core/index.js';

/** The shape stamped on a puyo. Deliberately none of them is a circle — the
 * body already is one, and the glyph has to read against it. */
export type Glyph = 'triangle' | 'square' | 'diamond' | 'cross' | 'chevron';

export interface PuyoStyle {
  readonly fill: string;
  /** Outline, darker than `fill` so puyos of the same colour still read apart. */
  readonly stroke: string;
  /** Top-left highlight, for a bit of roundness. */
  readonly shine: string;
  readonly glyph: Glyph;
}

export const PUYO_STYLES: Readonly<Record<Color, PuyoStyle>> = {
  red: { fill: '#e5484d', stroke: '#7f1d21', shine: '#ff9c9f', glyph: 'triangle' },
  green: { fill: '#46a758', stroke: '#1c4a25', shine: '#93dfa0', glyph: 'square' },
  blue: { fill: '#3e7bfa', stroke: '#17346f', shine: '#9dbcff', glyph: 'diamond' },
  yellow: { fill: '#e8b931', stroke: '#7a5c07', shine: '#ffe08a', glyph: 'cross' },
  purple: { fill: '#a855f7', stroke: '#4c1d80', shine: '#d9aeff', glyph: 'chevron' },
};

/** Everything that is not a puyo. */
export const THEME = {
  /** Canvas backdrop. */
  bg: '#101119',
  /** The well the board is drawn in. */
  well: '#1a1c28',
  /** Cell grid, just enough to count columns by eye. */
  grid: '#242739',
  /** Board outline. */
  edge: '#343a52',
  /** Panel background. */
  panel: '#171926',
  text: '#eceefb',
  dim: '#9096b0',
  accent: '#7dd3fc',
  /** Glyph ink, over any puyo fill. */
  ink: 'rgba(255, 255, 255, 0.9)',
  overlay: 'rgba(8, 9, 14, 0.72)',
  danger: '#ff6b6b',
} as const;

/** The style for a colour. Total over `Color`, so there is no fallback branch. */
export function styleFor(color: Color): PuyoStyle {
  return PUYO_STYLES[color];
}
