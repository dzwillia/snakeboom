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
  it('runs at most 5 catch-up ticks per frame after a long pause, carrying at most 5 more into the next', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.start();
    loop.frame(10_000);
    expect(ticks).toBe(5);
    // The clamped 250 ms gap left 10 ticks; only 5 carry, plus this frame's own tick.
    loop.frame(10_000 + TICK_MS + 1);
    expect(ticks).toBe(10);
    // The tick left over from the carry is spent over the next frames, then it's one per frame.
    loop.frame(10_000 + 2 * TICK_MS + 2);
    expect(ticks).toBe(12);
    loop.frame(10_000 + 3 * TICK_MS + 3);
    expect(ticks).toBe(13);
    loop.frame(10_000 + 4 * TICK_MS + 4);
    expect(ticks).toBe(14);
  });

  it('carries a hitch into the next frames instead of dropping the time', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.start();
    // A 120 ms frame (7 ticks' worth): 5 now, 2 next frame plus its own.
    loop.frame(120);
    expect(ticks).toBe(5);
    loop.frame(120 + TICK_MS + 0.5);
    expect(ticks).toBe(8);
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
