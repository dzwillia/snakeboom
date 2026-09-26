import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { gridClear, gridQuery } from './grid';
import { mapCatalogue, MAPS, RANDOM_SLOTS } from './maps';
import { cloneState, createMatch, pickNextMap, rebuildGrid, startRound } from './state';
import type { MatchState } from './types';

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
    gridQuery(s.grid, MAPS[0].spawns[0].x, MAPS[0].spawns[0].y, 1, (snake, seq) => seen.push([snake, seq]));
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

describe('map rotation', () => {
  const handmadeTiles = new Set(MAPS.map((m) => JSON.stringify(m.tiles)));
  const isHandmade = (s: MatchState): boolean => handmadeTiles.has(JSON.stringify(s.tiles));

  /** Plays `rounds` round starts the way stepRoundOver does, returning each round's map name and whether it was hand-made. */
  function rotate(cfg: Config, seed: number, rounds: number): Array<{ name: string; handmade: boolean }> {
    const s = createMatch(cfg, seed);
    const out = [{ name: s.mapName, handmade: isHandmade(s) }];
    for (let i = 1; i < rounds; i++) {
      s.mapIndex = pickNextMap(s, mapCatalogue(cfg.maps).length);
      startRound(s, cfg);
      out.push({ name: s.mapName, handmade: isHandmade(s) });
    }
    return out;
  }

  it('names the map and starts on Open by default', () => {
    const s = createMatch(DEFAULT_CONFIG, 3);
    expect(s.mapName).toBe('Open');
    expect(mapCatalogue('both')).toHaveLength(MAPS.length + RANDOM_SLOTS);
    expect(mapCatalogue('handmade')).toHaveLength(MAPS.length);
    expect(mapCatalogue('random')).toHaveLength(RANDOM_SLOTS);
  });

  it("'handmade' deals only the five hand-made maps", () => {
    const rounds = rotate({ ...DEFAULT_CONFIG, maps: 'handmade' }, 11, 30);
    expect(rounds.every((r) => r.handmade)).toBe(true);
    expect(new Set(rounds.map((r) => r.name))).toEqual(new Set(['Open', 'Pillars', 'Cross', 'Bunkers', 'Lanes']));
  });

  it("'random' generates every round, round 1 included, and never repeats a layout", () => {
    const cfg: Config = { ...DEFAULT_CONFIG, maps: 'random' };
    const s = createMatch(cfg, 11);
    expect(s.mapName).toBe('Random');
    expect(isHandmade(s)).toBe(false);
    const layouts = new Set<string>([JSON.stringify(s.tiles)]);
    for (let i = 1; i < 12; i++) {
      s.mapIndex = pickNextMap(s, mapCatalogue(cfg.maps).length);
      startRound(s, cfg);
      expect(s.mapName).toBe('Random');
      layouts.add(JSON.stringify(s.tiles));
    }
    expect(layouts.size).toBe(12);
  });

  it("'both' deals the five hand-made maps and three random slots per bag", () => {
    const rounds = rotate(DEFAULT_CONFIG, 11, 1 + 16);
    expect(rounds[0].name).toBe('Open');
    for (const bag of [rounds.slice(1, 9), rounds.slice(9, 17)]) {
      expect(bag.filter((r) => r.handmade).map((r) => r.name).sort()).toEqual(['Bunkers', 'Cross', 'Lanes', 'Open', 'Pillars']);
      expect(bag.filter((r) => !r.handmade)).toHaveLength(RANDOM_SLOTS);
      expect(bag.filter((r) => r.name === 'Random')).toHaveLength(RANDOM_SLOTS);
    }
  });

  it('honours the density knob', () => {
    const count = (density: number): number => {
      const s = createMatch({ ...DEFAULT_CONFIG, maps: 'random', mapDensity: density }, 5);
      return s.tiles.filter((t) => t === 1).length;
    };
    expect(count(0)).toBe(0);
    expect(count(0.8)).toBeGreaterThan(count(0.3));
  });

  it('survives a maps setting that changes mid-match', () => {
    const s = createMatch(DEFAULT_CONFIG, 8);
    s.mapIndex = 7;
    startRound(s, { ...DEFAULT_CONFIG, maps: 'handmade' });
    expect(s.mapName).toBe('Cross');
  });

  it('builds the same generated map again from a cloned rng state', () => {
    const cfg: Config = { ...DEFAULT_CONFIG, maps: 'random' };
    const s = createMatch(cfg, 21);
    const before = cloneState(s);
    startRound(s, cfg);
    startRound(before, cfg);
    expect(before.tiles).toEqual(s.tiles);
    expect(before.rng).toEqual(s.rng);
  });
});
