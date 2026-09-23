# SnakeBoom M2 (Boom) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "boom". Pickups spawn in the arena. A bomb pickup fills your one item slot, and Use drops timed bombs. A blast kills heads (yours too), punches holes in bodies, destroys blocks and sets off chain reactions. Four new hand-made maps rotate each round. All of it comes with explosion effects, sounds and HUD item slots.

**Architecture:** There are three new pure sim modules: `items.ts` (the slot and Use), `pickups.ts` (spawn, expiry and collection) and `bombs.ts` (fuses, blasts and chains). `step.ts` runs them in the spec's tick order. Blast victims and collision victims are applied together, so simultaneous deaths stay fair. The client gets pickup and bomb views, explosion effects, per-snake hole redraws and a HUD item slot. Blocks are redrawn whenever `tilesVersion` changes.

**Tech Stack:** Same as M1: TypeScript, Vite, Vitest, PixiJS 8, ZzFX and lil-gui.

**Spec:** `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`. This plan implements milestone **M2** (§3.4 pickups, §3.5 the Bomb item, §3.6 bombs and blasts, §3.8 maps, and the M2 parts of §4.1–4.6). The M1 plan is `docs/superpowers/plans/2026-09-23-snakeboom-m1-duel.md`.

## Global Constraints

- Every M1 constraint still applies: the arena, tile and map sizes, the 60 Hz tick, sim purity (enforced by `purity.test.ts`), plain-data state, the colors and key bindings, ZzFX-only audio, and exact dependency pins.
- New M2 defaults, copied from spec §6:
  - `maxPickups` 2, `firstPickupDelay` 3 s, `pickupInterval` 6 s, `pickupLifetime` 15 s, `pickupRadius` 14
  - `pickupMinHeadDistance` 150, `pickupClearance` 40, pickup weights: bomb 35
  - `bombCharges` 3, `bombDropCooldown` 0.3 s, `bombFuse` 1.5 s, `blastRadius` 70, `chainDelay` 0.12 s
- Pickup colors: Bomb `#ff4d2e`. Bomb body `#ff3030` with a white-hot core.
- Tick order (spec §5.3): phase timers → item timers → Use → move → collect pickups → bombs → collisions → apply deaths and resolve the round → spawn and expire pickups.
- Work happens on branch `v1-prototype`, with one commit per task, and every commit carries the two trailers from the M1 plan. At the end: open a PR, merge it, and tag `v0.2.0` (the user wants semver, and asked for PRs to be merged as each milestone lands).
- **Code-block convention:** ` ```ts file=<path> ` holds a complete file. ` ```edit file=<path> ` holds exact-match hunks in the form `<<<< OLD` / `==== NEW` / `>>>>`, and each OLD must match exactly once.

## Review Focus

These are inputs and conditions the spec implies but that no feature test covers, listed most likely first. Each has a test in the task that owns the code.

1. **Pressing Use while paused.** The item must not fire when the game resumes. Tested in Task 6 (`KeyboardInput.clearLatches`).
2. **A big pile of bombs.** When 10 bombs are dropped together, each must explode exactly once, with no endless re-triggering. Tested in Task 4.
3. **Blasts at the arena edges and corners.** A blast circle can partly leave the arena. That must never touch out-of-range tiles, and a blast entirely outside must hit nothing. Tested in Task 1.
4. **A round ending mid-chain, or with pickups on the field.** None of it may carry into the next round. Tested in Task 5.
5. **Both heads reaching the same pickup on the same tick.** Exactly one snake gets it, and the closest one wins. Tested in Task 3.

## File Structure

```
src/sim/arena.ts            + destroyTilesInCircle (shared tile-touch helper)
src/sim/maps/{pillars,cross,bunkers,lanes}.ts   new maps; maps/index.ts lists all five
src/sim/config.ts           + PickupKind, pickup and bomb tunables
src/sim/types.ts            + ItemState, PickupState, BombState; new SnakeState/MatchState fields; new events
src/sim/snake.ts            createSnake gains item/useCooldown/holeVersion
src/sim/state.ts            createMatch/startRound reset pickups, bombs, pickup timer, tilesVersion
src/sim/items.ts            createItem, tickItemTimers, useItem
src/sim/pickups.ts          pickKind, findSpawnPoint, updatePickups, collectPickups
src/sim/bombs.ts            updateBombs (fuses, blasts, holes, tiles, chains)
src/sim/step.ts             spec tick order; blast + collision deaths applied together
src/sim/invariants.ts       + pickup, bomb, tile and item checks
src/sim/bots/simple-bot.ts  seeks pickups, drops bombs near the opponent
scripts/soak.ts             + explosions and pickups statistics
src/client/text.ts          + describeItem
src/client/input.ts         + clearLatches
src/client/screens.ts       pause/resume restores the round banner
src/client/colors.ts        + PICKUP_COLORS
src/client/render/pickups.ts, render/bombs.ts   new views
src/client/render/snakes.ts redraw every chunk when holeVersion changes
src/client/render/fx.ts     + explosion, flash, pickupBurst
src/client/render/renderer.ts  pickups, bombs, tilesVersion, animation time
src/client/hud.ts, style.css   item slot
src/client/audio.ts         + pickupSpawn, pickup, bombDrop, explosion (pitch per chain link), tick
src/client/tuning.ts        + Pickups and Bombs folders
src/client/main.ts          new events, fuse ticks, pause clears latches
```

---

### Task 1: Blast-proof tiles and four new maps

**Files:**
- Modify: `src/sim/arena.ts` (full new version), `src/sim/maps/index.ts` (full new version), `src/sim/maps/maps.test.ts` (edit)
- Create: `src/sim/maps/pillars.ts`, `src/sim/maps/cross.ts`, `src/sim/maps/bunkers.ts`, `src/sim/maps/lanes.ts`
- Test: `src/sim/arena.test.ts` (full new version)

**Interfaces:**
- Produces: `destroyTilesInCircle(tiles, x, y, r): number[]`. It clears every solid tile the circle touches and returns their indices in ascending order. `MAPS` becomes `[Open, Pillars, Cross, Bunkers, Lanes]`.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/arena.test.ts
import { describe, expect, it } from 'vitest';
import { circleHitsTiles, circleHitsWall, createTiles, destroyTilesInCircle, setTile, tileSolid } from './arena';

describe('arena', () => {
  it('detects the arena border', () => {
    expect(circleHitsWall(7, 500, 7)).toBe(false);
    expect(circleHitsWall(6.9, 500, 7)).toBe(true);
    expect(circleHitsWall(1593, 500, 7)).toBe(false);
    expect(circleHitsWall(1593.1, 500, 7)).toBe(true);
    expect(circleHitsWall(800, 6.5, 7)).toBe(true);
    expect(circleHitsWall(800, 993.5, 7)).toBe(true);
    expect(circleHitsWall(Number.NaN, 500, 7)).toBe(true);
  });

  it('detects circles touching solid tiles', () => {
    const tiles = createTiles();
    setTile(tiles, 10, 10, true); // covers x 200..220, y 200..220
    expect(tileSolid(tiles, 10, 10)).toBe(true);
    expect(tileSolid(tiles, -1, 0)).toBe(false);
    expect(circleHitsTiles(tiles, 210, 210, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 226, 210, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 228, 210, 7)).toBe(false);
    expect(circleHitsTiles(tiles, 224, 224, 7)).toBe(true);
    expect(circleHitsTiles(tiles, 226, 226, 7)).toBe(false);
  });

  it('destroys every solid tile a blast touches and reports them in order', () => {
    const tiles = createTiles();
    setTile(tiles, 10, 10, true);
    setTile(tiles, 11, 10, true);
    setTile(tiles, 20, 20, true);
    expect(destroyTilesInCircle(tiles, 215, 210, 12)).toEqual([10 * 80 + 10, 10 * 80 + 11]);
    expect(tileSolid(tiles, 10, 10)).toBe(false);
    expect(tileSolid(tiles, 11, 10)).toBe(false);
    expect(tileSolid(tiles, 20, 20)).toBe(true);
    expect(destroyTilesInCircle(tiles, 215, 210, 12)).toEqual([]);
  });

  // Review Focus 3: blasts at the edges and corners.
  it('handles blasts at the arena edges and corners', () => {
    const tiles = createTiles();
    setTile(tiles, 0, 0, true);
    setTile(tiles, 79, 49, true);
    expect(destroyTilesInCircle(tiles, 0, 0, 70)).toEqual([0]);
    expect(destroyTilesInCircle(tiles, 1600, 1000, 70)).toEqual([49 * 80 + 79]);
    expect(destroyTilesInCircle(tiles, -500, -500, 70)).toEqual([]);
    expect(destroyTilesInCircle(tiles, Number.NaN, 10, 70)).toEqual([]);
  });
});
```

```edit file=src/sim/maps/maps.test.ts
<<<< OLD
  it('parses every map, Open first', () => {
    expect(MAPS).toHaveLength(MAP_DEFS.length);
    expect(MAPS[0].name).toBe('Open');
  });
==== NEW
  it('parses every map, Open first', () => {
    expect(MAPS).toHaveLength(MAP_DEFS.length);
    expect(MAPS.map((m) => m.name)).toEqual(['Open', 'Pillars', 'Cross', 'Bunkers', 'Lanes']);
  });
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/arena.test.ts src/sim/maps`
Expected: FAIL. `destroyTilesInCircle` is not exported, and the map names are `['Open']`.

- [ ] **Step 3: Implement**

```ts file=src/sim/arena.ts
import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_ROWS, TILE_SIZE } from './config';

export function createTiles(): number[] {
  return new Array<number>(TILE_COLS * TILE_ROWS).fill(0);
}

export function setTile(tiles: number[], tx: number, ty: number, solid: boolean): void {
  if (tx < 0 || ty < 0 || tx >= TILE_COLS || ty >= TILE_ROWS) return;
  tiles[ty * TILE_COLS + tx] = solid ? 1 : 0;
}

export function tileSolid(tiles: number[], tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < TILE_COLS && ty < TILE_ROWS && tiles[ty * TILE_COLS + tx] === 1;
}

/** True when a circle crosses the arena border (or its position is NaN). */
export function circleHitsWall(x: number, y: number, r: number): boolean {
  return !(x - r >= 0 && y - r >= 0 && x + r <= ARENA_WIDTH && y + r <= ARENA_HEIGHT);
}

/** Visits each solid tile a circle touches, in ascending index order; stop early by returning true. */
function forEachSolidTileTouching(
  tiles: readonly number[],
  x: number,
  y: number,
  r: number,
  visit: (index: number) => boolean | void,
): void {
  const tx0 = Math.max(0, Math.floor((x - r) / TILE_SIZE));
  const tx1 = Math.min(TILE_COLS - 1, Math.floor((x + r) / TILE_SIZE));
  const ty0 = Math.max(0, Math.floor((y - r) / TILE_SIZE));
  const ty1 = Math.min(TILE_ROWS - 1, Math.floor((y + r) / TILE_SIZE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const index = ty * TILE_COLS + tx;
      if (tiles[index] !== 1) continue;
      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;
      const nx = x < left ? left : x > left + TILE_SIZE ? left + TILE_SIZE : x;
      const ny = y < top ? top : y > top + TILE_SIZE ? top + TILE_SIZE : y;
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r && visit(index) === true) return;
    }
  }
}

export function circleHitsTiles(tiles: readonly number[], x: number, y: number, r: number): boolean {
  const found = { hit: false };
  forEachSolidTileTouching(tiles, x, y, r, () => {
    found.hit = true;
    return true;
  });
  return found.hit;
}

/** Clears every solid tile a circle touches; returns the cleared indices in ascending order. */
export function destroyTilesInCircle(tiles: number[], x: number, y: number, r: number): number[] {
  const destroyed: number[] = [];
  forEachSolidTileTouching(tiles, x, y, r, (index) => {
    destroyed.push(index);
  });
  for (const index of destroyed) tiles[index] = 0;
  return destroyed;
}
```

```ts file=src/sim/maps/pillars.ts
import type { MapDef } from './parse';

export const pillars: MapDef = {
  name: 'Pillars',
  spawnHeadings: [270, 90],
  grid: `
    ........................................
    ........................................
    ........................................
    ........................................
    ..........###..............###..........
    ..........###..............###..........
    ..........###..............###..........
    ........................................
    ........................................
    ........................................
    ........................................
    ..................####..................
    ...1..............####..............2...
    ..................####..................
    ........................................
    ........................................
    ........................................
    ........................................
    ..........###..............###..........
    ..........###..............###..........
    ..........###..............###..........
    ........................................
    ........................................
    ........................................
    ........................................
  `,
};
```

```ts file=src/sim/maps/cross.ts
import type { MapDef } from './parse';

export const cross: MapDef = {
  name: 'Cross',
  spawnHeadings: [90, 270],
  grid: `
    ........................................
    ........................................
    ........................................
    ...................##...................
    .....1.............##...................
    ...................##...................
    ...................##...................
    ...................##...................
    ...................##...................
    ........................................
    ........................................
    ........................................
    ........########........########........
    ........................................
    ........................................
    ........................................
    ...................##...................
    ...................##...................
    ...................##...................
    ...................##...................
    ...................##.............2.....
    ...................##...................
    ........................................
    ........................................
    ........................................
  `,
};
```

```ts file=src/sim/maps/bunkers.ts
import type { MapDef } from './parse';

export const bunkers: MapDef = {
  name: 'Bunkers',
  spawnHeadings: [0, 180],
  grid: `
    ........................................
    ........................................
    ........................................
    ........................................
    ...................##...................
    ...................##...................
    ........................................
    ........................................
    ...#######....................#######...
    ...#................................#...
    ...#................................#...
    ...#................................#...
    ...#..1..........................2..#...
    ...#................................#...
    ...#................................#...
    ...#................................#...
    ...#######....................#######...
    ........................................
    ........................................
    ...................##...................
    ...................##...................
    ........................................
    ........................................
    ........................................
    ........................................
  `,
};
```

```ts file=src/sim/maps/lanes.ts
import type { MapDef } from './parse';

export const lanes: MapDef = {
  name: 'Lanes',
  spawnHeadings: [0, 180],
  grid: `
    ........................................
    ........................................
    ........................................
    ..1.....................................
    ........................................
    ........................................
    ....##############....##############....
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ..........######........######..........
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ....##############....##############....
    ........................................
    ........................................
    .....................................2..
    ........................................
    ........................................
    ........................................
  `,
};
```

```ts file=src/sim/maps/index.ts
import { bunkers } from './bunkers';
import { cross } from './cross';
import { lanes } from './lanes';
import { open } from './open';
import { parseMap, type MapDef, type ParsedMap } from './parse';
import { pillars } from './pillars';

/** Round 1 is always Open (index 0); later rounds shuffle through all of them. */
export const MAP_DEFS: MapDef[] = [open, pillars, cross, bunkers, lanes];
export const MAPS: ParsedMap[] = MAP_DEFS.map(parseMap);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS. Every new map passes the size, symmetry and connectivity tests, and the typecheck is clean.

- [ ] **Step 5: Commit** with message `feat(sim): blast-proof tile destruction and the Pillars, Cross, Bunkers and Lanes maps` (plus the trailers).

---

### Task 2: The item slot and dropping bombs

**Files:**
- Modify: `src/sim/config.ts` (full), `src/sim/types.ts` (full), `src/sim/state.ts` (full), `src/sim/snake.ts` (edit)
- Create: `src/sim/items.ts`
- Test: `src/sim/items.test.ts`

**Interfaces:**
- Consumes: `createMatch`, `TICK_RATE`.
- Produces:
  - `type PickupKind = 'bomb'`, and `Config` gains the new pickup and bomb fields.
  - New types: `ItemState { kind; charges }`, `PickupState { id; kind; x; y; ttl }`, `BombState { id; owner; x; y; fuse; maxFuse; chainDepth }`.
  - New `SnakeState` fields: `item`, `useCooldown`, `holeVersion`.
  - New `MatchState` fields: `tilesVersion`, `pickups`, `bombs`, `pickupTimer`, `nextId`.
  - New events: `pickupSpawned`, `pickupCollected`, `pickupExpired`, `bombDropped`, `explosion{..., tilesDestroyed: number[]}`.
  - Item functions: `createItem(kind, cfg)`, `tickItemTimers(state)`, `useItem(state, idx, cfg, events)`.

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/items.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { createItem, tickItemTimers, useItem } from './items';
import { createMatch } from './state';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;

function withBombs(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  s.snakes[0].item = createItem('bomb', cfg);
  return s;
}

describe('items', () => {
  it('a bomb pickup holds bombCharges bombs', () => {
    expect(createItem('bomb', cfg)).toEqual({ kind: 'bomb', charges: 3 });
  });

  it('drops a bomb at the head with a full fuse and reports it', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    const { x, y } = s.snakes[0];
    useItem(s, 0, cfg, events);
    const fuse = Math.round(cfg.bombFuse * TICK_RATE);
    expect(s.bombs).toEqual([{ id: 1, owner: 0, x, y, fuse, maxFuse: fuse, chainDepth: 0 }]);
    expect(events).toEqual([{ type: 'bombDropped', id: 1, player: 0, x, y }]);
    expect(s.snakes[0].item).toEqual({ kind: 'bomb', charges: 2 });
  });

  it('waits bombDropCooldown between drops', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(1);
    for (let t = 0; t < Math.round(cfg.bombDropCooldown * TICK_RATE); t++) tickItemTimers(s);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(2);
  });

  it('empties the slot after the last bomb', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    for (let k = 0; k < 3; k++) {
      useItem(s, 0, cfg, events);
      s.snakes[0].useCooldown = 0;
    }
    expect(s.bombs).toHaveLength(3);
    expect(s.snakes[0].item).toBeNull();
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(3);
  });

  it('does nothing without an item', () => {
    const s = createMatch(cfg, 1);
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(s.bombs).toEqual([]);
    expect(events).toEqual([]);
  });

  it('starts every round with empty slots, no bombs and the first pickup scheduled', () => {
    const s = createMatch(cfg, 1);
    expect(s.snakes.map((sn) => [sn.item, sn.useCooldown, sn.holeVersion])).toEqual([
      [null, 0, 0],
      [null, 0, 0],
    ]);
    expect(s.pickups).toEqual([]);
    expect(s.bombs).toEqual([]);
    expect(s.pickupTimer).toBe(Math.round(cfg.firstPickupDelay * TICK_RATE));
    expect(s.nextId).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/items.test.ts`
Expected: FAIL with "Cannot find module './items'".

- [ ] **Step 3: Implement**

```ts file=src/sim/config.ts
export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1000;
export const TILE_SIZE = 20;
export const TILE_COLS = 80;
export const TILE_ROWS = 50;
export const MAP_CELL = 40;
export const MAP_COLS = 40;
export const MAP_ROWS = 25;
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** What a pickup can contain. M3 adds the power-ups. */
export type PickupKind = 'bomb';

/** Tunable gameplay values. Seconds and world units unless noted. */
export interface Config {
  snakeRadius: number;
  baseSpeed: number;
  /** Radians per second. */
  turnRate: number;
  /** Newest path length of your own trail that can't kill you. */
  neckLength: number;
  startLength: number;
  growthPerSecond: number;
  overtimeAt: number;
  overtimeGrowthMultiplier: number;
  roundMaxSeconds: number;
  boostMultiplier: number;
  /** Seconds of boosting that empty a full meter. */
  boostMeterSeconds: number;
  /** Seconds (key released) that refill an empty meter. */
  boostRefillSeconds: number;
  maxPickups: number;
  firstPickupDelay: number;
  pickupInterval: number;
  pickupLifetime: number;
  pickupRadius: number;
  /** Pickups never spawn closer than this to a head. */
  pickupMinHeadDistance: number;
  /** Pickups spawn at least this far from walls, blocks, bodies, bombs and other pickups. */
  pickupClearance: number;
  /** Relative spawn chance per kind. */
  pickupWeights: Record<PickupKind, number>;
  /** Bombs in one bomb pickup. */
  bombCharges: number;
  bombDropCooldown: number;
  bombFuse: number;
  blastRadius: number;
  /** Fuse given to a bomb caught in another bomb's blast. */
  chainDelay: number;
  winsToWin: number;
  countdownSeconds: number;
  roundOverSeconds: number;
}

export const DEFAULT_CONFIG: Config = {
  snakeRadius: 7,
  baseSpeed: 170,
  turnRate: 3.4,
  neckLength: 24,
  startLength: 120,
  growthPerSecond: 40,
  overtimeAt: 150,
  overtimeGrowthMultiplier: 3,
  roundMaxSeconds: 300,
  boostMultiplier: 1.6,
  boostMeterSeconds: 2,
  boostRefillSeconds: 6,
  maxPickups: 2,
  firstPickupDelay: 3,
  pickupInterval: 6,
  pickupLifetime: 15,
  pickupRadius: 14,
  pickupMinHeadDistance: 150,
  pickupClearance: 40,
  pickupWeights: { bomb: 35 },
  bombCharges: 3,
  bombDropCooldown: 0.3,
  bombFuse: 1.5,
  blastRadius: 70,
  chainDelay: 0.12,
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
};
```

```ts file=src/sim/types.ts
import type { PickupKind } from './config';
import type { RngState } from './rng';

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

/** Listed in reporting priority order (spec 3.3). */
export type DeathCause = 'blast' | 'headOn' | 'body' | 'self' | 'obstacle' | 'wall';

export interface PlayerInput {
  turn: -1 | 0 | 1;
  boost: boolean;
  /** Use was pressed at least once since the previous tick. */
  use: boolean;
}

export const NO_INPUT: PlayerInput = { turn: 0, boost: false, use: false };

/** Points the head has passed through, oldest first. Indices before `start` are trimmed. */
export interface Trail {
  xs: number[];
  ys: number[];
  /** Cumulative path length at each point; strictly non-decreasing. */
  cum: number[];
  /** false marks a hole: not solid and not drawn. */
  solid: boolean[];
  /** Array index of the tail (first live point). */
  start: number;
  /** Sequence number of array index 0, so seq = baseSeq + index survives compaction. */
  baseSeq: number;
}

/** Uniform spatial hash of trail points. Each entry packs seq * 8 + snakeIndex. */
export interface Grid {
  cols: number;
  rows: number;
  cellSize: number;
  cells: number[][];
}

/** What a snake holds in its single item slot. */
export interface ItemState {
  kind: PickupKind;
  /** Uses left; the slot empties at 0. */
  charges: number;
}

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  /** Ticks until it disappears. */
  ttl: number;
}

export interface BombState {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Ticks until it explodes. */
  fuse: number;
  /** The fuse it started from, for drawing the countdown ring. */
  maxFuse: number;
  /** 0 for a dropped bomb; n for the nth link of a chain reaction. */
  chainDepth: number;
}

export interface SnakeState {
  id: number;
  alive: boolean;
  x: number;
  y: number;
  /** Head position one tick ago, for render interpolation. */
  prevX: number;
  prevY: number;
  /** Radians, 0 = east, clockwise positive (y points down). */
  heading: number;
  targetLength: number;
  /** 0..1 */
  boostMeter: number;
  boosting: boolean;
  trail: Trail;
  item: ItemState | null;
  /** Ticks until Use works again. */
  useCooldown: number;
  /** Bumped whenever a blast punches holes in this trail, so the renderer redraws it. */
  holeVersion: number;
}

export interface DeathRecord {
  player: number;
  cause: DeathCause;
  /** Owner of the body or bomb that killed; the victim for self-kills; null for walls and blocks. */
  killer: number | null;
  x: number;
  y: number;
}

export interface MatchState {
  tick: number;
  phase: Phase;
  /** Ticks left in countdown or roundOver. */
  phaseTicks: number;
  /** 1-based round number. */
  round: number;
  /** Ticks since GO in the current round. */
  roundTicks: number;
  overtime: boolean;
  scores: number[];
  matchWinner: number | null;
  lastRoundWinner: number | null;
  mapIndex: number;
  /** Remaining shuffled map indices; popped from the end. */
  mapBag: number[];
  rng: RngState;
  /** TILE_COLS * TILE_ROWS entries, 1 = solid. Replaced (new array) at each round start. */
  tiles: number[];
  /** Bumped whenever tiles change (round start or blasts). */
  tilesVersion: number;
  snakes: SnakeState[];
  grid: Grid;
  /** Deaths so far this round. */
  deaths: DeathRecord[];
  pickups: PickupState[];
  bombs: BombState[];
  /** Ticks until the next pickup spawn attempt. */
  pickupTimer: number;
  /** Next id for pickups and bombs. */
  nextId: number;
}

export type SimEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'overtime' }
  | { type: 'boostStarted'; player: number }
  | ({ type: 'death' } & DeathRecord)
  | { type: 'roundOver'; winner: number | null; deaths: DeathRecord[] }
  | { type: 'matchOver'; winner: number }
  | { type: 'pickupSpawned'; id: number; kind: PickupKind; x: number; y: number }
  | { type: 'pickupCollected'; id: number; kind: PickupKind; player: number }
  | { type: 'pickupExpired'; id: number }
  | { type: 'bombDropped'; id: number; player: number; x: number; y: number }
  | {
      type: 'explosion';
      id: number;
      owner: number;
      x: number;
      y: number;
      radius: number;
      chainDepth: number;
      tilesDestroyed: number[];
    };
```

```ts file=src/sim/state.ts
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
    bombs: [],
    pickupTimer: 0,
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
  state.bombs = [];
  state.pickupTimer = Math.max(1, Math.round(cfg.firstPickupDelay * TICK_RATE));
  rebuildGrid(state);
  state.phase = 'countdown';
  state.phaseTicks = Math.max(1, Math.round(cfg.countdownSeconds * TICK_RATE));
  state.roundTicks = 0;
  state.overtime = false;
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
```

```edit file=src/sim/snake.ts
<<<< OLD
    boostMeter: 1,
    boosting: false,
    trail,
  };
==== NEW
    boostMeter: 1,
    boosting: false,
    trail,
    item: null,
    useCooldown: 0,
    holeVersion: 0,
  };
>>>>
```

```ts file=src/sim/items.ts
import { TICK_RATE, type Config, type PickupKind } from './config';
import type { ItemState, MatchState, SimEvent } from './types';

export function createItem(kind: PickupKind, cfg: Config): ItemState {
  return { kind, charges: kind === 'bomb' ? Math.max(1, Math.round(cfg.bombCharges)) : 1 };
}

/** Counts down per-snake item timers. Call once per playing tick. */
export function tickItemTimers(state: MatchState): void {
  for (const s of state.snakes) if (s.useCooldown > 0) s.useCooldown--;
}

/** Uses the held item. Bombs drop at the head, at most one per bombDropCooldown. */
export function useItem(state: MatchState, idx: number, cfg: Config, events: SimEvent[]): void {
  const s = state.snakes[idx];
  const item = s.item;
  if (!item || s.useCooldown > 0) return;
  switch (item.kind) {
    case 'bomb': {
      const fuse = Math.max(1, Math.round(cfg.bombFuse * TICK_RATE));
      const id = state.nextId++;
      state.bombs.push({ id, owner: idx, x: s.x, y: s.y, fuse, maxFuse: fuse, chainDepth: 0 });
      events.push({ type: 'bombDropped', id, player: idx, x: s.x, y: s.y });
      s.useCooldown = Math.round(cfg.bombDropCooldown * TICK_RATE);
      break;
    }
  }
  item.charges--;
  if (item.charges <= 0) s.item = null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS. All M1 sim tests still pass, and the typecheck is clean.

- [ ] **Step 5: Commit** with message `feat(sim): item slot, bomb drops and the M2 state model` (plus the trailers).

---
### Task 3: Pickups — spawn, expire, collect

**Files:**
- Create: `src/sim/pickups.ts`
- Test: `src/sim/pickups.test.ts`

**Interfaces:**
- Consumes: `circleHitsTiles`, `forEachSolidPointNear`, `createItem`, `rngNext`, `rngRange`, `ARENA_*`, `TICK_RATE`.
- Produces:
  - `pickKind(weights, rng): PickupKind | null`
  - `findSpawnPoint(state, cfg): {x, y} | null` (up to 50 seeded tries)
  - `updatePickups(state, cfg, events)`, which ages pickups, expires them, and spawns on the timer
  - `collectPickups(state, cfg, events)`: only an empty slot collects, and the closest head wins

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/pickups.test.ts
import { describe, expect, it } from 'vitest';
import { circleHitsTiles, setTile } from './arena';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { collectPickups, findSpawnPoint, pickKind, updatePickups } from './pickups';
import { createRng } from './rng';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG };

function playing(c: Config = cfg, seed = 3): MatchState {
  const s = createMatch(c, seed);
  s.phase = 'playing';
  return s;
}

function tick(s: MatchState, n: number, c: Config = cfg): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) updatePickups(s, c, events);
  return events;
}

describe('pickups', () => {
  it('picks kinds by weight and returns null when no weight is positive', () => {
    const rng = createRng(1);
    expect(pickKind({ bomb: 5 }, rng)).toBe('bomb');
    expect(pickKind({ bomb: 0 }, rng)).toBeNull();
  });

  it('spawns the first pickup after firstPickupDelay, then one per interval up to maxPickups', () => {
    const s = playing();
    const first = Math.round(cfg.firstPickupDelay * TICK_RATE);
    const interval = Math.round(cfg.pickupInterval * TICK_RATE);
    expect(tick(s, first - 1)).toEqual([]);
    const spawned = tick(s, 1);
    expect(spawned).toEqual([expect.objectContaining({ type: 'pickupSpawned', kind: 'bomb' })]);
    tick(s, interval);
    expect(s.pickups).toHaveLength(2);
    tick(s, interval);
    expect(s.pickups).toHaveLength(2);
  });

  it('expires pickups after pickupLifetime', () => {
    const c = { ...cfg, firstPickupDelay: 0, pickupLifetime: 1, pickupInterval: 100 };
    const s = playing(c);
    tick(s, 1, c);
    expect(s.pickups).toHaveLength(1);
    const id = s.pickups[0].id;
    expect(tick(s, TICK_RATE, c)).toContainEqual({ type: 'pickupExpired', id });
    expect(s.pickups).toEqual([]);
  });

  it('spawns clear of heads, blocks and bodies', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = playing(cfg, seed);
      for (let tx = 30; tx < 50; tx++) for (let ty = 20; ty < 30; ty++) setTile(s.tiles, tx, ty, true);
      const body = s.snakes[1];
      body.trail = createTrail();
      for (let x = 100; x <= 1500; x += 4) trailPush(body.trail, x, 800);
      body.x = 1500;
      body.y = 800;
      rebuildGrid(s);
      const spot = findSpawnPoint(s, cfg);
      if (!spot) continue;
      for (const sn of s.snakes) {
        expect(Math.hypot(sn.x - spot.x, sn.y - spot.y)).toBeGreaterThanOrEqual(cfg.pickupMinHeadDistance);
      }
      expect(circleHitsTiles(s.tiles, spot.x, spot.y, cfg.pickupClearance)).toBe(false);
      if (spot.x >= 100 && spot.x <= 1500) expect(Math.abs(spot.y - 800)).toBeGreaterThanOrEqual(39);
    }
  });

  // Review Focus 5: both heads reach the same pickup on the same tick.
  it('gives a shared pickup to the closer head only', () => {
    const s = playing();
    const [a, b] = s.snakes;
    s.pickups = [{ id: 50, kind: 'bomb', x: 500, y: 500, ttl: 100 }];
    Object.assign(a, { x: 490, y: 500 });
    Object.assign(b, { x: 505, y: 500 });
    const events: SimEvent[] = [];
    collectPickups(s, cfg, events);
    expect(events).toEqual([{ type: 'pickupCollected', id: 50, kind: 'bomb', player: 1 }]);
    expect(b.item).toEqual({ kind: 'bomb', charges: 3 });
    expect(a.item).toBeNull();
    expect(s.pickups).toEqual([]);
  });

  it('leaves a pickup alone when the head touching it already holds an item', () => {
    const s = playing();
    const a = s.snakes[0];
    a.item = { kind: 'bomb', charges: 1 };
    Object.assign(a, { x: 500, y: 500 });
    s.pickups = [{ id: 7, kind: 'bomb', x: 505, y: 500, ttl: 100 }];
    const events: SimEvent[] = [];
    collectPickups(s, cfg, events);
    expect(events).toEqual([]);
    expect(s.pickups).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/pickups.test.ts`
Expected: FAIL with "Cannot find module './pickups'".

- [ ] **Step 3: Implement**

```ts file=src/sim/pickups.ts
import { circleHitsTiles } from './arena';
import { forEachSolidPointNear } from './collision';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config, type PickupKind } from './config';
import { createItem } from './items';
import { rngNext, rngRange, type RngState } from './rng';
import type { MatchState, PickupState, SimEvent } from './types';

const SPAWN_TRIES = 50;

function dist2(p: { x: number; y: number }, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

/** Weighted random kind among positive weights (in key order); null when none is positive. */
export function pickKind(weights: Record<PickupKind, number>, rng: RngState): PickupKind | null {
  const kinds = (Object.keys(weights) as PickupKind[]).filter((k) => weights[k] > 0);
  const total = kinds.reduce((sum, k) => sum + weights[k], 0);
  if (total <= 0) return null;
  let roll = rngNext(rng) * total;
  for (const k of kinds) {
    roll -= weights[k];
    if (roll < 0) return k;
  }
  return kinds[kinds.length - 1];
}

/** Clear of walls, blocks, bodies, bombs and other pickups, and far from every head. */
function isClear(state: MatchState, cfg: Config, x: number, y: number): boolean {
  const c = cfg.pickupClearance;
  if (circleHitsTiles(state.tiles, x, y, c)) return false;
  const probe = { body: false };
  forEachSolidPointNear(state, x, y, c, () => {
    probe.body = true;
  });
  if (probe.body) return false;
  for (const b of state.bombs) if (dist2(b, x, y) < c * c) return false;
  for (const p of state.pickups) if (dist2(p, x, y) < c * c) return false;
  const h = cfg.pickupMinHeadDistance;
  for (const s of state.snakes) if (s.alive && dist2(s, x, y) < h * h) return false;
  return true;
}

/** A random legal spot for a pickup, or null after SPAWN_TRIES misses. */
export function findSpawnPoint(state: MatchState, cfg: Config): { x: number; y: number } | null {
  const c = cfg.pickupClearance;
  for (let t = 0; t < SPAWN_TRIES; t++) {
    const x = rngRange(state.rng, c, ARENA_WIDTH - c);
    const y = rngRange(state.rng, c, ARENA_HEIGHT - c);
    if (isClear(state, cfg, x, y)) return { x, y };
  }
  return null;
}

/** Ages and expires pickups, and spawns a new one every pickupInterval. Call once per playing tick. */
export function updatePickups(state: MatchState, cfg: Config, events: SimEvent[]): void {
  for (const p of state.pickups) p.ttl--;
  if (state.pickups.some((p) => p.ttl <= 0)) {
    for (const p of state.pickups) if (p.ttl <= 0) events.push({ type: 'pickupExpired', id: p.id });
    state.pickups = state.pickups.filter((p) => p.ttl > 0);
  }

  state.pickupTimer--;
  if (state.pickupTimer > 0) return;
  state.pickupTimer = Math.max(1, Math.round(cfg.pickupInterval * TICK_RATE));
  if (state.pickups.length >= cfg.maxPickups) return;
  const kind = pickKind(cfg.pickupWeights, state.rng);
  if (!kind) return;
  const spot = findSpawnPoint(state, cfg);
  if (!spot) return;
  const pickup: PickupState = {
    id: state.nextId++,
    kind,
    x: spot.x,
    y: spot.y,
    ttl: Math.max(1, Math.round(cfg.pickupLifetime * TICK_RATE)),
  };
  state.pickups.push(pickup);
  events.push({ type: 'pickupSpawned', id: pickup.id, kind, x: pickup.x, y: pickup.y });
}

/** Heads with an empty slot collect pickups they touch; when both reach one, the closer head wins. */
export function collectPickups(state: MatchState, cfg: Config, events: SimEvent[]): void {
  if (state.pickups.length === 0) return;
  const reach = cfg.snakeRadius + cfg.pickupRadius;
  const kept: PickupState[] = [];
  for (const p of state.pickups) {
    let winner = -1;
    let best = reach * reach;
    state.snakes.forEach((s, i) => {
      if (!s.alive || s.item) return;
      const d = dist2(s, p.x, p.y);
      if (d < best) {
        best = d;
        winner = i;
      }
    });
    if (winner < 0) {
      kept.push(p);
      continue;
    }
    state.snakes[winner].item = createItem(p.kind, cfg);
    events.push({ type: 'pickupCollected', id: p.id, kind: p.kind, player: winner });
  }
  state.pickups = kept;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** with message `feat(sim): pickups spawn clear of danger, expire, and go to the closest empty-handed head` (plus the trailers).

---

### Task 4: Bombs — fuses, blasts, holes and chain reactions

**Files:**
- Create: `src/sim/bombs.ts`
- Test: `src/sim/bombs.test.ts`

**Interfaces:**
- Consumes: `destroyTilesInCircle`, `forEachSolidPointNear`, `TICK_RATE`.
- Produces: `updateBombs(state, cfg, events): Map<number, number>`, which maps each blasted head's index to the bomb owner. It does not change `alive`; the caller applies deaths.

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/bombs.test.ts
import { describe, expect, it } from 'vitest';
import { setTile, tileSolid } from './arena';
import { updateBombs } from './bombs';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { BombState, MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const FUSE = Math.round(cfg.bombFuse * TICK_RATE);
const CHAIN = Math.round(cfg.chainDelay * TICK_RATE);

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

function bomb(id: number, x: number, y: number, owner = 0, fuse = FUSE): BombState {
  return { id, owner, x, y, fuse, maxFuse: fuse, chainDepth: 0 };
}

function run(s: MatchState, ticks: number) {
  const events: SimEvent[] = [];
  const blasted = new Map<number, number>();
  for (let t = 0; t < ticks; t++) for (const [victim, killer] of updateBombs(s, cfg, events)) blasted.set(victim, killer);
  return { events, blasted };
}

function placeHead(s: MatchState, idx: number, x: number, y: number): void {
  const sn = s.snakes[idx];
  sn.trail = createTrail();
  trailPush(sn.trail, x, y);
  sn.x = x;
  sn.y = y;
  rebuildGrid(s);
}

const explosionIds = (events: SimEvent[]) => events.flatMap((e) => (e.type === 'explosion' ? [e.id] : []));

describe('bombs', () => {
  it('explodes after bombFuse and reports the blast', () => {
    const s = playing();
    s.bombs = [bomb(9, 800, 500)];
    expect(run(s, FUSE - 1).events).toEqual([]);
    expect(run(s, 1).events).toEqual([
      { type: 'explosion', id: 9, owner: 0, x: 800, y: 500, radius: cfg.blastRadius, chainDepth: 0, tilesDestroyed: [] },
    ]);
    expect(s.bombs).toEqual([]);
  });

  it('catches every head in range, including the owner, naming the owner as killer', () => {
    const s = playing();
    placeHead(s, 0, 800 + cfg.blastRadius, 500);
    placeHead(s, 1, 800, 500 - cfg.blastRadius - cfg.snakeRadius - 1);
    s.bombs = [bomb(1, 800, 500, 0, 1)];
    expect([...run(s, 1).blasted]).toEqual([[0, 0]]);
    expect(s.snakes[0].alive).toBe(true);
  });

  it('punches a hole in every trail it reaches and bumps holeVersion', () => {
    const s = playing();
    const sn = s.snakes[1];
    sn.trail = createTrail();
    for (let x = 600; x <= 1000; x += 4) trailPush(sn.trail, x, 700);
    sn.x = 1000;
    sn.y = 700;
    rebuildGrid(s);
    s.bombs = [bomb(1, 800, 700, 0, 1)];
    run(s, 1);
    const t = sn.trail;
    const holes = t.xs.filter((_, i) => !t.solid[i]);
    expect(Math.min(...holes)).toBeGreaterThan(800 - cfg.blastRadius - cfg.snakeRadius);
    expect(Math.max(...holes)).toBeLessThan(800 + cfg.blastRadius + cfg.snakeRadius);
    expect(holes.length).toBeGreaterThan(30);
    expect(sn.holeVersion).toBe(1);
    expect(s.snakes[0].holeVersion).toBe(0);
  });

  it('destroys blocks and bumps tilesVersion', () => {
    const s = playing();
    setTile(s.tiles, 40, 25, true);
    const version = s.tilesVersion;
    s.bombs = [bomb(1, 790, 490, 0, 1)];
    const { events } = run(s, 1);
    expect(tileSolid(s.tiles, 40, 25)).toBe(false);
    expect(events[0]).toMatchObject({ tilesDestroyed: [25 * 80 + 40] });
    expect(s.tilesVersion).toBe(version + 1);
  });

  it('sets off nearby bombs after chainDelay, one link deeper', () => {
    const s = playing();
    s.bombs = [bomb(1, 800, 500, 0, 1), bomb(2, 850, 500, 1), bomb(3, 1200, 500, 1)];
    expect(explosionIds(run(s, 1).events)).toEqual([1]);
    expect(s.bombs.find((b) => b.id === 2)).toMatchObject({ fuse: CHAIN, chainDepth: 1 });
    expect(s.bombs.find((b) => b.id === 3)?.fuse).toBe(FUSE - 1);
    const chain = run(s, CHAIN);
    expect(chain.events).toEqual([expect.objectContaining({ type: 'explosion', id: 2, chainDepth: 1 })]);
  });

  // Review Focus 2: a pile of bombs must not re-trigger forever.
  it('explodes each bomb in a pile exactly once', () => {
    const s = playing();
    s.bombs = Array.from({ length: 10 }, (_, k) => bomb(k + 1, 800 + k, 500, 0, k === 0 ? 1 : FUSE));
    const { events } = run(s, CHAIN + 2);
    expect(explosionIds(events).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.bombs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/bombs.test.ts`
Expected: FAIL with "Cannot find module './bombs'".

- [ ] **Step 3: Implement**

```ts file=src/sim/bombs.ts
import { destroyTilesInCircle } from './arena';
import { forEachSolidPointNear } from './collision';
import { TICK_RATE, type Config } from './config';
import type { BombState, MatchState, SimEvent } from './types';

/**
 * Advances every fuse and resolves due explosions in bomb-id order. Blasts punch holes in
 * trails, destroy blocks and cut nearby fuses to chainDelay. Heads caught in a blast are
 * returned (victim index → bomb owner) so the caller applies them with the collision deaths.
 */
export function updateBombs(state: MatchState, cfg: Config, events: SimEvent[]): Map<number, number> {
  const blasted = new Map<number, number>();
  if (state.bombs.length === 0) return blasted;
  for (const b of state.bombs) b.fuse--;
  const due = state.bombs.filter((b) => b.fuse <= 0).sort((a, b) => a.id - b.id);
  for (const bomb of due) explode(state, bomb, cfg, events, blasted);
  state.bombs = state.bombs.filter((b) => b.fuse > 0);
  return blasted;
}

function explode(
  state: MatchState,
  bomb: BombState,
  cfg: Config,
  events: SimEvent[],
  blasted: Map<number, number>,
): void {
  const R = cfg.blastRadius;
  const reach = R + cfg.snakeRadius;

  state.snakes.forEach((s, i) => {
    if (!s.alive || blasted.has(i)) return;
    const dx = s.x - bomb.x;
    const dy = s.y - bomb.y;
    if (dx * dx + dy * dy < reach * reach) blasted.set(i, bomb.owner);
  });

  const holed = new Set<number>();
  forEachSolidPointNear(state, bomb.x, bomb.y, reach, (snake, i) => {
    state.snakes[snake].trail.solid[i] = false;
    holed.add(snake);
  });
  for (const snake of holed) state.snakes[snake].holeVersion++;

  const tilesDestroyed = destroyTilesInCircle(state.tiles, bomb.x, bomb.y, R);
  if (tilesDestroyed.length > 0) state.tilesVersion++;

  const chainFuse = Math.max(1, Math.round(cfg.chainDelay * TICK_RATE));
  for (const other of state.bombs) {
    if (other.fuse <= chainFuse) continue;
    const dx = other.x - bomb.x;
    const dy = other.y - bomb.y;
    if (dx * dx + dy * dy < R * R) {
      other.fuse = chainFuse;
      other.maxFuse = chainFuse;
      other.chainDepth = bomb.chainDepth + 1;
    }
  }

  events.push({
    type: 'explosion',
    id: bomb.id,
    owner: bomb.owner,
    x: bomb.x,
    y: bomb.y,
    radius: R,
    chainDepth: bomb.chainDepth,
    tilesDestroyed,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** with message `feat(sim): timed bombs with blast kills, trail holes, block destruction and chain reactions` (plus the trailers).

---
### Task 5: Wire the boom into the tick loop; bots and soak use bombs

**Files:**
- Modify: `src/sim/step.ts` (full), `src/sim/invariants.ts` (full), `src/sim/bots/simple-bot.ts` (full), `scripts/soak.ts` (full), `src/sim/soak.test.ts` (edit)
- Test: `src/sim/step-boom.test.ts`

**Interfaces:**
- Consumes: `useItem`, `tickItemTimers`, `collectPickups`, `updatePickups`, `updateBombs`, `detectHit`.
- Produces: `step` in the spec's tick order. Blast deaths get cause `blast` and the bomb owner as killer, and they are applied in the same pass as collision deaths. Bots seek pickups and drop bombs.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/step-boom.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { PI } from './detmath';
import { createItem } from './items';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

// Keep random pickups out of the way unless a test places them.
const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000 };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = idle): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, inputs, cfg));
  return all;
}

function toPlaying(): MatchState {
  const s = createMatch(cfg, 5);
  run(s, Math.round(cfg.countdownSeconds * TICK_RATE));
  return s;
}

const armed = (s: MatchState, owner: number, x: number, y: number) =>
  s.bombs.push({ id: 99, owner, x, y, fuse: 1, maxFuse: 1, chainDepth: 0 });

describe('step with bombs and pickups', () => {
  it("a bomb kills the opponent: cause 'blast', killer = the bomb's owner", () => {
    const s = toPlaying();
    const pink = s.snakes[1];
    armed(s, 0, pink.x, pink.y);
    const events = run(s, 1);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'blast', killer: 0 });
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: 0 });
  });

  it('your own bomb can kill you', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    armed(s, 0, cyan.x, cyan.y);
    expect(run(s, 1).find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'blast', killer: 0 });
  });

  it('pressing Use with a bomb drops it where the head was', () => {
    const s = toPlaying();
    s.snakes[0].item = createItem('bomb', cfg);
    const { x, y } = s.snakes[0];
    const events = run(s, 1, [{ turn: 0, boost: false, use: true }, NO_INPUT]);
    expect(events).toContainEqual({ type: 'bombDropped', id: expect.any(Number), player: 0, x, y });
    expect(s.bombs).toHaveLength(1);
    expect(s.snakes[0].item).toEqual({ kind: 'bomb', charges: 2 });
  });

  it('a blast opens a gap you can drive through', () => {
    const s = toPlaying();
    const [cyan, pink] = s.snakes;
    pink.trail = createTrail();
    for (let y = 200; y <= 800; y += 3) trailPush(pink.trail, 800, y);
    Object.assign(pink, { x: 800, y: 800, prevX: 800, prevY: 800, heading: PI / 2, targetLength: 1e9 });
    cyan.trail = createTrail();
    trailPush(cyan.trail, 700, 500);
    Object.assign(cyan, { x: 700, y: 500, prevX: 700, prevY: 500, heading: 0 });
    rebuildGrid(s);
    armed(s, 0, 800, 500);
    const events = run(s, TICK_RATE);
    expect(events.filter((e) => e.type === 'death')).toEqual([]);
    expect(cyan.alive).toBe(true);
    expect(cyan.x).toBeGreaterThan(820);
  });

  it('a blast and a head-on in the same tick both count (draw)', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 806, y: 500, heading: PI });
    // After one tick CYAN is at x≈792.8 and PINK at x≈803.2 (heads 10.3 apart: head-on).
    // A bomb at x=720 reaches CYAN (72.8 < R + r = 77) but not PINK (83.2).
    s.bombs.push({ id: 99, owner: 1, x: 720, y: 500, fuse: 1, maxFuse: 1, chainDepth: 0 });
    const events = run(s, 1);
    const deaths = events.flatMap((e) => (e.type === 'death' ? [[e.player, e.cause]] : []));
    expect(deaths).toEqual([
      [0, 'blast'],
      [1, 'headOn'],
    ]);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: null });
  });

  // Review Focus 4: nothing carries into the next round.
  it('clears bombs and pickups when the next round starts', () => {
    const s = toPlaying();
    s.pickups = [{ id: 1, kind: 'bomb', x: 900, y: 600, ttl: 10_000 }];
    s.bombs.push({ id: 2, owner: 1, x: 900, y: 300, fuse: 500, maxFuse: 500, chainDepth: 0 });
    s.snakes[0].item = createItem('bomb', cfg);
    Object.assign(s.snakes[0], { x: 20, y: 500, heading: PI });
    run(s, 10 + Math.round(cfg.roundOverSeconds * TICK_RATE));
    expect(s.round).toBe(2);
    expect(s.pickups).toEqual([]);
    expect(s.bombs).toEqual([]);
    expect(s.snakes.map((sn) => sn.item)).toEqual([null, null]);
  });

  it('spawns pickups during play', () => {
    const c: Config = { ...DEFAULT_CONFIG };
    const s = createMatch(c, 8);
    const events: SimEvent[] = [];
    for (let i = 0; i < Math.round((c.countdownSeconds + c.firstPickupDelay) * TICK_RATE) + 1; i++) events.push(...step(s, idle, c));
    expect(events.filter((e) => e.type === 'pickupSpawned')).toHaveLength(1);
  });
});
```

```edit file=src/sim/soak.test.ts
<<<< OLD
  const lengths: number[] = [];
==== NEW
  const lengths: number[] = [];
  let explosions = 0;
>>>>
<<<< OLD
    for (const e of events) if (e.type === 'roundOver') lengths.push(state.roundTicks);
==== NEW
    for (const e of events) {
      if (e.type === 'roundOver') lengths.push(state.roundTicks);
      if (e.type === 'explosion') explosions++;
    }
>>>>
<<<< OLD
  return { problems, lengths };
==== NEW
  return { problems, lengths, explosions };
>>>>
<<<< OLD
    const { problems, lengths } = soak(FAST, 12, 11);
    expect(problems).toEqual([]);
==== NEW
    const { problems, lengths, explosions } = soak(FAST, 12, 11);
    expect(problems).toEqual([]);
    expect(explosions).toBeGreaterThan(0);
>>>>
<<<< OLD
    ['fast, long snakes', { baseSpeed: 400, startLength: 600 }],
==== NEW
    ['fast, long snakes', { baseSpeed: 400, startLength: 600 }],
    [
      'bomb chaos',
      { maxPickups: 6, pickupInterval: 1, firstPickupDelay: 0, bombCharges: 10, bombDropCooldown: 0, blastRadius: 200, chainDelay: 0.02 },
    ],
    ['no pickups at all', { maxPickups: 0 }],
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/step-boom.test.ts src/sim/soak.test.ts`
Expected: FAIL. No bombs explode and no pickups spawn, because `step` doesn't call the new modules yet, and the soak sees 0 explosions.

- [ ] **Step 3: Implement**

```ts file=src/sim/step.ts
import { updateBombs } from './bombs';
import { detectHit } from './collision';
import { TICK_RATE, type Config } from './config';
import { tickItemTimers, useItem } from './items';
import { MAPS } from './maps';
import { collectPickups, updatePickups } from './pickups';
import { createRng } from './rng';
import { advanceSnake, growthRate } from './snake';
import { pickNextMap, startRound } from './state';
import { NO_INPUT, type DeathRecord, type MatchState, type PlayerInput, type SimEvent } from './types';

/** Advances the match by one tick, mutating `state`, and returns what happened. */
export function step(state: MatchState, inputs: readonly PlayerInput[], cfg: Config): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  switch (state.phase) {
    case 'countdown':
      stepCountdown(state, events);
      break;
    case 'playing':
      stepPlaying(state, inputs, cfg, events);
      break;
    case 'roundOver':
      stepRoundOver(state, cfg, events);
      break;
    case 'matchOver':
      break;
  }
  return events;
}

/** Resets scores and starts a fresh match on the first map with a new seed. */
export function rematch(state: MatchState, cfg: Config, seed: number): void {
  state.scores = state.scores.map(() => 0);
  state.round = 1;
  state.matchWinner = null;
  state.lastRoundWinner = null;
  state.rng = createRng(seed);
  state.mapIndex = 0;
  state.mapBag = [];
  startRound(state, cfg);
}

function stepCountdown(state: MatchState, events: SimEvent[]): void {
  if (state.phaseTicks % TICK_RATE === 0) events.push({ type: 'countdown', n: state.phaseTicks / TICK_RATE });
  state.phaseTicks--;
  if (state.phaseTicks <= 0) {
    state.phase = 'playing';
    events.push({ type: 'go' });
  }
}

function stepPlaying(state: MatchState, inputs: readonly PlayerInput[], cfg: Config, events: SimEvent[]): void {
  state.roundTicks++;
  if (!state.overtime && state.roundTicks >= Math.round(cfg.overtimeAt * TICK_RATE)) {
    state.overtime = true;
    events.push({ type: 'overtime' });
  }

  tickItemTimers(state);
  state.snakes.forEach((s, i) => {
    if (s.alive && (inputs[i] ?? NO_INPUT).use) useItem(state, i, cfg, events);
  });

  const growth = growthRate(cfg, state.overtime);
  state.snakes.forEach((s, i) => {
    if (s.alive && advanceSnake(s, i, inputs[i] ?? NO_INPUT, cfg, growth, state.grid)) {
      events.push({ type: 'boostStarted', player: i });
    }
  });

  collectPickups(state, cfg, events);
  const blasted = updateBombs(state, cfg, events);

  // Everyone alive at the start of the tick is judged before anyone is removed, so simultaneous deaths are fair.
  const deaths: DeathRecord[] = [];
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const bomber = blasted.get(i);
    if (bomber !== undefined) {
      deaths.push({ player: i, cause: 'blast', killer: bomber, x: s.x, y: s.y });
      return;
    }
    const hit = detectHit(state, i, cfg);
    if (hit) deaths.push({ player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y });
  });
  for (const d of deaths) {
    state.snakes[d.player].alive = false;
    state.deaths.push(d);
    events.push({ type: 'death', ...d });
  }

  const alive = state.snakes.filter((s) => s.alive);
  const timeUp = state.roundTicks >= Math.round(cfg.roundMaxSeconds * TICK_RATE);
  if (alive.length === 1) return endRound(state, cfg, events, alive[0].id);
  if (alive.length === 0 || timeUp) return endRound(state, cfg, events, null);
  updatePickups(state, cfg, events);
}

function endRound(state: MatchState, cfg: Config, events: SimEvent[], winner: number | null): void {
  if (winner !== null) state.scores[winner]++;
  state.lastRoundWinner = winner;
  if (winner !== null && state.scores[winner] >= cfg.winsToWin) state.matchWinner = winner;
  events.push({ type: 'roundOver', winner, deaths: state.deaths.map((d) => ({ ...d })) });
  state.phase = 'roundOver';
  state.phaseTicks = Math.max(1, Math.round(cfg.roundOverSeconds * TICK_RATE));
}

function stepRoundOver(state: MatchState, cfg: Config, events: SimEvent[]): void {
  state.phaseTicks--;
  if (state.phaseTicks > 0) return;
  if (state.matchWinner !== null) {
    state.phase = 'matchOver';
    events.push({ type: 'matchOver', winner: state.matchWinner });
    return;
  }
  state.round++;
  state.mapIndex = pickNextMap(state, MAPS.length);
  startRound(state, cfg);
}
```

```ts file=src/sim/invariants.ts
import { circleHitsWall } from './arena';
import type { Config } from './config';
import { trailLength } from './trail';
import type { MatchState } from './types';

/** Describes anything impossible in `state`; an empty list means healthy. */
export function checkInvariants(state: MatchState, cfg: Config): string[] {
  const problems: string[] = [];
  state.snakes.forEach((s, i) => {
    const values: Array<[string, number]> = [
      ['x', s.x],
      ['y', s.y],
      ['heading', s.heading],
      ['targetLength', s.targetLength],
      ['boostMeter', s.boostMeter],
    ];
    for (const [name, v] of values) if (!Number.isFinite(v)) problems.push(`snake ${i}: ${name} is ${v}`);
    if (s.boostMeter < 0 || s.boostMeter > 1) problems.push(`snake ${i}: boostMeter ${s.boostMeter} outside 0..1`);
    if (s.alive && circleHitsWall(s.x, s.y, cfg.snakeRadius)) problems.push(`snake ${i}: alive outside the arena`);
    const t = s.trail;
    if (t.ys.length !== t.xs.length || t.cum.length !== t.xs.length || t.solid.length !== t.xs.length) {
      problems.push(`snake ${i}: trail arrays out of sync`);
    }
    if (t.start < 0 || t.start >= t.xs.length) problems.push(`snake ${i}: trail start ${t.start} out of range`);
    const len = trailLength(t);
    if (len > Math.max(0, s.targetLength) + 1e-6) problems.push(`snake ${i}: trail ${len} longer than ${s.targetLength}`);
    if (s.item && s.item.charges < 1) problems.push(`snake ${i}: holds an empty item`);
  });
  const points = state.scores.reduce((a, b) => a + b, 0);
  if (points > state.round) problems.push(`${points} points after ${state.round} rounds`);
  if (state.pickups.length > Math.max(0, cfg.maxPickups)) {
    problems.push(`${state.pickups.length} pickups on the field (max ${cfg.maxPickups})`);
  }
  for (const p of state.pickups) {
    if (circleHitsWall(p.x, p.y, 0)) problems.push(`pickup ${p.id} outside the arena`);
    if (p.ttl <= 0) problems.push(`pickup ${p.id} outlived its lifetime`);
  }
  for (const b of state.bombs) {
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) problems.push(`bomb ${b.id} has a non-finite position`);
    if (b.fuse <= 0) problems.push(`bomb ${b.id} should have exploded`);
  }
  if (state.tiles.some((v) => v !== 0 && v !== 1)) problems.push('tiles hold values other than 0 and 1');
  return problems;
}
```

```ts file=src/sim/bots/simple-bot.ts
import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, type Config } from '../config';
import { detAtan2, detCos, detSin, wrapAngle } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SnakeState } from '../types';

/** A cheap look-ahead bot for soak tests (and the seed of a future AI opponent). */
export interface BotState {
  rng: RngState;
  boostTicks: number;
  wanderTicks: number;
  wanderTurn: -1 | 1;
}

export function createBot(seed: number): BotState {
  return { rng: createRng(seed), boostTicks: 0, wanderTicks: 0, wanderTurn: 1 };
}

const LOOK_STEPS = 30;
const STEP_TICKS = 3;
const TURNS = [-1, 0, 1] as const;
const SEEK_RANGE = 450;
const BOMB_RANGE = 220;

export function botInput(bot: BotState, state: MatchState, idx: number, cfg: Config): PlayerInput {
  const me = state.snakes[idx];
  if (state.phase !== 'playing' || !me.alive) return NO_INPUT;
  const clear = TURNS.map((turn) => clearSteps(state, idx, turn, cfg));
  const best = Math.max(...clear);

  if (bot.wanderTicks > 0) bot.wanderTicks--;
  else if (rngNext(bot.rng) < 0.02) {
    bot.wanderTicks = 15 + rngInt(bot.rng, 45);
    bot.wanderTurn = rngNext(bot.rng) < 0.5 ? -1 : 1;
  }

  const seek = seekTurn(state, me);
  let turn: -1 | 0 | 1;
  if (seek !== null && clear[seek + 1] === LOOK_STEPS) turn = seek;
  else if (bot.wanderTicks > 0 && clear[bot.wanderTurn + 1] === LOOK_STEPS) turn = bot.wanderTurn;
  else if (clear[1] === best) turn = 0;
  else {
    const options = TURNS.filter((_, k) => clear[k] === best);
    turn = options[rngInt(bot.rng, options.length)];
  }

  if (bot.boostTicks > 0) bot.boostTicks--;
  else if (best === LOOK_STEPS && rngNext(bot.rng) < 0.004) bot.boostTicks = 20 + rngInt(bot.rng, 40);

  let use = false;
  if (me.item) {
    const near = state.snakes.some((o, j) => j !== idx && o.alive && dist2(o, me.x, me.y) < BOMB_RANGE * BOMB_RANGE);
    use = rngNext(bot.rng) < (near ? 0.08 : 0.005);
  }
  return { turn, boost: bot.boostTicks > 0, use };
}

function dist2(p: { x: number; y: number }, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

/** Turn toward the nearest pickup in range while the slot is empty; null when there's nothing to chase. */
function seekTurn(state: MatchState, me: SnakeState): -1 | 0 | 1 | null {
  if (me.item) return null;
  let target: { x: number; y: number } | null = null;
  let best = SEEK_RANGE * SEEK_RANGE;
  for (const p of state.pickups) {
    const d = dist2(p, me.x, me.y);
    if (d < best) {
      best = d;
      target = p;
    }
  }
  if (!target) return null;
  const diff = wrapAngle(detAtan2(target.y - me.y, target.x - me.x) - me.heading);
  if (diff > 0.12) return 1;
  if (diff < -0.12) return -1;
  return 0;
}

/** How many look-ahead steps stay clear while holding `turn`. */
function clearSteps(state: MatchState, idx: number, turn: -1 | 0 | 1, cfg: Config): number {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const stepDist = cfg.baseSpeed * DT * STEP_TICKS;
  const stepTurn = turn * cfg.turnRate * DT * STEP_TICKS;
  const ignoreOwnFrom = headCum(me.trail) - cfg.neckLength - 2 * r;
  let x = me.x;
  let y = me.y;
  let h = me.heading;
  const probe = { blocked: false };
  for (let k = 1; k <= LOOK_STEPS; k++) {
    h += stepTurn;
    x += detCos(h) * stepDist;
    y += detSin(h) * stepDist;
    if (circleHitsWall(x, y, r + 2) || circleHitsTiles(state.tiles, x, y, r + 2)) return k - 1;
    probe.blocked = false;
    forEachSolidPointNear(state, x, y, 2 * r + 3, (snake, i) => {
      if (snake !== idx || me.trail.cum[i] < ignoreOwnFrom) probe.blocked = true;
    });
    if (probe.blocked) return k - 1;
    for (const b of state.bombs) if (dist2(b, x, y) < (cfg.blastRadius + r) ** 2 && b.fuse < 45) return k - 1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive) continue;
      if (dist2(other, x, y) < 16 * r * r) return k - 1;
    }
  }
  return LOOK_STEPS;
}
```

```ts file=scripts/soak.ts
import { botInput, checkInvariants, createBot, createMatch, DEFAULT_CONFIG, rematch, step, TICK_RATE } from '../src/sim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const rounds = Number(args.get('rounds') ?? 100);
const seed = Number(args.get('seed') ?? 1);
const cfg = structuredClone(DEFAULT_CONFIG);

const state = createMatch(cfg, seed);
const bots = [createBot(seed + 1), createBot(seed + 2)];
const lengths: number[] = [];
const causes = new Map<string, number>();
const problems: string[] = [];
let draws = 0;
let ticks = 0;
let explosions = 0;
let chained = 0;
let collected = 0;
const started = performance.now();

while (lengths.length < rounds) {
  const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
  ticks++;
  for (const e of events) {
    if (e.type === 'death') causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
    if (e.type === 'explosion') {
      explosions++;
      if (e.chainDepth > 0) chained++;
    }
    if (e.type === 'pickupCollected') collected++;
    if (e.type === 'roundOver') {
      lengths.push(state.roundTicks / TICK_RATE);
      if (e.winner === null) draws++;
    }
  }
  if (events.length > 0 || ticks % 97 === 0) problems.push(...checkInvariants(state, cfg));
  if (state.phase === 'matchOver') rematch(state, cfg, seed + ticks);
}

const wall = (performance.now() - started) / 1000;
lengths.sort((a, b) => a - b);
const at = (p: number) => lengths[Math.min(lengths.length - 1, Math.floor(p * lengths.length))];
const inTarget = lengths.filter((l) => l >= 60 && l <= 180).length;
console.log(`rounds ${rounds} · draws ${draws} · ticks ${ticks}`);
console.log(
  `round length (s): min ${lengths[0].toFixed(1)} · median ${at(0.5).toFixed(1)} · p90 ${at(0.9).toFixed(1)} · max ${lengths[lengths.length - 1].toFixed(1)}`,
);
console.log(`rounds inside 60–180 s: ${Math.round((100 * inTarget) / lengths.length)}%`);
console.log(`deaths: ${[...causes].map(([cause, n]) => `${cause} ${n}`).join(' · ')}`);
console.log(
  `per round: ${(collected / rounds).toFixed(1)} pickups · ${(explosions / rounds).toFixed(1)} explosions (${chained} chained in total)`,
);
console.log(`speed: ${(ticks / TICK_RATE / wall).toFixed(0)}× real time (${wall.toFixed(1)} s wall clock)`);
if (problems.length > 0) {
  console.error(`${problems.length} invariant problems; first: ${problems.slice(0, 5).join(' | ')}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run the tests and the soak**

Run: `pnpm vitest run src/sim && pnpm typecheck && pnpm soak --rounds 60`
Expected: every test passes and the typecheck is clean. The soak exits 0, reports explosions (some of them chained) and blast deaths, and runs at ≥ 50× real time. Record the statistics for the PR.

- [ ] **Step 5: Commit** with message `feat(sim): bombs and pickups in the tick loop; bots seek pickups and drop bombs` (plus the trailers).

---
### Task 6: Client logic — item labels, pause that restores the banner, no ghost Use presses

**Files:**
- Modify: `src/client/text.ts` (edit), `src/client/input.ts` (edit), `src/client/screens.ts` (full)
- Test: `src/client/text.test.ts` (edit), `src/client/input.test.ts` (edit), `src/client/screens.test.ts` (new)

**Interfaces:**
- Produces:
  - `describeItem(item: ItemState | null): string`, which returns `'BOMB ×3'`, or `''` for an empty slot.
  - `KeyboardInput.clearLatches()`.
  - `Screens.paused()` and `Screens.resume()`. Resuming restores a round banner or match-over screen, and drops countdown numbers.

- [ ] **Step 1: Write the failing tests**

```edit file=src/client/text.test.ts
<<<< OLD
import { describeDeath, describeRound, formatClock } from './text';
==== NEW
import { describeDeath, describeItem, describeRound, formatClock } from './text';
>>>>
<<<< OLD
  it('formats the round clock', () => {
==== NEW
  it('labels held items for the HUD', () => {
    expect(describeItem(null)).toBe('');
    expect(describeItem({ kind: 'bomb', charges: 3 })).toBe('BOMB ×3');
  });

  it('formats the round clock', () => {
>>>>
```

```edit file=src/client/input.test.ts
<<<< OLD
  // Review Focus 2: losing focus mid-round must not leave a snake turning forever.
==== NEW
  // M2 Review Focus 1: a Use press made while paused must not fire on resume.
  it('forgets latched Use presses on clearLatches', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyS'));
    target.dispatchEvent(key('keydown', 'ArrowDown'));
    input.clearLatches();
    expect(input.sample()).toEqual([idle, idle]);
  });

  // Review Focus 2: losing focus mid-round must not leave a snake turning forever.
>>>>
```

```ts file=src/client/screens.test.ts
import { describe, expect, it } from 'vitest';
import { Screens } from './screens';

const fakeRoot = () => ({ innerHTML: '' }) as unknown as HTMLElement;

describe('Screens pause/resume', () => {
  it('restores the round banner the pause panel covered', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.roundOver('PINK SCORES', 'CYAN hit the wall', 1);
    const banner = root.innerHTML;
    screens.paused();
    expect(root.innerHTML).toContain('PAUSED');
    screens.resume();
    expect(root.innerHTML).toBe(banner);
  });

  it('drops transient countdown numbers on resume', () => {
    const root = fakeRoot();
    const screens = new Screens(root);
    screens.countdown(2);
    screens.paused();
    screens.resume();
    expect(root.innerHTML).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/client`
Expected: FAIL. `describeItem`, `clearLatches` and `resume` don't exist yet.

- [ ] **Step 3: Implement**

```edit file=src/client/text.ts
<<<< OLD
import type { DeathRecord } from '../sim';
==== NEW
import type { DeathRecord, ItemState } from '../sim';
>>>>
<<<< OLD
export function formatClock(ticks: number, tickRate = 60): string {
==== NEW
/** HUD label for an item slot; empty string when the slot is empty. */
export function describeItem(item: ItemState | null): string {
  if (!item) return '';
  switch (item.kind) {
    case 'bomb':
      return `BOMB ×${item.charges}`;
  }
}

export function formatClock(ticks: number, tickRate = 60): string {
>>>>
```

```edit file=src/client/input.ts
<<<< OLD
  private onKeyDown(e: KeyboardEvent): void {
==== NEW
  /** Forgets pending Use presses (pausing and resuming must not fire items). */
  clearLatches(): void {
    this.useLatched.fill(false);
  }

  private onKeyDown(e: KeyboardEvent): void {
>>>>
```

```ts file=src/client/screens.ts
import { PLAYER_CSS } from './colors';
import { PLAYER_NAMES } from './text';

type ScreenKind = 'none' | 'title' | 'countdown' | 'banner' | 'matchOver' | 'paused';

/** Centered overlay messages. All strings are our own, never user input. */
export class Screens {
  private token = 0;
  private kind: ScreenKind = 'none';
  private beforePause: { kind: ScreenKind; html: string } | null = null;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.show('', 'none');
  }

  title(winsToWin: number): void {
    this.show(
      `
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>
            <p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p></div>
        </div>
        <div class="small">GRAB PICKUPS FOR BOMBS · BLASTS BREAK BODIES AND BLOCKS</div>
        <div class="hint">PRESS SPACE TO START</div>
        <div class="small">FIRST TO ${winsToWin} · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`,
      'title',
    );
  }

  countdown(n: number | 'GO'): void {
    const token = this.show(`<div class="big" style="color:var(--text)">${n}</div>`, 'countdown');
    if (n === 'GO') this.clearLater(token, 700);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
    const color = winner === null ? 'var(--text)' : PLAYER_CSS[winner];
    this.show(
      `<div><div class="banner-title" style="color:${color}">${title}</div><div class="banner-detail">${detail}</div></div>`,
      'banner',
    );
  }

  matchOver(winner: number, scores: readonly number[]): void {
    this.show(
      `
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${PLAYER_NAMES[winner]} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">SPACE REMATCH · ESC MENU</div>
      </div>`,
      'matchOver',
    );
  }

  /** Shows the pause panel, remembering what it covers. */
  paused(): void {
    this.beforePause = { kind: this.kind, html: this.root.innerHTML };
    this.show(
      `<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`,
      'paused',
    );
  }

  /** Brings back a banner the pause panel covered; transient countdown numbers are dropped. */
  resume(): void {
    const saved = this.beforePause;
    this.beforePause = null;
    if (saved && (saved.kind === 'banner' || saved.kind === 'matchOver')) this.show(saved.html, saved.kind);
    else this.clear();
  }

  private show(html: string, kind: ScreenKind): number {
    this.token++;
    this.kind = kind;
    this.root.innerHTML = html;
    return this.token;
  }

  private clearLater(token: number, ms: number): void {
    setTimeout(() => {
      if (token === this.token) this.clear();
    }, ms);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** with message `fix(client): pause restores the round banner and never fires queued items; HUD item labels` (plus the trailers).

---

### Task 7: Client visuals — pickups, bombs, explosions, item slots, sounds, tuning

**Files:**
- Modify: `src/client/colors.ts` (full), `src/client/render/fx.ts` (full), `src/client/render/renderer.ts` (full), `src/client/hud.ts` (full), `src/client/audio.ts` (full), `src/client/render/snakes.ts` (edit), `src/client/style.css` (edit), `src/client/tuning.ts` (edit)
- Create: `src/client/render/pickups.ts`, `src/client/render/bombs.ts`

**Interfaces:**
- Consumes: `PickupState`, `BombState`, `PickupKind`, `TILE_COLS`, `TILE_SIZE`, `describeItem`.
- Produces:
  - `PICKUP_COLORS`; `PickupView.draw(pickups, cfg, t)` and `.clear()`; `BombView.draw(bombs, t)` and `.clear()`.
  - `Fx.explosion(x, y, radius, chainDepth, tiles)` and `Fx.pickupBurst(x, y, color)`.
  - `Renderer.draw(state, alpha, cfg, timeSeconds)`, which gains the `timeSeconds` parameter.
  - `Sound.play(name, volumeScale?, pitchScale?)`, with the new names `pickupSpawn`, `pickup`, `bombDrop`, `explosion` and `tick`.

This task is pure presentation. It is verified in the browser in Task 8.

- [ ] **Step 1: Write the views, effects, HUD slot, sounds and tuning**

```ts file=src/client/colors.ts
import type { PickupKind } from '../sim';

export const PLAYER_COLORS: number[] = [0x22f3ff, 0xff2e97];

export const PALETTE = {
  background: 0x05060d,
  gridLine: 0x0f1a2e,
  border: 0x9fd8ff,
  obstacle: 0xffb020,
  obstacleFill: 0x2a1a00,
  core: 0xffffff,
  bomb: 0xff3030,
  bombDim: 0x8a1010,
  fuse: 0xffb020,
};

export const PICKUP_COLORS: Record<PickupKind, number> = {
  bomb: 0xff4d2e,
};

export const PLAYER_CSS = ['var(--cyan)', 'var(--pink)'];
```

```ts file=src/client/render/pickups.ts
import { Graphics, type Container } from 'pixi.js';
import { TICK_RATE, type Config, type PickupKind, type PickupState } from '../../sim';
import { PALETTE, PICKUP_COLORS } from '../colors';

/** Bobbing neon tiles with a glyph per kind; they blink during their last 3 seconds. */
export class PickupView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(pickups: readonly PickupState[], cfg: Config, t: number): void {
    const g = this.g;
    g.clear();
    for (const p of pickups) {
      if (p.ttl < 3 * TICK_RATE && Math.floor(t * 8) % 2 === 0) continue;
      const size = cfg.pickupRadius * (1.2 + 0.08 * Math.sin(t * 5 + p.id));
      const y = p.y + Math.sin(t * 3 + p.id) * 2;
      const color = PICKUP_COLORS[p.kind];
      g.roundRect(p.x - size, y - size, size * 2, size * 2, size * 0.45)
        .fill({ color: PALETTE.background, alpha: 0.85 })
        .stroke({ width: 2.5, color });
      drawGlyph(g, p.kind, p.x, y, size * 0.6, color);
    }
  }
}

function drawGlyph(g: Graphics, kind: PickupKind, x: number, y: number, s: number, color: number): void {
  switch (kind) {
    case 'bomb':
      g.circle(x - s * 0.1, y + s * 0.15, s * 0.7).fill({ color });
      g.moveTo(x + s * 0.3, y - s * 0.4)
        .lineTo(x + s * 0.75, y - s * 0.9)
        .stroke({ width: 2, color: PALETTE.fuse, cap: 'round' });
      break;
  }
}
```

```ts file=src/client/render/bombs.ts
import { Graphics, type Container } from 'pixi.js';
import type { BombState } from '../../sim';
import { PALETTE } from '../colors';

/** Red bombs with a white-hot core, a shrinking fuse ring, and a blink that speeds up. */
export class BombView {
  private readonly g = new Graphics();

  constructor(parent: Container) {
    parent.addChild(this.g);
  }

  clear(): void {
    this.g.clear();
  }

  draw(bombs: readonly BombState[], t: number): void {
    const g = this.g;
    g.clear();
    for (const b of bombs) {
      const left = Math.max(0, Math.min(1, b.fuse / b.maxFuse));
      const blinkHz = 3 + (1 - left) * 14;
      const lit = Math.sin(t * blinkHz * Math.PI * 2) > 0;
      g.circle(b.x, b.y, 9).fill({ color: lit ? PALETTE.bomb : PALETTE.bombDim });
      g.circle(b.x, b.y, 4).fill({ color: PALETTE.core, alpha: lit ? 1 : 0.6 });
      if (left > 0) {
        const start = -Math.PI / 2;
        g.moveTo(b.x + Math.cos(start) * 15, b.y + Math.sin(start) * 15)
          .arc(b.x, b.y, 15, start, start + left * Math.PI * 2)
          .stroke({ width: 3, color: PALETTE.fuse, cap: 'round' });
      }
    }
  }
}
```

```ts file=src/client/render/fx.ts
import { Graphics } from 'pixi.js';
import { TILE_COLS, TILE_SIZE, type SnakeState } from '../../sim';
import { PALETTE } from '../colors';
import type { ClientSettings } from '../settings';
import type { World } from './world';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  maxR: number;
  life: number;
  maxLife: number;
  color: number;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 2000;

/** Client-only juice: sparks, shockwave rings, flashes and screen shake, driven by sim events. */
export class Fx {
  /** Scales particle and ring time (slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private shake = 0;

  constructor(
    private readonly world: World,
    private readonly settings: ClientSettings,
  ) {
    this.g.blendMode = 'add';
    world.glow.addChild(this.g);
  }

  /** Shatters a dead snake into sparks along its whole body, with a flash at the head. */
  deathBurst(s: SnakeState, color: number): void {
    const t = s.trail;
    const stride = Math.max(1, Math.floor((t.xs.length - t.start) / 220));
    for (let i = t.start; i < t.xs.length; i += stride) {
      if (!t.solid[i]) continue;
      this.spark(t.xs[i], t.ys[i], color, 30 + Math.random() * 110, 0.5 + Math.random() * 0.9, 2 + Math.random() * 2);
    }
    for (let k = 0; k < 60; k++) {
      const c = k % 3 === 0 ? 0xffffff : color;
      this.spark(s.x, s.y, c, 120 + Math.random() * 260, 0.4 + Math.random() * 0.8, 2 + Math.random() * 3);
    }
    this.ring(s.x, s.y, 90, 0.5, color);
    this.ring(s.x, s.y, 40, 0.3, 0xffffff);
    this.addShake(14);
  }

  /** A bomb going off: flash, shockwave, sparks, and amber debris from destroyed blocks. */
  explosion(x: number, y: number, radius: number, chainDepth: number, tiles: readonly number[]): void {
    this.flashes.push({ x, y, r: radius, life: 0.18, maxLife: 0.18 });
    this.ring(x, y, radius * 1.15, 0.45, 0xffffff);
    this.ring(x, y, radius * 0.8, 0.32, PALETTE.fuse);
    for (let k = 0; k < 70; k++) {
      const c = k % 4 === 0 ? 0xffffff : k % 2 === 0 ? PALETTE.bomb : PALETTE.fuse;
      this.spark(x, y, c, 150 + Math.random() * 380, 0.3 + Math.random() * 0.6, 2 + Math.random() * 3);
    }
    for (const index of tiles) {
      const tx = (index % TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      const ty = Math.floor(index / TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      for (let k = 0; k < 3; k++) {
        this.spark(tx, ty, PALETTE.obstacle, 60 + Math.random() * 180, 0.5 + Math.random() * 0.7, 3 + Math.random() * 2);
      }
    }
    this.addShake(8 + 4 * Math.min(chainDepth, 4));
  }

  pickupBurst(x: number, y: number, color: number): void {
    this.ring(x, y, 34, 0.3, color);
    for (let k = 0; k < 18; k++) this.spark(x, y, color, 80 + Math.random() * 140, 0.25 + Math.random() * 0.3, 2);
  }

  ring(x: number, y: number, maxR: number, life: number, color: number): void {
    this.rings.push({ x, y, maxR, life, maxLife: life, color });
  }

  spark(x: number, y: number, color: number, speed: number, life: number, size: number): void {
    if (this.particles.length >= MAX_PARTICLES) return;
    const a = Math.random() * Math.PI * 2;
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life, maxLife: life, color, size });
  }

  addShake(amount: number): void {
    this.shake = Math.min(30, this.shake + amount * this.settings.shakeScale);
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.shake = 0;
    this.g.clear();
  }

  update(frameSeconds: number): void {
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of this.flashes) {
      const k = 1 - f.life / f.maxLife;
      g.circle(f.x, f.y, f.r * (0.55 + 0.45 * k)).fill({ color: 0xffffff, alpha: 0.75 * (1 - k) });
    }

    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.moveTo(p.x, p.y)
        .lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03)
        .stroke({ width: p.size, color: p.color, alpha: p.life / p.maxLife, cap: 'round' });
    }

    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of this.rings) {
      const k = 1 - r.life / r.maxLife;
      const radius = r.maxR * (1 - (1 - k) * (1 - k));
      g.circle(r.x, r.y, radius).stroke({ width: 3 + 6 * (1 - k), color: r.color, alpha: 1 - k });
    }

    this.shake *= Math.pow(0.001, frameSeconds);
    const b = this.world.base;
    const jitter = () => (this.shake > 0.3 ? (Math.random() * 2 - 1) * this.shake * b.scale : 0);
    this.world.root.position.set(b.x + jitter(), b.y + jitter());
  }
}
```

```ts file=src/client/render/renderer.ts
import type { Config, MatchState } from '../../sim';
import { PLAYER_COLORS } from '../colors';
import { ArenaView } from './arena';
import { BombView } from './bombs';
import { PickupView } from './pickups';
import { SnakeView } from './snakes';
import type { World } from './world';

/**
 * Draws a MatchState. A replaced tiles array marks a new round (views reset); tilesVersion
 * marks blasted blocks (tiles redrawn).
 */
export class Renderer {
  private readonly arena: ArenaView;
  private readonly pickups: PickupView;
  private readonly snakes: SnakeView[];
  private readonly bombs: BombView;
  private lastTiles: readonly number[] | null = null;
  private lastTilesVersion = -1;

  constructor(world: World) {
    this.arena = new ArenaView(world);
    this.pickups = new PickupView(world.glow);
    this.snakes = PLAYER_COLORS.map((color) => new SnakeView(world.glow, color));
    this.bombs = new BombView(world.glow);
  }

  draw(state: MatchState | null, alpha: number, cfg: Config, timeSeconds = 0): void {
    if (!state) {
      if (this.lastTiles) {
        this.arena.drawTiles([]);
        for (const view of this.snakes) view.reset();
        this.pickups.clear();
        this.bombs.clear();
        this.lastTiles = null;
        this.lastTilesVersion = -1;
      }
      for (const view of this.snakes) view.hide();
      return;
    }
    if (state.tiles !== this.lastTiles) {
      for (const view of this.snakes) view.reset();
      this.lastTiles = state.tiles;
      this.lastTilesVersion = -1;
    }
    if (state.tilesVersion !== this.lastTilesVersion) {
      this.arena.drawTiles(state.tiles);
      this.lastTilesVersion = state.tilesVersion;
    }
    this.pickups.draw(state.pickups, cfg, timeSeconds);
    state.snakes.forEach((s, i) => {
      const view = this.snakes[i];
      if (!view) return;
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg.snakeRadius);
      else view.hide();
    });
    this.bombs.draw(state.bombs, timeSeconds);
  }
}
```

```edit file=src/client/render/snakes.ts
<<<< OLD
  private readonly chunks = new Map<number, Graphics>();
==== NEW
  private readonly chunks = new Map<number, Graphics>();
  private lastHoleVersion = -1;
>>>>
<<<< OLD
    this.chunks.clear();
    this.head.clear();
==== NEW
    this.chunks.clear();
    this.lastHoleVersion = -1;
    this.head.clear();
>>>>
<<<< OLD
    const hx = s.prevX + (s.x - s.prevX) * alpha;
==== NEW
    // Blasts punch holes anywhere along the body, so a new hole redraws every chunk once.
    const holesChanged = s.holeVersion !== this.lastHoleVersion;
    this.lastHoleVersion = s.holeVersion;
    const hx = s.prevX + (s.x - s.prevX) * alpha;
>>>>
<<<< OLD
      if (fresh || k === firstChunk || k >= lastChunk - 1) {
==== NEW
      if (fresh || holesChanged || k === firstChunk || k >= lastChunk - 1) {
>>>>
```

```ts file=src/client/hud.ts
import { TICK_RATE, type Config, type MatchState } from '../sim';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

interface Side {
  pips: HTMLElement;
  fill: HTMLElement;
  slot: HTMLElement;
  lastSlot: string;
}

/** Top bar: names, score pips, boost meters, item slots and the round clock. */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    const side = (i: number) =>
      `<div class="side p${i + 1}"><span class="name">${PLAYER_NAMES[i]}</span><span class="pips"></span>` +
      `<span class="boost"><span class="fill" style="display:block"></span></span><span class="slot"></span></div>`;
    root.innerHTML = `${side(0)}<div class="clock">0:00</div>${side(1)}`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((el) => ({
      pips: el.querySelector<HTMLElement>('.pips')!,
      fill: el.querySelector<HTMLElement>('.fill')!,
      slot: el.querySelector<HTMLElement>('.slot')!,
      lastSlot: '-',
    }));
    this.clock = root.querySelector<HTMLElement>('.clock')!;
  }

  update(state: MatchState | null, cfg: Config): void {
    this.root.classList.toggle('on', state !== null);
    if (!state) return;

    const pipsKey = `${cfg.winsToWin}:${state.scores.join(',')}`;
    if (pipsKey !== this.lastPips) {
      this.lastPips = pipsKey;
      this.sides.forEach((side, i) => {
        const score = state.scores[i] ?? 0;
        side.pips.innerHTML = Array.from(
          { length: Math.max(cfg.winsToWin, score) },
          (_, k) => `<span class="pip${k < score ? ' on' : ''}"></span>`,
        ).join('');
      });
    }

    state.snakes.forEach((s, i) => {
      const side = this.sides[i];
      if (!side) return;
      side.fill.style.width = `${Math.round(s.boostMeter * 100)}%`;
      const label = describeItem(s.item);
      if (label !== side.lastSlot) {
        side.lastSlot = label;
        side.slot.textContent = label || 'NO ITEM';
        side.slot.dataset.kind = s.item?.kind ?? '';
        side.slot.classList.toggle('full', s.item !== null);
      }
    });

    const clock = state.overtime
      ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}`
      : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime);
    }
  }
}
```

```edit file=src/client/style.css
<<<< OLD
  --red: #ff3b3b;
==== NEW
  --red: #ff3b3b;
  --bomb: #ff4d2e;
>>>>
<<<< OLD
.fatal {
==== NEW
.slot {
  min-width: 96px;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-align: center;
  opacity: 0.35;
}

.slot.full {
  opacity: 1;
  box-shadow: 0 0 10px currentColor;
  text-shadow: 0 0 8px currentColor;
}

.slot[data-kind='bomb'] {
  color: var(--bomb);
}

.fatal {
>>>>
```

```ts file=src/client/audio.ts
import { ZZFX, zzfx } from 'zzfx';
import type { ClientSettings } from './settings';

export type SoundName =
  | 'beep'
  | 'go'
  | 'boost'
  | 'death'
  | 'roundWin'
  | 'draw'
  | 'matchWin'
  | 'overtime'
  | 'pickupSpawn'
  | 'pickup'
  | 'bombDrop'
  | 'explosion'
  | 'tick';

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
// slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
// sustainVolume, decay, tremolo, filter. Omitted values use ZzFX defaults.
const BANK: Record<SoundName, number[]> = {
  beep: [0.5, 0, 520, 0, 0.06, 0.12, 1, 1.5],
  go: [0.7, 0, 780, 0.01, 0.12, 0.3, 1, 1.5, 0, 0, 390, 0.06],
  boost: [0.35, 0.05, 140, 0.03, 0.12, 0.2, 2, 1.2, 8, 0, 0, 0, 0, 0.4],
  death: [1.1, 0.1, 220, 0.01, 0.18, 0.7, 2, 2.4, -6, 0, 0, 0, 0, 1.2, 0, 0.3, 0, 0.6, 0.12],
  roundWin: [0.6, 0, 523, 0.01, 0.09, 0.22, 1, 1, 0, 0, 262, 0.09, 0.09],
  draw: [0.5, 0, 330, 0.02, 0.15, 0.3, 1, 1, -2],
  matchWin: [0.8, 0, 392, 0.02, 0.3, 0.6, 1, 1, 0, 0, 196, 0.12, 0.12],
  overtime: [0.6, 0, 880, 0, 0.25, 0.1, 0, 1, 0, 0, -220, 0.1, 0.2, 0, 8],
  pickupSpawn: [0.25, 0, 900, 0.01, 0.03, 0.12, 0, 1, 0, 0, 450, 0.04],
  pickup: [0.5, 0, 660, 0.01, 0.06, 0.18, 1, 1, 0, 0, 330, 0.05, 0.05],
  bombDrop: [0.5, 0.05, 120, 0, 0.03, 0.12, 0, 1, -10, 0, 0, 0, 0, 0.3],
  explosion: [1.3, 0.1, 62, 0.01, 0.22, 0.95, 4, 0.8, -1, 0, 0, 0, 0, 1.8, 0, 0.4, 0, 0.5, 0.25],
  tick: [0.3, 0, 1600, 0, 0.005, 0.03, 0],
};

/** Synthesized sound effects (no audio files). */
export class Sound {
  constructor(private readonly settings: ClientSettings) {}

  /** Browsers keep audio suspended until a user gesture; call on every key press. */
  unlock(): void {
    const ctx = ZZFX.audioContext;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  /** `pitchScale` multiplies the base frequency (chain reactions climb in pitch). */
  play(name: SoundName, volumeScale = 1, pitchScale = 1): void {
    if (this.settings.muted || this.settings.masterVolume <= 0) return;
    ZZFX.volume = this.settings.masterVolume * volumeScale;
    const params = BANK[name].slice();
    params[2] *= pitchScale;
    try {
      zzfx(...params);
    } catch {
      // Audio unavailable (no device or blocked): play silently.
    }
  }
}
```

```edit file=src/client/tuning.ts
<<<< OLD
  const fx = gui.addFolder('Effects');
==== NEW
  const pickups = gui.addFolder('Pickups');
  pickups.add(cfg, 'maxPickups', 0, 6, 1).name('max on field');
  pickups.add(cfg, 'firstPickupDelay', 0, 20, 0.5).name('first spawn (s)');
  pickups.add(cfg, 'pickupInterval', 1, 30, 0.5).name('spawn every (s)');
  pickups.add(cfg, 'pickupLifetime', 3, 60, 1).name('lifetime (s)');
  pickups.add(cfg, 'pickupRadius', 6, 30, 1).name('size');
  pickups.add(cfg, 'pickupMinHeadDistance', 0, 400, 10).name('min distance from heads');
  pickups.add(cfg, 'pickupClearance', 10, 120, 5).name('clearance');

  const bombs = gui.addFolder('Bombs');
  bombs.add(cfg, 'bombCharges', 1, 10, 1).name('bombs per pickup');
  bombs.add(cfg, 'bombDropCooldown', 0, 2, 0.05).name('drop cooldown (s)');
  bombs.add(cfg, 'bombFuse', 0.3, 5, 0.1).name('fuse (s)');
  bombs.add(cfg, 'blastRadius', 20, 200, 5).name('blast radius');
  bombs.add(cfg, 'chainDelay', 0.02, 1, 0.02).name('chain delay (s)');

  const fx = gui.addFolder('Effects');
>>>>
<<<< OLD
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
==== NEW
  for (const folder of gui.folders.slice(1)) folder.close();
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
>>>>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. `timeSeconds` defaults to 0 until Task 8 passes real time.

- [ ] **Step 3: Commit** with message `feat(client): pickup and bomb views, explosions with debris and shake, HUD item slots, new sounds and tuning folders` (plus the trailers).

---
### Task 8: Wire the client, verify in a browser, ship v0.2.0

**Files:**
- Modify: `src/client/main.ts` (full), `README.md` (edit)

**Interfaces:**
- Consumes: everything above.
- Produces: the playable M2 build, the dev-only `window.__snakeboom.state` handle for browser tests, a merged PR, and the `v0.2.0` tag.

- [ ] **Step 1: Write the entry point and README**

```ts file=src/client/main.ts
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './style.css';
import { createMatch, DEFAULT_CONFIG, rematch, step, type MatchState, type SimEvent } from '../sim';
import { Sound } from './audio';
import { PICKUP_COLORS, PLAYER_COLORS } from './colors';
import { Hud } from './hud';
import { KeyboardInput } from './input';
import { FixedLoop } from './loop';
import { Fx } from './render/fx';
import { Renderer } from './render/renderer';
import { applyBloom, createWorld } from './render/world';
import { Screens } from './screens';
import { browserStorage, CONFIG_KEY, DEFAULT_SETTINGS, loadStored, saveStored, SETTINGS_KEY } from './settings';
import { describeRound } from './text';
import { createTuningPanel } from './tuning';

declare global {
  interface Window {
    /** Dev-only handle for browser tests. */
    __snakeboom?: { readonly state: MatchState | null };
  }
}

/** Bombs tick audibly during their last half second. */
const FUSE_TICK_FROM = 30;
const FUSE_TICK_EVERY = 8;

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

async function boot(): Promise<void> {
  const storage = browserStorage();
  const cfg = loadStored(storage, CONFIG_KEY, DEFAULT_CONFIG);
  const settings = loadStored(storage, SETTINGS_KEY, DEFAULT_SETTINGS);

  const world = await createWorld(element('game'), settings);
  const renderer = new Renderer(world);
  const fx = new Fx(world, settings);
  const hud = new Hud(element('hud'));
  const screens = new Screens(element('screens'));
  const sound = new Sound(settings);
  const input = new KeyboardInput(window);

  let state: MatchState | null = null;
  let paused = false;
  let tuningOpen = false;
  const fuseStage = new Map<number, number>();
  const newSeed = () => Math.floor(Math.random() * 2 ** 31);
  const persist = () => {
    saveStored(storage, CONFIG_KEY, cfg);
    saveStored(storage, SETTINGS_KEY, settings);
  };

  const tuning = createTuningPanel(cfg, settings, {
    onChange: () => {
      applyBloom(world, settings);
      persist();
      if (!state) screens.title(cfg.winsToWin);
    },
  });

  const setPaused = (value: boolean) => {
    if (!state || state.phase === 'matchOver' || paused === value) return;
    paused = value;
    input.clearLatches();
    if (paused) screens.paused();
    else screens.resume();
  };

  const handle = (events: SimEvent[]) => {
    if (!state) return;
    for (const e of events) {
      switch (e.type) {
        case 'countdown':
          screens.countdown(e.n);
          sound.play('beep');
          break;
        case 'go':
          screens.countdown('GO');
          sound.play('go');
          break;
        case 'boostStarted':
          sound.play('boost', 0.6);
          break;
        case 'overtime':
          sound.play('overtime');
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
          break;
        case 'roundOver': {
          const { title, detail } = describeRound(e.winner, e.deaths);
          screens.roundOver(title, detail, e.winner);
          sound.play(e.winner === null ? 'draw' : 'roundWin');
          break;
        }
        case 'matchOver':
          screens.matchOver(e.winner, state.scores);
          sound.play('matchWin');
          break;
        case 'pickupSpawned':
          sound.play('pickupSpawn', 0.5);
          break;
        case 'pickupCollected': {
          const s = state.snakes[e.player];
          fx.pickupBurst(s.x, s.y, PICKUP_COLORS[e.kind]);
          sound.play('pickup');
          break;
        }
        case 'bombDropped':
          sound.play('bombDrop');
          break;
        case 'explosion':
          fx.explosion(e.x, e.y, e.radius, e.chainDepth, e.tilesDestroyed);
          sound.play('explosion', 1, 1 + 0.12 * Math.min(e.chainDepth, 5));
          break;
      }
    }
  };

  const tickFuses = () => {
    if (!state || paused) return;
    if (state.bombs.length === 0) {
      fuseStage.clear();
      return;
    }
    for (const b of state.bombs) {
      if (b.fuse > FUSE_TICK_FROM) continue;
      const stage = Math.floor(b.fuse / FUSE_TICK_EVERY);
      if (fuseStage.get(b.id) !== stage) {
        fuseStage.set(b.id, stage);
        sound.play('tick', 0.5);
      }
    }
  };

  input.onKey((code) => {
    sound.unlock();
    switch (code) {
      case 'Backquote':
        tuningOpen = !tuningOpen;
        if (tuningOpen) tuning.show();
        else tuning.hide();
        return;
      case 'KeyM':
        settings.muted = !settings.muted;
        tuning.refresh();
        persist();
        return;
      case 'Escape':
        if (state?.phase === 'matchOver') {
          state = null;
          fx.clear();
          screens.title(cfg.winsToWin);
        } else {
          setPaused(!paused);
        }
        return;
      case 'Space':
        if (!state) {
          state = createMatch(cfg, newSeed());
          screens.clear();
        } else if (state.phase === 'matchOver') {
          rematch(state, cfg, newSeed());
          fx.clear();
          screens.clear();
        }
        return;
    }
  });
  input.onBlur(() => setPaused(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setPaused(true);
  });

  if (import.meta.env.DEV) {
    window.__snakeboom = {
      get state() {
        return state;
      },
    };
  }

  screens.title(cfg.winsToWin);
  new FixedLoop(
    () => {
      if (state && !paused) handle(step(state, input.sample(), cfg));
    },
    (alpha, frameSeconds) => {
      renderer.draw(state, alpha, cfg, performance.now() / 1000);
      fx.update(frameSeconds);
      hud.update(state, cfg);
      tickFuses();
    },
  ).start();
}

boot().catch((err: unknown) => {
  console.error(err);
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `SnakeBoom couldn't start (${err instanceof Error ? err.message : String(err)}). Your browser may not support WebGL.`;
  document.body.appendChild(box);
});
```

```edit file=README.md
<<<< OLD
A two-player neon snake duel. Your snake keeps growing: trap your opponent so they crash into your body, a wall, or themselves.
==== NEW
A two-player neon snake duel. Your snake keeps growing: trap your opponent so they crash into your body, a wall, or themselves.

Grab glowing pickups for bombs (three per pickup, dropped with Use). Blasts kill any head in range (yours too), punch holes through bodies, destroy blocks, and set off other bombs in chain reactions. Every round after the first plays on a different hand-made map.
>>>>
```

- [ ] **Step 2: Run the whole suite, the build and the soak**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm soak --rounds 60`
Expected: all tests pass, the typecheck is clean, and the build succeeds. The soak exits 0, reports explosions and blast deaths, and runs at ≥ 50× real time.

- [ ] **Step 3: Verify in a real browser**

Start `BROWSER=none pnpm vite --port 5199 --strictPort` in the background. Use Playwright with Chrome and Metal (`--use-angle=metal`), because SwiftShader runs slower than real time. Drive this scenario through `window.__snakeboom.state`:
1. Start a match and wait for GO.
2. Give CYAN a bomb item and press S three times, 0.3 s apart.
3. Screenshot the blinking bombs with their fuse rings, then the explosion flash and chain about 1.5 s later, then the holes left in CYAN's trail.
4. Wait for pickups and screenshot them.
5. End round 1 by moving CYAN's head onto the wall, and wait for round 2 (a map with blocks).
6. Push an armed bomb onto a block and screenshot the destroyed blocks and debris.

Look at every screenshot and check that the console has zero errors.

- [ ] **Step 4: Commit, push, open the PR, merge, tag**

Commit with `feat: playable M2 boom — pickups, bombs, blasts, chain reactions and four new maps` (plus the trailers). Push `v1-prototype`, then open a PR titled "M2: Boom — pickups, bombs and chain reactions". Its body should give the soak statistics, the verification, and any rulings. Merge it, sync `main`, fast-forward `v1-prototype`, then tag the merge commit `v0.2.0` with an annotated message and push the tag.
