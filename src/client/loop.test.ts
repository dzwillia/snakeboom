import { describe, expect, it } from 'vitest';
import { FixedLoop, type Clock } from './loop';

function fakeClock(): Clock {
  return { now: () => 0, request: () => {} };
}

const TICK_MS = 1000 / 60;

describe('FixedLoop', () => {
  it('runs one tick per 1/60 s and reports the interpolation alpha', () => {
    let ticks = 0;
    let alpha = -1;
    const loop = new FixedLoop(() => ticks++, (a) => (alpha = a), fakeClock());
    loop.start();
    loop.frame(TICK_MS * 2.5);
    expect(ticks).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 6);
  });

  // Review Focus 3: a long-hidden tab must not fast-forward the game.
  it('runs at most 5 catch-up ticks after a long pause, then resumes normally', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.start();
    loop.frame(10_000);
    expect(ticks).toBe(5);
    loop.frame(10_000 + TICK_MS + 1);
    expect(ticks).toBe(6);
  });

  it('scales simulated time by timeScale', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.timeScale = 0.5;
    loop.start();
    loop.frame(TICK_MS * 4 + 1);
    expect(ticks).toBe(2);
  });
});
