import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config } from './config';
import { createGrid, gridClear, gridInsert } from './grid';
import { MAPS } from './maps';
import { createRng, shuffleInPlace } from './rng';
import { createSnake } from './snake';
import type { MatchState } from './types';

export function createMatch(cfg: Config, seed: number): MatchState {
  const state: MatchState = {
    tick: 0,
    phase: 'countdown',
    phaseTicks: 0,
    round: 1,
    roundTicks: 0,
    overtime: false,
    inset: 0,
    scores: [0, 0],
    matchWinner: null,
    lastRoundWinner: null,
    mapIndex: 0,
    mapBag: [],
    rng: createRng(seed),
    tiles: [],
    tilesVersion: 0,
    snakes: [],
    grid: createGrid(ARENA_WIDTH, ARENA_HEIGHT),
    deaths: [],
    pickups: [],
    missiles: [],
    wormholes: [],
    saws: [],
    pickupTimer: 0,
    wormholeTimer: 0,
    sawTimer: 0,
    nextId: 1,
  };
  startRound(state, cfg);
  return state;
}

/** Loads the current map and respawns everyone into a fresh countdown. */
export function startRound(state: MatchState, cfg: Config): void {
  const map = MAPS[state.mapIndex];
  state.tiles = map.tiles.slice();
  state.tilesVersion++;
  state.snakes = map.spawns.map((sp, i) => createSnake(i, sp.x, sp.y, sp.heading, cfg));
  state.pickups = [];
  state.missiles = [];
  state.wormholes = [];
  state.saws = [];
  state.pickupTimer = Math.max(1, Math.round(cfg.firstPickupDelay * TICK_RATE));
  state.wormholeTimer = Math.max(1, Math.round(cfg.wormholeInterval * TICK_RATE));
  state.sawTimer = Math.max(1, Math.round(cfg.sawInterval * TICK_RATE));
  rebuildGrid(state);
  state.phase = 'countdown';
  state.phaseTicks = Math.max(1, Math.round(cfg.countdownSeconds * TICK_RATE));
  state.roundTicks = 0;
  state.overtime = false;
  state.inset = 0;
  state.deaths = [];
}

export function rebuildGrid(state: MatchState): void {
  gridClear(state.grid);
  state.snakes.forEach((s, idx) => {
    const t = s.trail;
    for (let i = t.start; i < t.xs.length; i++) gridInsert(state.grid, t.xs[i], t.ys[i], idx, t.baseSeq + i);
  });
}

export function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

/** Next map index: seeded shuffle bags of every map, never the current map twice in a row. */
export function pickNextMap(state: MatchState, mapCount: number): number {
  if (mapCount <= 1) return 0;
  if (state.mapBag.length === 0) {
    const bag = shuffleInPlace(
      Array.from({ length: mapCount }, (_, i) => i),
      state.rng,
    );
    const last = bag.length - 1;
    if (bag[last] === state.mapIndex) {
      bag[last] = bag[0];
      bag[0] = state.mapIndex;
    }
    state.mapBag = bag;
  }
  return state.mapBag.pop()!;
}
