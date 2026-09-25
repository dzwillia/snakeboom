import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH, MAP_CELL, MAP_COLS, MAP_ROWS, TILE_COLS, TILE_ROWS } from '../config';
import { PI } from '../detmath';
import { createRng } from '../rng';
import { generateMap, MAX_FILL, MIN_REACH, SPAWN_CLEARANCE, SPAWN_LAYOUTS, type GeneratedMap } from './generate';
import { MAPS } from './index';
import { cellsToTiles } from './parse';

const CELLS = MAP_COLS * MAP_ROWS;
const gen = (seed: number, density = 0.3): GeneratedMap => generateMap(createRng(seed), { density });
const cellOf = (x: number, y: number): [number, number] => [Math.floor(x / MAP_CELL), Math.floor(y / MAP_CELL)];
const seeds = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => from + i * 7919);

function reachable(cells: readonly number[], from: number): Set<number> {
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const i = queue.shift()!;
    const c = i % MAP_COLS;
    const r = Math.floor(i / MAP_COLS);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      const j = nr * MAP_COLS + nc;
      if (nc < 0 || nr < 0 || nc >= MAP_COLS || nr >= MAP_ROWS || seen.has(j) || cells[j] === 1) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}

describe('generateMap', () => {
  it('is a pure function of the rng state', () => {
    expect(gen(42)).toEqual(gen(42));
    expect(gen(42).cells).not.toEqual(gen(43).cells);
    const rng = createRng(42);
    const first = generateMap(rng, { density: 0.3 });
    const second = generateMap(rng, { density: 0.3 });
    expect(second.cells).not.toEqual(first.cells);
  });

  it('expands cells to 4×4 tile blocks like the hand-made maps', () => {
    const m = gen(7);
    expect(m.cells).toHaveLength(CELLS);
    expect(m.tiles).toHaveLength(TILE_COLS * TILE_ROWS);
    expect(m.tiles).toEqual(cellsToTiles(m.cells));
    expect(m.tiles.filter((t) => t === 1)).toHaveLength(16 * m.cells.filter((c) => c === 1).length);
  });

  it('has point symmetry through the centre, spawns included', () => {
    for (const seed of seeds(50)) {
      const m = gen(seed);
      for (let i = 0; i < CELLS; i++) expect(m.cells[i], `seed ${seed} cell ${i}`).toBe(m.cells[CELLS - 1 - i]);
      const [a, b] = m.spawns;
      expect(b.x).toBe(ARENA_WIDTH - a.x);
      expect(b.y).toBe(ARENA_HEIGHT - a.y);
      expect((((b.heading - a.heading) % (2 * PI)) + 2 * PI) % (2 * PI)).toBeCloseTo(PI, 9);
    }
  });

  it('puts the spawns where a hand-made map does, with clear cells around them', () => {
    const handmade = new Set(MAPS.map((m) => `${m.spawns[0].x},${m.spawns[0].y},${m.spawns[0].heading}`));
    for (const seed of seeds(50)) {
      const m = gen(seed);
      expect(handmade.has(`${m.spawns[0].x},${m.spawns[0].y},${m.spawns[0].heading}`), `seed ${seed}`).toBe(true);
      for (const sp of m.spawns) {
        const [sc, sr] = cellOf(sp.x, sp.y);
        for (let r = sr - SPAWN_CLEARANCE; r <= sr + SPAWN_CLEARANCE; r++) {
          for (let c = sc - SPAWN_CLEARANCE; c <= sc + SPAWN_CLEARANCE; c++) {
            if (c < 0 || r < 0 || c >= MAP_COLS || r >= MAP_ROWS) continue;
            expect(m.cells[r * MAP_COLS + c], `seed ${seed} cell ${c},${r}`).toBe(0);
          }
        }
      }
    }
  });

  it('uses every spawn layout over enough seeds', () => {
    const seen = new Set(seeds(60).map((seed) => `${gen(seed).spawns[0].x},${gen(seed).spawns[0].y}`));
    expect(seen.size).toBe(SPAWN_LAYOUTS.length);
  });

  it('connects the spawns through at least 90% of the floor, with no dead-end cells, on 200 seeds', () => {
    for (const seed of seeds(200, 1000)) {
      const m = gen(seed);
      expect(m.name, `seed ${seed} fell back`).toBe('Random');
      const [c1, r1] = cellOf(m.spawns[0].x, m.spawns[0].y);
      const [c2, r2] = cellOf(m.spawns[1].x, m.spawns[1].y);
      const seen = reachable(m.cells, r1 * MAP_COLS + c1);
      expect(seen.has(r2 * MAP_COLS + c2), `seed ${seed}`).toBe(true);
      const floor = m.cells.filter((c) => c !== 1).length;
      expect(seen.size / floor, `seed ${seed}`).toBeGreaterThanOrEqual(MIN_REACH);
      for (let i = 0; i < CELLS; i++) {
        if (m.cells[i] === 1) continue;
        const c = i % MAP_COLS;
        const r = Math.floor(i / MAP_COLS);
        let open = 0;
        if (c > 0 && m.cells[i - 1] !== 1) open++;
        if (c < MAP_COLS - 1 && m.cells[i + 1] !== 1) open++;
        if (r > 0 && m.cells[i - MAP_COLS] !== 1) open++;
        if (r < MAP_ROWS - 1 && m.cells[i + MAP_COLS] !== 1) open++;
        expect(open, `seed ${seed} cell ${c},${r} is a dead end`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps blocks two cells from the arena edge', () => {
    for (const seed of seeds(50)) {
      const m = gen(seed);
      for (let i = 0; i < CELLS; i++) {
        if (m.cells[i] !== 1) continue;
        const c = i % MAP_COLS;
        const r = Math.floor(i / MAP_COLS);
        expect(c >= 2 && c < MAP_COLS - 2 && r >= 2 && r < MAP_ROWS - 2, `seed ${seed} cell ${c},${r}`).toBe(true);
      }
    }
  });

  it('fills about as much as the hand-made maps at the default density, and scales with the knob', () => {
    const fill = (density: number): number => {
      const total = seeds(100, 500).reduce((sum, seed) => sum + gen(seed, density).cells.filter((c) => c === 1).length, 0);
      return total / (100 * CELLS);
    };
    const handmade = MAPS.reduce((sum, m) => sum + m.tiles.filter((t) => t === 1).length / 16, 0) / (MAPS.length * CELLS);
    expect(handmade).toBeGreaterThan(0.035);
    expect(handmade).toBeLessThan(0.055);
    const base = fill(0.3);
    expect(base).toBeGreaterThan(0.035);
    expect(base).toBeLessThan(0.055);
    expect(fill(0)).toBe(0);
    expect(fill(0.6)).toBeGreaterThan(base * 1.5);
    expect(fill(1)).toBeGreaterThan(0.1);
    expect(fill(1)).toBeLessThanOrEqual(MAX_FILL + 0.01);
  });

  it('falls back to the empty map when every attempt fails', () => {
    const m = generateMap(createRng(1), { density: 0.3, maxTries: 0 });
    expect(m.name).toBe('Random (fallback)');
    expect(m.cells.every((c) => c === 0)).toBe(true);
    expect(m.spawns).toEqual(MAPS[0].spawns);
  });
});
