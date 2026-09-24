import { describe, expect, it } from 'vitest';
import { HeadSmoothing, MAX_OFFSET } from './smoothing';

// M8 Review Focus 3: smoothing never hides the truth for long.
describe('HeadSmoothing', () => {
  it('decays a 10-unit correction below 0.1 within 6 frames', () => {
    const s = new HeadSmoothing(2);
    s.correct(1, 10, 0);
    expect(s.offsets[1].x).toBe(10);
    for (let i = 0; i < 6; i++) s.frame();
    expect(Math.abs(s.offsets[1].x)).toBeLessThan(0.1);
    expect(s.offsets[1]).toEqual({ x: 0, y: 0 });
    expect(s.offsets[0]).toEqual({ x: 0, y: 0 });
  });

  it('adds corrections and clamps the total', () => {
    const s = new HeadSmoothing(2);
    s.correct(0, 3, 4);
    s.correct(0, 3, 4);
    expect(s.offsets[0]).toEqual({ x: 6, y: 8 });
    s.correct(0, 300, 400);
    expect(Math.hypot(s.offsets[0].x, s.offsets[0].y)).toBeCloseTo(MAX_OFFSET, 6);
  });

  it('resets one head or all', () => {
    const s = new HeadSmoothing(2);
    s.correct(0, 5, 5);
    s.correct(1, 5, 5);
    s.reset(1);
    expect(s.offsets[1]).toEqual({ x: 0, y: 0 });
    expect(s.offsets[0]).toEqual({ x: 5, y: 5 });
    s.reset();
    expect(s.offsets[0]).toEqual({ x: 0, y: 0 });
    s.correct(5, 1, 1);
  });
});
