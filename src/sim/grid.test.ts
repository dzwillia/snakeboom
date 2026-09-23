import { describe, expect, it } from 'vitest';
import { createGrid, gridClear, gridInsert, gridQuery } from './grid';

function query(g: ReturnType<typeof createGrid>, x: number, y: number, r: number) {
  const found: Array<[number, number]> = [];
  gridQuery(g, x, y, r, (snake, seq) => found.push([snake, seq]));
  return found;
}

describe('grid', () => {
  it('finds entries in nearby cells', () => {
    const g = createGrid(1600, 1000);
    gridInsert(g, 100, 100, 1, 42);
    expect(query(g, 110, 95, 20)).toEqual([[1, 42]]);
  });

  it('skips cells outside the query box', () => {
    const g = createGrid(1600, 1000);
    gridInsert(g, 500, 500, 0, 1);
    expect(query(g, 100, 100, 20)).toEqual([]);
  });

  it('clamps out-of-bounds and NaN coordinates into edge cells', () => {
    const g = createGrid(1600, 1000);
    gridInsert(g, -5, 1005, 0, 7);
    gridInsert(g, Number.NaN, Number.NaN, 1, 8);
    expect(query(g, 0, 999, 5)).toEqual([[0, 7]]);
    expect(query(g, 0, 0, 5)).toEqual([[1, 8]]);
  });

  it('packs large sequence numbers losslessly', () => {
    const g = createGrid(1600, 1000);
    gridInsert(g, 10, 10, 1, 123456);
    expect(query(g, 10, 10, 1)).toEqual([[1, 123456]]);
  });

  it('clears every cell', () => {
    const g = createGrid(1600, 1000);
    gridInsert(g, 10, 10, 0, 1);
    gridClear(g);
    expect(query(g, 10, 10, 50)).toEqual([]);
  });
});
