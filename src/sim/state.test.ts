import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { gridClear, gridQuery } from './grid';
import { MAPS } from './maps';
import { cloneState, createMatch, pickNextMap, rebuildGrid } from './state';

describe('match state', () => {
  it('starts round 1 on Open in countdown with both snakes at their spawns', () => {
    const s = createMatch(DEFAULT_CONFIG, 123);
    expect(s.phase).toBe('countdown');
    expect(s.phaseTicks).toBe(3 * TICK_RATE);
    expect(s.round).toBe(1);
    expect(s.mapIndex).toBe(0);
    expect(s.scores).toEqual([0, 0]);
    expect(s.snakes.map((sn) => [sn.x, sn.y])).toEqual(MAPS[0].spawns.map((sp) => [sp.x, sp.y]));
    for (const sn of s.snakes) {
      expect(sn.alive).toBe(true);
      expect(sn.targetLength).toBe(DEFAULT_CONFIG.startLength);
    }
  });

  it('is plain data that survives a JSON round trip', () => {
    const s = createMatch(DEFAULT_CONFIG, 5);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('clones deeply', () => {
    const s = createMatch(DEFAULT_CONFIG, 5);
    const c = cloneState(s);
    c.snakes[0].trail.xs.push(1);
    c.grid.cells[0].push(1);
    c.rng.s = 0;
    expect(s.snakes[0].trail.xs).toHaveLength(1);
    expect(s.grid.cells[0]).toHaveLength(0);
    expect(s.rng.s).not.toBe(0);
  });

  it('rebuilds the grid from the trails', () => {
    const s = createMatch(DEFAULT_CONFIG, 5);
    gridClear(s.grid);
    rebuildGrid(s);
    const seen: Array<[number, number]> = [];
    gridQuery(s.grid, 260, 220, 1, (snake, seq) => seen.push([snake, seq]));
    expect(seen).toEqual([[0, 0]]);
  });

  it('deals every map once per bag and never repeats a map back to back', () => {
    const s = createMatch(DEFAULT_CONFIG, 99);
    const picks: number[] = [];
    for (let i = 0; i < 50; i++) {
      s.mapIndex = pickNextMap(s, 5);
      picks.push(s.mapIndex);
    }
    const sequence = [0, ...picks];
    for (let i = 1; i < sequence.length; i++) expect(sequence[i]).not.toBe(sequence[i - 1]);
    for (let b = 0; b < 10; b++) expect(picks.slice(b * 5, b * 5 + 5).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('always picks map 0 when there is only one map', () => {
    const s = createMatch(DEFAULT_CONFIG, 1);
    expect(pickNextMap(s, 1)).toBe(0);
  });
});
