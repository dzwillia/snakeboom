import { describe, expect, it } from 'vitest';
import { HALF_PI, PI, detAtan2, detCos, detSin, wrapAngle } from './detmath';

describe('detmath', () => {
  it('matches Math.sin and Math.cos within 1e-12 across many turns', () => {
    for (let a = -20; a <= 20; a += 0.0137) {
      expect(Math.abs(detSin(a) - Math.sin(a))).toBeLessThan(1e-12);
      expect(Math.abs(detCos(a) - Math.cos(a))).toBeLessThan(1e-12);
    }
  });

  it('matches Math.atan2 within 1e-12 in every quadrant', () => {
    for (let y = -3; y <= 3; y += 0.173) {
      for (let x = -3; x <= 3; x += 0.191) {
        expect(Math.abs(detAtan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-12);
      }
    }
    expect(detAtan2(0, 0)).toBe(0);
    expect(detAtan2(1, 0)).toBe(HALF_PI);
    expect(detAtan2(-1, 0)).toBe(-HALF_PI);
    expect(detAtan2(0, -1)).toBe(PI);
  });

  it('wraps angles into [-PI, PI) without changing their direction', () => {
    for (const a of [-10, -PI, 0, 3, PI, 7, 100]) {
      const w = wrapAngle(a);
      expect(w).toBeGreaterThanOrEqual(-PI);
      expect(w).toBeLessThan(PI);
      expect(Math.abs(Math.sin(w) - Math.sin(a))).toBeLessThan(1e-9);
      expect(Math.abs(Math.cos(w) - Math.cos(a))).toBeLessThan(1e-9);
    }
  });
});
