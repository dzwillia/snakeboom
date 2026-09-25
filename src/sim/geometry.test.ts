import { describe, expect, it } from 'vitest';
import { decimatePolygon, pointInPolygon } from './geometry';

const square = [0, 0, 10, 0, 10, 10, 0, 10];
const concave = [0, 0, 10, 0, 10, 10, 5, 5, 0, 10]; // a notch cut into the top

describe('pointInPolygon', () => {
  it('handles a square: inside, outside, on the edge', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-1, 5, square)).toBe(false);
    expect(pointInPolygon(5, 0, square)).toBe(true);
    expect(pointInPolygon(10, 10, square)).toBe(true);
  });

  it('handles a concave shape', () => {
    expect(pointInPolygon(5, 8, concave)).toBe(false);
    expect(pointInPolygon(2, 8, concave)).toBe(true);
    expect(pointInPolygon(5, 2, concave)).toBe(true);
  });

  it('treats a self-touching loop by the even-odd rule and rejects degenerate polygons', () => {
    // A bow-tie: its lobes are left and right of the crossing at (5, 5).
    const eight = [0, 0, 10, 10, 10, 0, 0, 10];
    expect(pointInPolygon(2, 5, eight)).toBe(true);
    expect(pointInPolygon(8, 5, eight)).toBe(true);
    expect(pointInPolygon(5, 1, eight)).toBe(false);
    expect(pointInPolygon(5, 5, [0, 0, 10, 10])).toBe(false);
  });
});

describe('decimatePolygon', () => {
  it('keeps small polygons and thins large ones, keeping both ends', () => {
    expect(decimatePolygon(square, 8)).toEqual(square);
    const big = Array.from({ length: 200 }, (_, i) => [i, i * 2]).flat();
    const thin = decimatePolygon(big, 10);
    expect(thin).toHaveLength(20);
    expect(thin.slice(0, 2)).toEqual([0, 0]);
    expect(thin.slice(-2)).toEqual([199, 398]);
  });
});
