import { describe, expect, it } from 'vitest';
import { createRng, rngInt, rngNext, rngRange, shuffleInPlace } from './rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(rngNext(a)).toBe(rngNext(b));
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 20 }, () => rngNext(a) === rngNext(b)).filter(Boolean);
    expect(same.length).toBeLessThan(20);
  });

  it('stays within its ranges', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rngNext(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rngInt(r, 5);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
      const x = rngRange(r, -3, 3);
      expect(x >= -3 && x < 3).toBe(true);
    }
  });

  it('keeps its state as plain data', () => {
    const r = createRng(9);
    rngNext(r);
    const copy = structuredClone(r);
    expect(rngNext(copy)).toBe(rngNext(r));
  });

  it('shuffles into a permutation', () => {
    const arr = shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], createRng(3));
    expect([...arr].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
