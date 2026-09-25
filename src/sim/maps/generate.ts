import { MAP_COLS, MAP_ROWS } from '../config';
import { rngInt, rngNext, type RngState } from '../rng';
import { cellSpawn, cellsToTiles, type ParsedMap } from './parse';

/**
 * Random maps, built at the same 40×25 cell resolution as the hand-made ones and from the same
 * vocabulary (pillars, walls with gaps, lane pairs, bunkers, a centre block). Every layout has
 * point symmetry through the centre, like the hand-made maps, so neither spawn is favoured: cell
 * (c, r) mirrors to (39−c, 24−r), which is index CELLS−1−i. Everything random comes from the rng
 * passed in, so the same rng state always gives the same map.
 */

export interface GenerateOptions {
  /** 0–1: the block budget as a share of MAX_FILL. */
  density: number;
  /** Attempts before falling back to the empty map (default DEFAULT_TRIES). */
  maxTries?: number;
}

export interface GeneratedMap extends ParsedMap {
  /** The layout at map-cell resolution: MAP_COLS * MAP_ROWS entries, 1 = solid. */
  cells: number[];
}

/** Share of cells solid at density 1. */
export const MAX_FILL = 0.15;
/** Cells kept clear around each spawn (Chebyshev radius). */
export const SPAWN_CLEARANCE = 3;
/** A layout must let a flood fill from one spawn reach this share of the floor. */
export const MIN_REACH = 0.9;
export const DEFAULT_TRIES = 8;
/** Cells between features, and between a feature and the arena edge. */
const MARGIN = 2;
/** Feature placements tried per attempt. */
const PLACEMENTS = 80;
/** A feature may overshoot the block budget by this many cells. */
const BUDGET_SLACK = 6;
const CELLS = MAP_COLS * MAP_ROWS;

/** Where player 1 starts; player 2 gets the point mirror and the opposite heading. */
export interface SpawnLayout {
  name: string;
  c: number;
  r: number;
  /** Degrees, 0 = east, clockwise. */
  heading: number;
}

/** The spawn placements of the five hand-made maps (Open, Pillars, Cross, Bunkers, Lanes). */
export const SPAWN_LAYOUTS: readonly SpawnLayout[] = [
  { name: 'corners', c: 6, r: 5, heading: 0 },
  { name: 'flanks', c: 3, r: 12, heading: 270 },
  { name: 'diagonal', c: 5, r: 4, heading: 90 },
  { name: 'inner', c: 6, r: 12, heading: 0 },
  { name: 'far corners', c: 2, r: 3, heading: 0 },
];

const idx = (c: number, r: number): number => r * MAP_COLS + c;
const mirror = (i: number): number => CELLS - 1 - i;
const colOf = (i: number): number => i % MAP_COLS;
const rowOf = (i: number): number => (i - (i % MAP_COLS)) / MAP_COLS;

/** Cells of a w×h rectangle whose top-left is (c0, r0); the caller keeps it in bounds. */
function rect(c0: number, r0: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) out.push(idx(c, r));
  return out;
}

/** A random top-left for a w×h feature anywhere in bounds (the margins reject it later). */
function place(rng: RngState, w: number, h: number): { c0: number; r0: number } {
  return { c0: rngInt(rng, MAP_COLS - w + 1), r0: rngInt(rng, MAP_ROWS - h + 1) };
}

/** A solid block, 2–4 cells a side (Pillars). */
function pillar(rng: RngState): number[] {
  const w = 2 + rngInt(rng, 3);
  const h = 2 + rngInt(rng, 3);
  const { c0, r0 } = place(rng, w, h);
  return rect(c0, r0, w, h);
}

/** A wall 6–14 long, 1 or 2 thick, with a 2–4 cell gap half the time when it is 10 or longer (Cross, Lanes). */
function wall(rng: RngState): number[] {
  const along = 6 + rngInt(rng, 9);
  const thick = rngNext(rng) < 0.3 ? 2 : 1;
  const horizontal = rngNext(rng) < 0.5;
  const w = horizontal ? along : thick;
  const h = horizontal ? thick : along;
  const { c0, r0 } = place(rng, w, h);
  const cells = rect(c0, r0, w, h);
  if (along < 10 || rngNext(rng) >= 0.5) return cells;
  const gap = 2 + rngInt(rng, 3);
  const at = 2 + rngInt(rng, along - gap - 3);
  return cells.filter((i) => {
    const t = horizontal ? colOf(i) - c0 : rowOf(i) - r0;
    return t < at || t >= at + gap;
  });
}

/** Two parallel walls 5–10 long with a 3–4 cell corridor between them (Lanes). */
function lane(rng: RngState): number[] {
  const along = 5 + rngInt(rng, 6);
  const between = 3 + rngInt(rng, 2);
  const horizontal = rngNext(rng) < 0.5;
  const w = horizontal ? along : between + 2;
  const h = horizontal ? between + 2 : along;
  const { c0, r0 } = place(rng, w, h);
  return horizontal
    ? [...rect(c0, r0, along, 1), ...rect(c0, r0 + between + 1, along, 1)]
    : [...rect(c0, r0, 1, along), ...rect(c0 + between + 1, r0, 1, along)];
}

/** A C-shaped enclosure 5–8 × 5–7 with one whole side open, so the inside is at least 3×3 (Bunkers). */
function bunker(rng: RngState): number[] {
  const w = 5 + rngInt(rng, 4);
  const h = 5 + rngInt(rng, 3);
  const open = rngInt(rng, 4);
  const { c0, r0 } = place(rng, w, h);
  const out: number[] = [];
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const sides = [r === 0, c === w - 1, r === h - 1, c === 0];
      if ((sides[0] || sides[1] || sides[2] || sides[3]) && !sides[open]) out.push(idx(c0 + c, r0 + r));
    }
  }
  return out;
}

/**
 * One feature, weighted walls 4 : lanes 2 : bunkers 3 : pillars 3. With `structure` set, no pillar:
 * the first feature of every map is a wall, a lane pair or a bunker, so no map is pillars alone.
 */
function pickFeature(rng: RngState, structure: boolean): number[] {
  const roll = rngInt(rng, structure ? 9 : 12);
  if (roll < 4) return wall(rng);
  if (roll < 6) return lane(rng);
  if (roll < 9) return bunker(rng);
  return pillar(rng);
}

/** Marks every cell within MARGIN (Chebyshev) of `cells` as off limits to later features. */
function reserve(blocked: number[], cells: readonly number[], radius: number): void {
  for (const i of cells) {
    const c = colOf(i);
    const r = rowOf(i);
    for (let dr = -radius; dr <= radius; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= MAP_ROWS) continue;
      for (let dc = -radius; dc <= radius; dc++) {
        const cc = c + dc;
        if (cc >= 0 && cc < MAP_COLS) blocked[idx(cc, rr)] = 1;
      }
    }
  }
}

function fits(blocked: readonly number[], cells: readonly number[]): boolean {
  for (const i of cells) if (blocked[i] === 1) return false;
  return true;
}

/** True when any cell of `b` is within MARGIN of a cell of `a`. */
function near(a: readonly number[], b: readonly number[]): boolean {
  for (const i of a) {
    const ci = colOf(i);
    const ri = rowOf(i);
    for (const j of b) {
      const dc = colOf(j) - ci;
      const dr = rowOf(j) - ri;
      if (dc <= MARGIN && dc >= -MARGIN && dr <= MARGIN && dr >= -MARGIN) return true;
    }
  }
  return false;
}

function sameCells(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const i of b) if (!set.has(i)) return false;
  return true;
}

/** One layout attempt: features and their point-mirror twins until the block budget is spent. */
function attempt(rng: RngState, density: number, layout: SpawnLayout): number[] {
  const solid = new Array<number>(CELLS).fill(0);
  const blocked = new Array<number>(CELLS).fill(0);
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (c < MARGIN || c >= MAP_COLS - MARGIN || r < MARGIN || r >= MAP_ROWS - MARGIN) blocked[idx(c, r)] = 1;
    }
  }
  const spawn = idx(layout.c, layout.r);
  reserve(blocked, [spawn, mirror(spawn)], SPAWN_CLEARANCE);

  const target = Math.round(density * MAX_FILL * CELLS);
  let count = 0;
  const add = (cells: readonly number[]): void => {
    for (const i of cells) solid[i] = 1;
    reserve(blocked, cells, MARGIN);
    count += cells.length;
  };

  // A centre block (Pillars' hub) most of the time: even width and odd height keep it self-symmetric.
  if (target >= 2 && rngNext(rng) < 0.6) {
    const w = 2 + 2 * rngInt(rng, 2);
    const h = 1 + 2 * rngInt(rng, 2);
    const cells = rect(MAP_COLS / 2 - w / 2, (MAP_ROWS - 1) / 2 - (h - 1) / 2, w, h);
    if (fits(blocked, cells)) add(cells);
  }

  let placed = 0;
  for (let i = 0; i < PLACEMENTS && count < target; i++) {
    const cells = pickFeature(rng, placed === 0);
    if (cells.length * 2 > target - count + BUDGET_SLACK) continue;
    const twin = cells.map(mirror);
    if (!fits(blocked, cells) || !fits(blocked, twin)) continue;
    if (sameCells(cells, twin)) {
      add(cells);
      placed++;
      continue;
    }
    if (near(cells, twin)) continue;
    add(cells);
    add(twin);
    placed++;
  }
  return solid;
}

/** A flood fill from one spawn must reach the other and most of the floor, and no floor cell may be a dead end. */
export function validLayout(solid: readonly number[], spawn1: number, spawn2: number): boolean {
  if (solid[spawn1] === 1 || solid[spawn2] === 1) return false;
  let floor = 0;
  for (let i = 0; i < CELLS; i++) {
    if (solid[i] === 1) continue;
    floor++;
    const c = colOf(i);
    const r = rowOf(i);
    let open = 0;
    if (c > 0 && solid[i - 1] !== 1) open++;
    if (c < MAP_COLS - 1 && solid[i + 1] !== 1) open++;
    if (r > 0 && solid[i - MAP_COLS] !== 1) open++;
    if (r < MAP_ROWS - 1 && solid[i + MAP_COLS] !== 1) open++;
    if (open < 2) return false;
  }
  const seen = new Array<number>(CELLS).fill(0);
  const queue = [spawn1];
  seen[spawn1] = 1;
  let reached = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    reached++;
    const c = colOf(i);
    const r = rowOf(i);
    const next = [c > 0 ? i - 1 : -1, c < MAP_COLS - 1 ? i + 1 : -1, r > 0 ? i - MAP_COLS : -1, r < MAP_ROWS - 1 ? i + MAP_COLS : -1];
    for (const j of next) {
      if (j < 0 || seen[j] === 1 || solid[j] === 1) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen[spawn2] === 1 && reached >= MIN_REACH * floor;
}

/**
 * A fresh symmetric layout from the rng: up to `maxTries` attempts, each validated; when all fail,
 * the empty map with the last spawn layout drawn. Draws from the rng on every attempt, so the map
 * is a pure function of the rng state and the options.
 */
export function generateMap(rng: RngState, options: GenerateOptions): GeneratedMap {
  const density = Math.max(0, Math.min(1, options.density));
  const tries = options.maxTries ?? DEFAULT_TRIES;
  let layout = SPAWN_LAYOUTS[0];
  let cells: number[] | null = null;
  for (let t = 0; t < tries && cells === null; t++) {
    layout = SPAWN_LAYOUTS[rngInt(rng, SPAWN_LAYOUTS.length)];
    const candidate = attempt(rng, density, layout);
    const spawn = idx(layout.c, layout.r);
    if (validLayout(candidate, spawn, mirror(spawn))) cells = candidate;
  }
  const name = cells === null ? 'Random (fallback)' : 'Random';
  const solid = cells ?? new Array<number>(CELLS).fill(0);
  const spawns = [
    cellSpawn(layout.c, layout.r, layout.heading),
    cellSpawn(MAP_COLS - 1 - layout.c, MAP_ROWS - 1 - layout.r, (layout.heading + 180) % 360),
  ];
  return { name, tiles: cellsToTiles(solid), spawns, cells: solid };
}
