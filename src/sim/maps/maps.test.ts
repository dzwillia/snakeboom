import { describe, expect, it } from 'vitest';
import { MAP_CELL, MAP_COLS, MAP_ROWS } from '../config';
import { PI } from '../detmath';
import { MAP_DEFS, MAPS } from './index';
import { mapRows, parseMap } from './parse';

const rotated = (ch: string) => (ch === '1' ? '2' : ch === '2' ? '1' : ch);
const norm = (deg: number) => ((deg % 360) + 360) % 360;

function reachable(rows: string[], from: [number, number]): Set<string> {
  const seen = new Set<string>([from.join(',')]);
  const queue: Array<[number, number]> = [from];
  while (queue.length > 0) {
    const [c, r] = queue.shift()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const key = `${nc},${nr}`;
      if (nc < 0 || nr < 0 || nc >= MAP_COLS || nr >= MAP_ROWS || seen.has(key)) continue;
      if (rows[nr][nc] === '#') continue;
      seen.add(key);
      queue.push([nc, nr]);
    }
  }
  return seen;
}

function find(rows: string[], ch: string): [number, number] {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].indexOf(ch);
    if (c >= 0) return [c, r];
  }
  throw new Error(`no ${ch}`);
}

describe('maps', () => {
  it('parses every map, Open first', () => {
    expect(MAPS).toHaveLength(MAP_DEFS.length);
    expect(MAPS.map((m) => m.name)).toEqual(['Open', 'Pillars', 'Cross', 'Bunkers', 'Lanes']);
  });

  for (const def of MAP_DEFS) {
    describe(def.name, () => {
      const rows = mapRows(def);

      it('is 40 columns by 25 rows', () => {
        expect(rows).toHaveLength(MAP_ROWS);
        for (const row of rows) expect(row).toHaveLength(MAP_COLS);
      });

      it('has 180-degree rotational symmetry', () => {
        for (let r = 0; r < MAP_ROWS; r++) {
          for (let c = 0; c < MAP_COLS; c++) {
            expect(rotated(rows[MAP_ROWS - 1 - r][MAP_COLS - 1 - c]), `cell ${c},${r}`).toBe(rows[r][c]);
          }
        }
        expect(norm(def.spawnHeadings[0] + 180)).toBe(norm(def.spawnHeadings[1]));
      });

      it('connects both spawns through a large open area', () => {
        const seen = reachable(rows, find(rows, '1'));
        expect(seen.has(find(rows, '2').join(','))).toBe(true);
        const open = rows.join('').split('').filter((ch) => ch !== '#').length;
        expect(seen.size / open).toBeGreaterThan(0.6);
      });
    });
  }

  it('places spawns at cell centers with headings in radians', () => {
    const open = MAPS[0];
    expect(open.spawns[0]).toEqual({ x: 6.5 * MAP_CELL, y: 5.5 * MAP_CELL, heading: 0 });
    expect(open.spawns[1].x).toBe(33.5 * MAP_CELL);
    expect(open.spawns[1].y).toBe(19.5 * MAP_CELL);
    expect(open.spawns[1].heading).toBeCloseTo(PI, 12);
  });

  it('rejects malformed maps', () => {
    const good = MAP_DEFS[0];
    expect(() => parseMap({ ...good, grid: good.grid.replace('1', '.') })).toThrow(/spawn/);
    expect(() => parseMap({ ...good, grid: good.grid.replace('.', 'x') })).toThrow(/unknown/);
    expect(() => parseMap({ ...good, grid: '....' })).toThrow(/rows/);
  });
});
