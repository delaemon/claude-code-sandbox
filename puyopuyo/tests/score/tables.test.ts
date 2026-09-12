import { describe, expect, it } from 'vitest';
import {
  CHAIN_POWER,
  COLOR_BONUS,
  GROUP_BONUS,
  MAX_CLEAR_BONUS,
  chainPower,
  clampClearBonus,
  colorBonus,
  groupBonus,
} from '../../src/score/index.js';

describe('scoring tables', () => {
  it('indexes chain power by 1-based chain number', () => {
    expect(chainPower(1)).toBe(0);
    expect(chainPower(2)).toBe(8);
    expect(chainPower(3)).toBe(16);
    expect(chainPower(4)).toBe(32);
    expect(chainPower(5)).toBe(64);
    expect(chainPower(6)).toBe(96);
  });

  it('holds the last chain power past the end of the table', () => {
    const last = CHAIN_POWER[CHAIN_POWER.length - 1]!;
    expect(chainPower(CHAIN_POWER.length)).toBe(last);
    expect(chainPower(CHAIN_POWER.length + 50)).toBe(last);
    expect(chainPower(0)).toBe(0);
  });

  it('indexes colour bonus by distinct colours popped', () => {
    expect(colorBonus(1)).toBe(0);
    expect(colorBonus(2)).toBe(3);
    expect(colorBonus(3)).toBe(6);
    expect(colorBonus(4)).toBe(12);
    expect(colorBonus(5)).toBe(24);
    expect(colorBonus(0)).toBe(0);
    expect(colorBonus(COLOR_BONUS.length + 3)).toBe(COLOR_BONUS[COLOR_BONUS.length - 1]);
  });

  it('indexes group bonus by group size, capped at 11 or more', () => {
    expect(groupBonus(3)).toBe(0);
    expect(groupBonus(4)).toBe(0);
    expect(groupBonus(5)).toBe(2);
    expect(groupBonus(6)).toBe(3);
    expect(groupBonus(7)).toBe(4);
    expect(groupBonus(8)).toBe(5);
    expect(groupBonus(9)).toBe(6);
    expect(groupBonus(10)).toBe(7);
    expect(groupBonus(11)).toBe(10);
    expect(groupBonus(72)).toBe(GROUP_BONUS[GROUP_BONUS.length - 1]);
  });

  it('offsets the group bonus when the pop threshold is below 4', () => {
    // A minimum-size group scores 0 whatever the threshold is.
    expect(groupBonus(3, 3)).toBe(0);
    expect(groupBonus(4, 3)).toBe(2);
    expect(groupBonus(5, 3)).toBe(3);
  });

  it('clamps the multiplier to 1..999', () => {
    expect(clampClearBonus(0)).toBe(1);
    expect(clampClearBonus(-5)).toBe(1);
    expect(clampClearBonus(1)).toBe(1);
    expect(clampClearBonus(35)).toBe(35);
    expect(clampClearBonus(5000)).toBe(MAX_CLEAR_BONUS);
  });
});
