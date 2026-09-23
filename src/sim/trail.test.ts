import { describe, expect, it } from 'vitest';
import { createTrail, headCum, trailLength, trailPush, trailTrim } from './trail';

describe('trail', () => {
  it('tracks cumulative path length', () => {
    const t = createTrail();
    trailPush(t, 0, 0);
    trailPush(t, 3, 4);
    trailPush(t, 3, 10);
    expect(t.cum).toEqual([0, 5, 11]);
    expect(trailLength(t)).toBe(11);
    expect(headCum(t)).toBe(11);
  });

  it('returns increasing sequence numbers', () => {
    const t = createTrail();
    expect(trailPush(t, 0, 0)).toBe(0);
    expect(trailPush(t, 1, 0)).toBe(1);
    expect(trailPush(t, 2, 0)).toBe(2);
  });

  it('trims the tail so the path never exceeds the target', () => {
    const t = createTrail();
    for (let x = 0; x <= 100; x++) trailPush(t, x, 0);
    trailTrim(t, 30.5);
    expect(trailLength(t)).toBe(30);
    expect(t.xs[t.start]).toBe(70);
  });

  it('never trims the head point', () => {
    const t = createTrail();
    trailPush(t, 5, 5);
    trailPush(t, 9, 5);
    trailTrim(t, 0);
    expect(t.xs.length - t.start).toBe(1);
    expect(t.xs[t.start]).toBe(9);
  });

  it('keeps sequence numbers valid after compaction', () => {
    const t = createTrail();
    for (let x = 0; x < 10000; x++) trailPush(t, x, 0);
    trailTrim(t, 100);
    expect(t.start).toBe(0);
    expect(t.baseSeq).toBe(9899);
    const seq = 9904;
    expect(t.xs[seq - t.baseSeq]).toBe(9904);
    expect(trailPush(t, 10000, 0)).toBe(10000);
  });
});
