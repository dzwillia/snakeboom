# SnakeBoom M1 (Duel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a playable first-to-5 duel for two players on one keyboard. It includes neon snakes that grow over time, boost, every M1 death rule, rounds and match flow, a HUD, basic effects and sound, and a live tuning panel. It sits on a deterministic, Node-runnable rules engine.

**Architecture:** `src/sim` is a pure TypeScript rules engine. It uses fixed 60 Hz ticks and a seeded RNG, and its state is plain data. `step(state, inputs, config)` mutates the state and returns events. `src/client` wraps the engine with a fixed-step loop, keyboard input, a PixiJS renderer with bloom, HTML/CSS overlays, ZzFX sound and a lil-gui tuning panel. The client turns sim events into effects and sound.

**Tech Stack:** TypeScript, Vite, Vitest, PixiJS 8, pixi-filters, lil-gui, ZzFX, @fontsource/orbitron, tsx, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`. Read it alongside this plan. This plan implements spec milestone **M1**. M2–M4 get their own plans after each playtest checkpoint.

## Global Constraints

- The world is 1600×1000 units. Tiles are 20 units, in an 80×50 grid. Maps are 40 columns × 25 rows of 40-unit cells. The tick rate is fixed at 60 Hz.
- `src/sim` must not use `Math.random`, `Date`, `performance`, `Math.sin`/`cos`/`tan`/`atan2`/`hypot`/`pow`/`exp`/`log`, `window`, `document`, or `node:` imports. `src/sim/purity.test.ts` enforces this.
- Sim state is JSON-compatible plain data, with no classes, Maps or closures inside it. `cloneState` is `structuredClone`.
- Player 1 is **CYAN** `#22f3ff` and uses A/D/W/S (left, right, boost, use). Player 2 is **PINK** `#ff2e97` and uses ←/→/↑/↓. The global keys are Space (start or rematch), Esc (pause or menu), the backtick key ` (tuning) and M (mute).
- Background `#05060d`, obstacle amber `#ffb020`, grid lines `#0f1a2e`.
- Sounds are generated with ZzFX. There are no audio files.
- Dependencies use the latest versions, pinned exactly (`.npmrc` has `save-exact=true`). If a new major version breaks something, fall back to the previous major.
- Performance: `step` takes ≤ 1 ms normally and ≤ 3 ms in the worst case. The soak test runs at ≥ 50× real time.
- Work happens on the `v1-prototype` branch, with one commit per task. Every commit message ends with these trailers:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
  ```
- **Code-block convention:** every code block that holds a file is fenced as ` ```ts file=<path> `. When a file appears again in a later task, the later block is the complete new version of that file.

## Review Focus

These are inputs and conditions the spec implies but that no feature test covers, listed most likely first. Each one has a test in the task that owns the code.

1. **Both players mashing keys at once, including both turn keys held.** Each player's input must stay independent, and holding left and right together means going straight. Tested in Task 10 (`inputFromKeys`).
2. **The window losing focus mid-round (alt-tab).** Every key must be released so no snake keeps turning, and the game must pause. Tested in Task 10 (`KeyboardInput` blur).
3. **The tab being hidden for a long time and then coming back.** The game must not fast-forward through a burst of ticks. Frame time is clamped and there are at most 5 catch-up ticks. Tested in Task 10 (`FixedLoop`).
4. **Extreme values from the tuning panel** (tiny turning radius, huge radius, zero growth). These must never produce NaN or break invariants, and every round must still end. Tested in Task 9 (soak test with extreme configs).
5. **Corrupted or outdated saved settings in `localStorage`.** The game must still start with the defaults, keeping only saved values that are valid. Tested in Task 10 (`mergeSaved`, `loadStored`).

## File Structure

```
package.json · .npmrc · tsconfig.json · vite.config.ts · index.html · .gitignore · README.md
scripts/soak.ts                     headless bot-vs-bot soak with stats (tsx)
src/sim/                            pure rules engine (runs in Node and in the browser)
  config.ts        Config type, DEFAULT_CONFIG, and the world constants (ARENA_*, TILE_*, MAP_*, TICK_RATE, DT)
  detmath.ts       wrapAngle, detSin, detCos, detAtan, detAtan2 (basic arithmetic only)
  rng.ts           RngState, createRng, rngNext, rngInt, rngRange, shuffleInPlace (mulberry32)
  types.ts         Phase, DeathCause, PlayerInput, NO_INPUT, Trail, Grid, SnakeState, DeathRecord, MatchState, SimEvent
  trail.ts         createTrail, trailPush, trailTrim, trailLength, headCum
  grid.ts          createGrid, gridInsert, gridQuery, gridClear (uniform spatial hash of trail-point seqs)
  arena.ts         createTiles, setTile, tileSolid, circleHitsTiles, circleHitsWall
  maps/parse.ts    MapDef, Spawn, ParsedMap, mapRows, parseMap
  maps/open.ts     the "Open" map
  maps/index.ts    MAP_DEFS, MAPS
  snake.ts         createSnake, advanceSnake, growthRate
  state.ts         createMatch, startRound, rebuildGrid, cloneState, pickNextMap
  collision.ts     forEachSolidPointNear, detectHit
  step.ts          step, rematch
  invariants.ts    checkInvariants
  bots/simple-bot.ts  BotState, createBot, botInput
  index.ts         public API re-exports
  *.test.ts        tests next to the code they test (purity, detmath, rng, trail, grid, arena, maps, snake, state, collision, step, determinism, soak)
src/client/                         browser-only code
  main.ts          startup and wiring
  style.css        neon overlay styles
  keys.ts          BINDINGS, GAME_KEYS, inputFromKeys (pure)
  input.ts         KeyboardInput (DOM events → per-tick PlayerInput)
  loop.ts          FixedLoop (fixed-step accumulator with injectable clock)
  text.ts          PLAYER_NAMES, describeDeath, describeRound, formatClock (pure)
  settings.ts      ClientSettings, DEFAULT_SETTINGS, mergeSaved, loadStored, saveStored
  colors.ts        PLAYER_COLORS and the palette
  hud.ts           Hud (top bar: pips, boost meters, clock)
  screens.ts       Screens (title, countdown, round banner, match over, pause)
  audio.ts         Sound (ZzFX sound bank)
  tuning.ts        createTuningPanel (lil-gui)
  render/world.ts     createWorld (Pixi app, layers, letterbox, bloom)
  render/arena.ts     ArenaView (grid, border, tiles)
  render/snakes.ts    SnakeView (chunked neon tubes and head)
  render/fx.ts        Fx (particles, rings, screen shake)
  render/renderer.ts  Renderer (draws a MatchState)
```

---

### Task 1: Project scaffold and the purity guard

**Files:**
- Create: `package.json`, `.npmrc`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/client/main.ts` (temporary stub, replaced in Task 15), `src/sim/purity.test.ts`

**Interfaces:**
- Produces: the scripts `pnpm dev | build | test | typecheck | soak`, and the purity test that guards every later sim file.

- [ ] **Step 1: Write the config files**

```json file=package.json
{
  "name": "snakeboom",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --open",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "soak": "tsx scripts/soak.ts"
  }
}
```

```ini file=.npmrc
save-exact=true
```

```json file=tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

```ts file=vite.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { open: true },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

```html file=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SnakeBoom</title>
  </head>
  <body>
    <div id="game"></div>
    <div id="hud"></div>
    <div id="screens"></div>
    <script type="module" src="/src/client/main.ts"></script>
  </body>
</html>
```

```gitignore file=.gitignore
node_modules
dist
coverage
.DS_Store
*.log
```

```ts file=src/client/main.ts
// Temporary stub; Task 15 replaces this with the real client entry point.
document.body.dataset.ready = '1';
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
pnpm add pixi.js pixi-filters lil-gui zzfx @fontsource/orbitron
pnpm add -D typescript vite vitest tsx @types/node
```
Expected: `package.json` gains exact versions (no `^`). If `tsc` from TypeScript 7 fails on this config, run `pnpm add -D typescript@5` and continue.

- [ ] **Step 3: Write the purity test**

```ts file=src/sim/purity.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SIM_DIR = fileURLToPath(new URL('.', import.meta.url));

const FORBIDDEN: Array<[RegExp, string]> = [
  [/Math\.random\b/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [
    /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|hypot|pow|exp|expm1|log|log2|log10|log1p|cbrt)\b/,
    'engine-dependent Math function (use detmath)',
  ],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/from\s+['"]node:/, 'node: import'],
];

function simSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...simSources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('sim purity', () => {
  it('uses no browser, clock, or engine-dependent math APIs', () => {
    const problems: string[] = [];
    for (const file of simSources(SIM_DIR)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const [pattern, label] of FORBIDDEN) {
        if (pattern.test(code)) problems.push(`${file}: ${label}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the toolchain**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: 1 test passes, typecheck is clean, and `dist/` is built.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -q -F- <<'EOF'
chore: scaffold Vite + TypeScript + Vitest project with sim purity guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 2: Deterministic math and seeded RNG

**Files:**
- Create: `src/sim/detmath.ts`, `src/sim/rng.ts`
- Test: `src/sim/detmath.test.ts`, `src/sim/rng.test.ts`

**Interfaces:**
- Produces: `PI`, `TWO_PI`, `HALF_PI`, `wrapAngle(a): number` (range [−π, π)), `detSin(a)`, `detCos(a)`, `detAtan(v)`, `detAtan2(y, x)`. Also `interface RngState { s: number }`, `createRng(seed): RngState`, `rngNext(r): number` (range [0, 1)), `rngInt(r, n): number` (range [0, n)), `rngRange(r, min, max)`, and `shuffleInPlace<T>(arr, r): T[]`.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/detmath.test.ts
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
```

```ts file=src/sim/rng.test.ts
import { describe, expect, it } from 'vitest';
import { createRng, rngInt, rngNext, rngRange, shuffleInPlace } from './rng';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) expect(rngNext(a)).toBe(rngNext(b));
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 20 }, () => rngNext(a) === rngNext(b)).filter(Boolean);
    expect(same.length).toBeLessThan(20);
  });

  it('stays within its ranges', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rngNext(r);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rngInt(r, 5);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
      const x = rngRange(r, -3, 3);
      expect(x >= -3 && x < 3).toBe(true);
    }
  });

  it('keeps its state as plain data', () => {
    const r = createRng(9);
    rngNext(r);
    const copy = structuredClone(r);
    expect(rngNext(copy)).toBe(rngNext(r));
  });

  it('shuffles into a permutation', () => {
    const arr = shuffleInPlace([0, 1, 2, 3, 4, 5, 6, 7], createRng(3));
    expect([...arr].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/detmath.test.ts src/sim/rng.test.ts`
Expected: FAIL with "Failed to resolve import './detmath'" and "'./rng'".

- [ ] **Step 3: Implement**

```ts file=src/sim/detmath.ts
// Deterministic trig: only + - * / and Math.floor, which every JS engine computes
// identically (IEEE 754). Math.sin/cos/atan2 are allowed to differ between engines.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
const SQRT3 = 1.7320508075688772;
const TAN_PI_12 = 0.2679491924311227;

/** Wraps an angle into [-PI, PI). */
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + PI) / TWO_PI);
}

/** Sine via Taylor series through x^17 on [-PI/2, PI/2] (error < 1e-13). */
export function detSin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000 + x2 * (1 / 355687428096000)))))))))
  );
}

export function detCos(a: number): number {
  return detSin(a + HALF_PI);
}

/** atan on |z| <= tan(PI/12) via its Taylor series through z^23. */
function atanSmall(z: number): number {
  const z2 = z * z;
  return (
    z *
    (1 +
      z2 *
        (-1 / 3 +
          z2 *
            (1 / 5 +
              z2 *
                (-1 / 7 +
                  z2 *
                    (1 / 9 +
                      z2 *
                        (-1 / 11 +
                          z2 *
                            (1 / 13 +
                              z2 * (-1 / 15 + z2 * (1 / 17 + z2 * (-1 / 19 + z2 * (1 / 21 + z2 * (-1 / 23))))))))))))
  );
}

export function detAtan(v: number): number {
  const neg = v < 0;
  let z = neg ? -v : v;
  let invert = false;
  if (z > 1) {
    z = 1 / z;
    invert = true;
  }
  let shift = 0;
  if (z > TAN_PI_12) {
    // atan(z) = PI/6 + atan((z*sqrt3 - 1) / (sqrt3 + z))
    z = (z * SQRT3 - 1) / (SQRT3 + z);
    shift = PI / 6;
  }
  let r = shift + atanSmall(z);
  if (invert) r = HALF_PI - r;
  return neg ? -r : r;
}

export function detAtan2(y: number, x: number): number {
  if (x > 0) return detAtan(y / x);
  if (x < 0) return y >= 0 ? detAtan(y / x) + PI : detAtan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}
```

```ts file=src/sim/rng.ts
// mulberry32: tiny, fast, and deterministic (32-bit integer math only).
// The state is a plain object so it can live inside MatchState and be cloned.

export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed | 0 };
}

/** Returns a float in [0, 1) and advances the state. */
export function rngNext(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Returns an integer in [0, n). */
export function rngInt(r: RngState, n: number): number {
  return Math.floor(rngNext(r) * n);
}

export function rngRange(r: RngState, min: number, max: number): number {
  return min + (max - min) * rngNext(r);
}

/** Fisher-Yates shuffle, in place. */
export function shuffleInPlace<T>(arr: T[], r: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(r, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim`
Expected: PASS (detmath, rng, purity).

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): deterministic trig and seeded RNG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 3: Config, state types, trails and the spatial grid

**Files:**
- Create: `src/sim/config.ts`, `src/sim/types.ts`, `src/sim/trail.ts`, `src/sim/grid.ts`
- Test: `src/sim/trail.test.ts`, `src/sim/grid.test.ts`

**Interfaces:**
- Consumes: `RngState` (Task 2).
- Produces:
  - Constants: `ARENA_WIDTH`, `ARENA_HEIGHT`, `TILE_SIZE`, `TILE_COLS`, `TILE_ROWS`, `MAP_CELL`, `MAP_COLS`, `MAP_ROWS`, `TICK_RATE`, `DT`.
  - `Config` and `DEFAULT_CONFIG`.
  - Every type in `types.ts`.
  - Trail functions: `createTrail(): Trail`, `trailPush(t, x, y): number` (returns the seq), `trailTrim(t, target)`, `trailLength(t)`, `headCum(t)`.
  - Grid functions: `GRID_CELL = 32`, `createGrid(w, h, cell?)`, `gridInsert(g, x, y, snake, seq)`, `gridQuery(g, x, y, radius, visit(snake, seq))`, `gridClear(g)`.

- [ ] **Step 1: Write config and types**

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
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
};
```

```ts file=src/sim/types.ts
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
  snakes: SnakeState[];
  grid: Grid;
  /** Deaths so far this round. */
  deaths: DeathRecord[];
}

export type SimEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'overtime' }
  | { type: 'boostStarted'; player: number }
  | ({ type: 'death' } & DeathRecord)
  | { type: 'roundOver'; winner: number | null; deaths: DeathRecord[] }
  | { type: 'matchOver'; winner: number };
```

- [ ] **Step 2: Write the failing trail and grid tests**

```ts file=src/sim/trail.test.ts
import { describe, expect, it } from 'vitest';
import { createTrail, headCum, trailLength, trailPush, trailTrim } from './trail';

describe('trail', () => {
  it('tracks cumulative path length', () => {
    const t = createTrail();
    trailPush(t, 0, 0);
    trailPush(t, 3, 4);
    trailPush(t, 3, 10);
    expect(t.cum).toEqual([0, 5, 11]);
    expect(trailLength(t)).toBe(11);
    expect(headCum(t)).toBe(11);
  });

  it('returns increasing sequence numbers', () => {
    const t = createTrail();
    expect(trailPush(t, 0, 0)).toBe(0);
    expect(trailPush(t, 1, 0)).toBe(1);
    expect(trailPush(t, 2, 0)).toBe(2);
  });

  it('trims the tail so the path never exceeds the target', () => {
    const t = createTrail();
    for (let x = 0; x <= 100; x++) trailPush(t, x, 0);
    trailTrim(t, 30.5);
    expect(trailLength(t)).toBe(30);
    expect(t.xs[t.start]).toBe(70);
  });

  it('never trims the head point', () => {
    const t = createTrail();
    trailPush(t, 5, 5);
    trailPush(t, 9, 5);
    trailTrim(t, 0);
    expect(t.xs.length - t.start).toBe(1);
    expect(t.xs[t.start]).toBe(9);
  });

  it('keeps sequence numbers valid after compaction', () => {
    const t = createTrail();
    for (let x = 0; x < 10000; x++) trailPush(t, x, 0);
    trailTrim(t, 100);
    expect(t.start).toBe(0);
    expect(t.baseSeq).toBe(9899);
    const seq = 9904;
    expect(t.xs[seq - t.baseSeq]).toBe(9904);
    expect(trailPush(t, 10000, 0)).toBe(10000);
  });
});
```

```ts file=src/sim/grid.test.ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/trail.test.ts src/sim/grid.test.ts`
Expected: FAIL with "Failed to resolve import './trail'" and "'./grid'".

- [ ] **Step 4: Implement**

```ts file=src/sim/trail.ts
import type { Trail } from './types';

const COMPACT_AFTER = 4096;

export function createTrail(): Trail {
  return { xs: [], ys: [], cum: [], solid: [], start: 0, baseSeq: 0 };
}

/** Appends a point and returns its sequence number. */
export function trailPush(t: Trail, x: number, y: number): number {
  const n = t.xs.length;
  let c = 0;
  if (n > 0) {
    const dx = x - t.xs[n - 1];
    const dy = y - t.ys[n - 1];
    c = t.cum[n - 1] + Math.sqrt(dx * dx + dy * dy);
  }
  t.xs.push(x);
  t.ys.push(y);
  t.cum.push(c);
  t.solid.push(true);
  return t.baseSeq + n;
}

export function headCum(t: Trail): number {
  return t.cum[t.xs.length - 1];
}

/** Path length from tail to head. */
export function trailLength(t: Trail): number {
  const last = t.xs.length - 1;
  return last > t.start ? t.cum[last] - t.cum[t.start] : 0;
}

/** Drops tail points until the path is no longer than `target`. Never drops the head. */
export function trailTrim(t: Trail, target: number): void {
  const last = t.xs.length - 1;
  while (t.start < last && t.cum[last] - t.cum[t.start] > target) t.start++;
  if (t.start > COMPACT_AFTER && t.start * 2 > t.xs.length) compact(t);
}

function compact(t: Trail): void {
  const s = t.start;
  t.xs.splice(0, s);
  t.ys.splice(0, s);
  t.cum.splice(0, s);
  t.solid.splice(0, s);
  t.baseSeq += s;
  t.start = 0;
}
```

```ts file=src/sim/grid.ts
import type { Grid } from './types';

export const GRID_CELL = 32;

export function createGrid(width: number, height: number, cellSize = GRID_CELL): Grid {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells: number[][] = [];
  for (let i = 0; i < cols * rows; i++) cells.push([]);
  return { cols, rows, cellSize, cells };
}

/** Clamps a cell coordinate into [0, max]; NaN maps to 0. */
function clampCell(v: number, max: number): number {
  return v >= 0 ? (v > max ? max : v) : 0;
}

export function gridInsert(g: Grid, x: number, y: number, snake: number, seq: number): void {
  const cx = clampCell(Math.floor(x / g.cellSize), g.cols - 1);
  const cy = clampCell(Math.floor(y / g.cellSize), g.rows - 1);
  g.cells[cy * g.cols + cx].push(seq * 8 + snake);
}

/**
 * Visits every entry in the cells overlapping the square around (x, y).
 * Entries can be stale (trimmed) or holes; callers filter and check exact distance.
 */
export function gridQuery(
  g: Grid,
  x: number,
  y: number,
  radius: number,
  visit: (snake: number, seq: number) => void,
): void {
  const x0 = clampCell(Math.floor((x - radius) / g.cellSize), g.cols - 1);
  const x1 = clampCell(Math.floor((x + radius) / g.cellSize), g.cols - 1);
  const y0 = clampCell(Math.floor((y - radius) / g.cellSize), g.rows - 1);
  const y1 = clampCell(Math.floor((y + radius) / g.cellSize), g.rows - 1);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const cell = g.cells[cy * g.cols + cx];
      for (let k = 0; k < cell.length; k++) {
        const e = cell[k];
        const snake = e % 8;
        visit(snake, (e - snake) / 8);
      }
    }
  }
}

export function gridClear(g: Grid): void {
  for (const cell of g.cells) cell.length = 0;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): config, state types, trails and spatial grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 4: Arena tiles and the map format (Open map)

**Files:**
- Create: `src/sim/arena.ts`, `src/sim/maps/parse.ts`, `src/sim/maps/open.ts`, `src/sim/maps/index.ts`
- Test: `src/sim/arena.test.ts`, `src/sim/maps/maps.test.ts`

**Interfaces:**
- Consumes: the constants in `config.ts` and `PI` (Tasks 2–3).
- Produces:
  - Tile functions: `createTiles(): number[]`, `setTile(tiles, tx, ty, solid)`, `tileSolid(tiles, tx, ty)`, `circleHitsTiles(tiles, x, y, r)`, `circleHitsWall(x, y, r)` (a NaN position counts as a hit).
  - Map types and parsing: `MapDef { name; spawnHeadings: [deg, deg]; grid }`, `Spawn { x; y; heading }`, `ParsedMap { name; tiles; spawns }`, `mapRows(def)`, `parseMap(def)`.
  - Map lists: `MAP_DEFS`, `MAPS` (index 0 is Open).

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/arena.test.ts
import { describe, expect, it } from 'vitest';
import { circleHitsTiles, circleHitsWall, createTiles, setTile, tileSolid } from './arena';

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
});
```

```ts file=src/sim/maps/maps.test.ts
import { describe, expect, it } from 'vitest';
import { MAP_COLS, MAP_ROWS } from '../config';
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
    expect(MAPS[0].name).toBe('Open');
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
    expect(open.spawns[0]).toEqual({ x: 260, y: 220, heading: 0 });
    expect(open.spawns[1].x).toBe(1340);
    expect(open.spawns[1].y).toBe(780);
    expect(open.spawns[1].heading).toBeCloseTo(PI, 12);
  });

  it('rejects malformed maps', () => {
    const good = MAP_DEFS[0];
    expect(() => parseMap({ ...good, grid: good.grid.replace('1', '.') })).toThrow(/spawn/);
    expect(() => parseMap({ ...good, grid: good.grid.replace('.', 'x') })).toThrow(/unknown/);
    expect(() => parseMap({ ...good, grid: '....' })).toThrow(/rows/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/arena.test.ts src/sim/maps`
Expected: FAIL with "Failed to resolve import './arena'" and "'./index'".

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

export function circleHitsTiles(tiles: number[], x: number, y: number, r: number): boolean {
  const tx0 = Math.max(0, Math.floor((x - r) / TILE_SIZE));
  const tx1 = Math.min(TILE_COLS - 1, Math.floor((x + r) / TILE_SIZE));
  const ty0 = Math.max(0, Math.floor((y - r) / TILE_SIZE));
  const ty1 = Math.min(TILE_ROWS - 1, Math.floor((y + r) / TILE_SIZE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tiles[ty * TILE_COLS + tx] !== 1) continue;
      const left = tx * TILE_SIZE;
      const top = ty * TILE_SIZE;
      const nx = x < left ? left : x > left + TILE_SIZE ? left + TILE_SIZE : x;
      const ny = y < top ? top : y > top + TILE_SIZE ? top + TILE_SIZE : y;
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}
```

```ts file=src/sim/maps/parse.ts
import { createTiles } from '../arena';
import { MAP_CELL, MAP_COLS, MAP_ROWS, TILE_COLS, TILE_SIZE } from '../config';
import { PI } from '../detmath';

/** A hand-made map: 40x25 ASCII, '.' empty, '#' solid (2x2 tiles), '1'/'2' spawn cells. */
export interface MapDef {
  name: string;
  /** Spawn headings in degrees for P1 and P2 (0 = east, clockwise). */
  spawnHeadings: [number, number];
  grid: string;
}

export interface Spawn {
  x: number;
  y: number;
  heading: number;
}

export interface ParsedMap {
  name: string;
  tiles: number[];
  spawns: Spawn[];
}

const TILES_PER_CELL = MAP_CELL / TILE_SIZE;

export function mapRows(def: MapDef): string[] {
  return def.grid
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function parseMap(def: MapDef): ParsedMap {
  const rows = mapRows(def);
  if (rows.length !== MAP_ROWS) {
    throw new Error(`Map ${def.name}: expected ${MAP_ROWS} rows, got ${rows.length}`);
  }
  const tiles = createTiles();
  const cells: Array<{ c: number; r: number } | null> = [null, null];
  for (let r = 0; r < MAP_ROWS; r++) {
    const row = rows[r];
    if (row.length !== MAP_COLS) {
      throw new Error(`Map ${def.name}: row ${r} has ${row.length} columns, expected ${MAP_COLS}`);
    }
    for (let c = 0; c < MAP_COLS; c++) {
      const ch = row[c];
      if (ch === '#') {
        for (let dy = 0; dy < TILES_PER_CELL; dy++) {
          for (let dx = 0; dx < TILES_PER_CELL; dx++) {
            tiles[(r * TILES_PER_CELL + dy) * TILE_COLS + (c * TILES_PER_CELL + dx)] = 1;
          }
        }
      } else if (ch === '1' || ch === '2') {
        const p = ch === '1' ? 0 : 1;
        if (cells[p]) throw new Error(`Map ${def.name}: more than one spawn ${ch}`);
        cells[p] = { c, r };
      } else if (ch !== '.') {
        throw new Error(`Map ${def.name}: unknown character '${ch}' at column ${c}, row ${r}`);
      }
    }
  }
  const spawns = cells.map((cell, p) => {
    if (!cell) throw new Error(`Map ${def.name}: missing spawn ${p + 1}`);
    return {
      x: cell.c * MAP_CELL + MAP_CELL / 2,
      y: cell.r * MAP_CELL + MAP_CELL / 2,
      heading: (def.spawnHeadings[p] * PI) / 180,
    };
  });
  return { name: def.name, tiles, spawns };
}
```

```ts file=src/sim/maps/open.ts
import type { MapDef } from './parse';

export const open: MapDef = {
  name: 'Open',
  spawnHeadings: [0, 180],
  grid: `
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ......1.................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
    .................................2......
    ........................................
    ........................................
    ........................................
    ........................................
    ........................................
  `,
};
```

```ts file=src/sim/maps/index.ts
import { open } from './open';
import { parseMap, type MapDef, type ParsedMap } from './parse';

export const MAP_DEFS: MapDef[] = [open];
export const MAPS: ParsedMap[] = MAP_DEFS.map(parseMap);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): arena tiles, ASCII map format and the Open map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 5: Snake movement, boost and growth

**Files:**
- Create: `src/sim/snake.ts`
- Test: `src/sim/snake.test.ts`

**Interfaces:**
- Consumes: `Config`, `DT`, `detSin`, `detCos`, `wrapAngle`, `createTrail`, `trailPush`, `trailTrim`, `gridInsert`, `SnakeState`, `PlayerInput`, `Grid`.
- Produces:
  - `createSnake(id, x, y, heading, cfg): SnakeState`. The trail starts with the spawn point (seq 0), the meter is full, and the length is `startLength`.
  - `growthRate(cfg, overtime): number` (units per second).
  - `advanceSnake(s, idx, input, cfg, growth, grid): boolean`. It returns true on the tick boosting starts. It updates the meter, steers, moves, lays a trail point, indexes that point in the grid, grows, and trims the tail.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/snake.test.ts
import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { createGrid, gridQuery } from './grid';
import { advanceSnake, createSnake, growthRate } from './snake';
import { trailLength } from './trail';
import type { PlayerInput } from './types';

const cfg: Config = { ...DEFAULT_CONFIG };
const straight: PlayerInput = { turn: 0, boost: false, use: false };

function run(ticks: number, input: PlayerInput, c: Config = cfg, growth = 0) {
  const s = createSnake(0, 800, 500, 0, c);
  const grid = createGrid(ARENA_WIDTH, ARENA_HEIGHT);
  let starts = 0;
  for (let i = 0; i < ticks; i++) if (advanceSnake(s, 0, input, c, growth, grid)) starts++;
  return { s, grid, starts };
}

function circumradius(a: [number, number], b: [number, number], c: [number, number]): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return (ab * bc * ca) / (2 * twiceArea);
}

describe('snake movement', () => {
  it('moves baseSpeed units per second in a straight line', () => {
    const { s } = run(TICK_RATE, straight);
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed, 9);
    expect(s.y).toBeCloseTo(500, 9);
  });

  it('records the previous head position for interpolation', () => {
    const { s } = run(1, straight);
    expect(s.prevX).toBe(800);
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed / TICK_RATE, 9);
  });

  it('turns right (toward +y) on a circle of radius baseSpeed / turnRate', () => {
    const { s } = run(80, { ...straight, turn: 1 }, { ...cfg, startLength: 1e6 });
    const t = s.trail;
    const p = (i: number): [number, number] => [t.xs[i], t.ys[i]];
    expect(circumradius(p(10), p(40), p(70))).toBeCloseTo(cfg.baseSpeed / cfg.turnRate, 1);
    expect(t.ys[20]).toBeGreaterThan(500);
  });

  it('boosts at boostMultiplier speed and drains the meter over boostMeterSeconds', () => {
    const { s, starts } = run(TICK_RATE, { ...straight, boost: true });
    expect(s.x).toBeCloseTo(800 + cfg.baseSpeed * cfg.boostMultiplier, 6);
    expect(s.boostMeter).toBeCloseTo(1 - 1 / cfg.boostMeterSeconds, 9);
    expect(starts).toBe(1);
  });

  it('stops boosting when empty and refills only while the key is released', () => {
    const s = createSnake(0, 100, 500, 0, cfg);
    const grid = createGrid(ARENA_WIDTH, ARENA_HEIGHT);
    const hold: PlayerInput = { ...straight, boost: true };
    for (let i = 0; i < 125; i++) advanceSnake(s, 0, hold, cfg, 0, grid);
    expect(s.boostMeter).toBe(0);
    expect(s.boosting).toBe(false);
    advanceSnake(s, 0, hold, cfg, 0, grid);
    expect(s.boostMeter).toBe(0);
    for (let i = 0; i < 3 * TICK_RATE; i++) advanceSnake(s, 0, straight, cfg, 0, grid);
    expect(s.boostMeter).toBeCloseTo(3 / cfg.boostRefillSeconds, 9);
  });

  it('grows at growthPerSecond, faster in overtime', () => {
    expect(growthRate(cfg, false)).toBe(cfg.growthPerSecond);
    expect(growthRate(cfg, true)).toBe(cfg.growthPerSecond * cfg.overtimeGrowthMultiplier);
    const { s } = run(TICK_RATE, straight, cfg, growthRate(cfg, false));
    expect(s.targetLength).toBeCloseTo(cfg.startLength + cfg.growthPerSecond, 9);
  });

  it('keeps the trail no longer than the target length', () => {
    const { s } = run(5 * TICK_RATE, straight, cfg, growthRate(cfg, false));
    expect(trailLength(s.trail)).toBeLessThanOrEqual(s.targetLength);
    expect(trailLength(s.trail)).toBeGreaterThan(s.targetLength - 5);
  });

  it('indexes every new trail point in the grid', () => {
    const { s, grid } = run(1, straight);
    const seen: number[] = [];
    gridQuery(grid, s.x, s.y, 1, (_snake, seq) => seen.push(seq));
    expect(seen).toContain(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/snake.test.ts`
Expected: FAIL with "Failed to resolve import './snake'".

- [ ] **Step 3: Implement**

```ts file=src/sim/snake.ts
import { DT, type Config } from './config';
import { detCos, detSin, wrapAngle } from './detmath';
import { gridInsert } from './grid';
import { createTrail, trailPush, trailTrim } from './trail';
import type { Grid, PlayerInput, SnakeState } from './types';

export function createSnake(id: number, x: number, y: number, heading: number, cfg: Config): SnakeState {
  const trail = createTrail();
  trailPush(trail, x, y);
  return {
    id,
    alive: true,
    x,
    y,
    prevX: x,
    prevY: y,
    heading,
    targetLength: cfg.startLength,
    boostMeter: 1,
    boosting: false,
    trail,
  };
}

/** Growth in units per second. */
export function growthRate(cfg: Config, overtime: boolean): number {
  return cfg.growthPerSecond * (overtime ? cfg.overtimeGrowthMultiplier : 1);
}

/**
 * Advances a live snake by one tick: boost meter, steering, movement, a new trail point
 * (indexed in the grid), growth and tail trimming. Returns true on the tick boosting starts.
 */
export function advanceSnake(
  s: SnakeState,
  idx: number,
  input: PlayerInput,
  cfg: Config,
  growth: number,
  grid: Grid,
): boolean {
  const wasBoosting = s.boosting;
  if (input.boost && s.boostMeter > 0) {
    s.boosting = true;
    s.boostMeter = Math.max(0, s.boostMeter - DT / cfg.boostMeterSeconds);
  } else {
    s.boosting = false;
    if (!input.boost) s.boostMeter = Math.min(1, s.boostMeter + DT / cfg.boostRefillSeconds);
  }

  s.prevX = s.x;
  s.prevY = s.y;
  s.heading = wrapAngle(s.heading + input.turn * cfg.turnRate * DT);
  const dist = cfg.baseSpeed * (s.boosting ? cfg.boostMultiplier : 1) * DT;
  s.x += detCos(s.heading) * dist;
  s.y += detSin(s.heading) * dist;

  const seq = trailPush(s.trail, s.x, s.y);
  gridInsert(grid, s.x, s.y, idx, seq);
  s.targetLength += growth * DT;
  trailTrim(s.trail, s.targetLength);
  return s.boosting && !wasBoosting;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): snake steering, boost meter, growth and trail trimming

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 6: Match state, round setup and map rotation

**Files:**
- Create: `src/sim/state.ts`
- Test: `src/sim/state.test.ts`

**Interfaces:**
- Consumes: `MAPS`, `createSnake`, `createGrid`, `gridClear`, `gridInsert`, `createRng`, `shuffleInPlace`, `TICK_RATE`.
- Produces:
  - `createMatch(cfg, seed): MatchState`. It starts round 1 on map 0 in `countdown`.
  - `startRound(state, cfg)`. It loads `MAPS[state.mapIndex]` with a fresh `tiles` array, respawns the snakes, rebuilds the grid, and resets the phase timers.
  - `rebuildGrid(state)`.
  - `cloneState(state): MatchState`.
  - `pickNextMap(state, mapCount): number`.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/state.test.ts
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
      expect(sn.boostMeter).toBe(1);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/state.test.ts`
Expected: FAIL with "Failed to resolve import './state'".

- [ ] **Step 3: Implement**

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
    snakes: [],
    grid: createGrid(ARENA_WIDTH, ARENA_HEIGHT),
    deaths: [],
  };
  startRound(state, cfg);
  return state;
}

/** Loads the current map and respawns everyone into a fresh countdown. */
export function startRound(state: MatchState, cfg: Config): void {
  const map = MAPS[state.mapIndex];
  state.tiles = map.tiles.slice();
  state.snakes = map.spawns.map((sp, i) => createSnake(i, sp.x, sp.y, sp.heading, cfg));
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): match state, round setup and map rotation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 7: Collisions and death causes

**Files:**
- Create: `src/sim/collision.ts`
- Test: `src/sim/collision.test.ts`

**Interfaces:**
- Consumes: `circleHitsTiles`, `circleHitsWall`, `gridQuery`, `headCum`, `MatchState`, `Config`.
- Produces:
  - `interface Hit { cause: DeathCause; killer: number | null }`.
  - `forEachSolidPointNear(state, x, y, radius, visit(snake, index))`. It visits only live, solid points strictly inside the radius, in no particular order.
  - `detectHit(state, idx, cfg): Hit | null`. The priority is headOn > body > self > obstacle > wall. When several snakes qualify as the killer, the lowest index is reported. Blasts are handled elsewhere (M2).

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/collision.test.ts
import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { detectHit, type Hit } from './collision';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { advanceSnake } from './snake';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, PlayerInput } from './types';

const cfg = DEFAULT_CONFIG;
const turnRight: PlayerInput = { turn: 1, boost: false, use: false };

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

/** Replaces snake idx's trail with the given points; the head is the last point. */
function setPath(state: MatchState, idx: number, pts: Array<[number, number]>): void {
  const sn = state.snakes[idx];
  sn.trail = createTrail();
  for (const [x, y] of pts) trailPush(sn.trail, x, y);
  const [hx, hy] = pts[pts.length - 1];
  sn.x = hx;
  sn.y = hy;
  sn.prevX = hx;
  sn.prevY = hy;
  sn.targetLength = 1e9;
  rebuildGrid(state);
}

function line(x0: number, y0: number, x1: number, y1: number, step = 3): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, k): [number, number] => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
}

describe('detectHit', () => {
  it('reports nothing in open space', () => {
    expect(detectHit(playing(), 0, cfg)).toBeNull();
  });

  it('kills on the arena wall', () => {
    const s = playing();
    setPath(s, 0, line(40, 500, 6, 500));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });

  it('kills on solid tiles', () => {
    const s = playing();
    setTile(s.tiles, 30, 20, true); // x 600..620, y 400..420
    setPath(s, 0, line(560, 410, 605, 410));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'obstacle', killer: null });
  });

  it("kills on the other snake's body and names its owner", () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'body', killer: 1 });
  });

  it('kills on your own body beyond the neck', () => {
    const s = playing();
    setPath(s, 0, [...line(200, 300, 400, 300), ...line(400, 312, 250, 312)]);
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'self', killer: 0 });
  });

  it('ignores your own neck', () => {
    const s = playing();
    setPath(s, 0, line(200, 300, 400, 300));
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('reports head-on for both snakes, ahead of body hits', () => {
    const s = playing();
    setPath(s, 0, line(300, 500, 495, 500));
    setPath(s, 1, line(700, 500, 505, 500));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'headOn', killer: 1 });
    expect(detectHit(s, 1, cfg)).toEqual({ cause: 'headOn', killer: 0 });
  });

  it('ignores holes and trimmed points', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    const t = s.snakes[1].trail;
    for (let i = 0; i < t.xs.length; i++) if (Math.abs(t.xs[i] - 500) < 20) t.solid[i] = false;
    expect(detectHit(s, 0, cfg)).toBeNull();
    t.solid.fill(true);
    t.start = t.xs.length - 1;
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('never clips its own neck while turning at the maximum rate', () => {
    const s = playing();
    for (let t = 0; t < 3 * TICK_RATE; t++) {
      advanceSnake(s.snakes[0], 0, turnRight, cfg, 0, s.grid);
      expect(detectHit(s, 0, cfg)).toBeNull();
    }
  });

  it('hits its own tail when circling with a body longer than the circle', () => {
    const s = playing();
    s.snakes[0].targetLength = 400;
    let hit: Hit | null = null;
    for (let t = 0; t < 3 * TICK_RATE && !hit; t++) {
      advanceSnake(s.snakes[0], 0, turnRight, cfg, 0, s.grid);
      hit = detectHit(s, 0, cfg);
    }
    expect(hit).toEqual({ cause: 'self', killer: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/collision.test.ts`
Expected: FAIL with "Failed to resolve import './collision'".

- [ ] **Step 3: Implement**

```ts file=src/sim/collision.ts
import { circleHitsTiles, circleHitsWall } from './arena';
import type { Config } from './config';
import { gridQuery } from './grid';
import { headCum } from './trail';
import type { DeathCause, MatchState } from './types';

export interface Hit {
  cause: DeathCause;
  killer: number | null;
}

/** Visits each live, solid trail point strictly within `radius` of (x, y). Order is unspecified. */
export function forEachSolidPointNear(
  state: MatchState,
  x: number,
  y: number,
  radius: number,
  visit: (snake: number, index: number) => void,
): void {
  const r2 = radius * radius;
  gridQuery(state.grid, x, y, radius, (snake, seq) => {
    const t = state.snakes[snake].trail;
    const i = seq - t.baseSeq;
    if (i < t.start || i >= t.xs.length || !t.solid[i]) return;
    const dx = t.xs[i] - x;
    const dy = t.ys[i] - y;
    if (dx * dx + dy * dy < r2) visit(snake, i);
  });
}

/**
 * Checks one live head against heads, bodies, blocks and walls (blasts are resolved elsewhere).
 * Priority: headOn > body > self > obstacle > wall. Ties pick the lowest snake index, so the
 * result never depends on grid visit order.
 */
export function detectHit(state: MatchState, idx: number, cfg: Config): Hit | null {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const touch = 2 * r;

  let headOn = -1;
  for (let j = 0; j < state.snakes.length; j++) {
    const other = state.snakes[j];
    if (j === idx || !other.alive) continue;
    const dx = other.x - me.x;
    const dy = other.y - me.y;
    if (dx * dx + dy * dy < touch * touch && (headOn < 0 || j < headOn)) headOn = j;
  }
  if (headOn >= 0) return { cause: 'headOn', killer: headOn };

  const neckStart = headCum(me.trail) - cfg.neckLength;
  const found = { body: -1, self: false };
  forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
    if (snake === idx) {
      if (me.trail.cum[i] < neckStart) found.self = true;
    } else if (found.body < 0 || snake < found.body) {
      found.body = snake;
    }
  });
  if (found.body >= 0) return { cause: 'body', killer: found.body };
  if (found.self) return { cause: 'self', killer: idx };
  if (circleHitsTiles(state.tiles, me.x, me.y, r)) return { cause: 'obstacle', killer: null };
  if (circleHitsWall(me.x, me.y, r)) return { cause: 'wall', killer: null };
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): collision detection with head-on, body, self, block and wall causes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 8: The tick loop — phases, deaths, scoring and rematch

**Files:**
- Create: `src/sim/step.ts`
- Test: `src/sim/step.test.ts`

**Interfaces:**
- Consumes: `advanceSnake`, `growthRate`, `detectHit`, `Hit`, `startRound`, `pickNextMap`, `MAPS`, `createRng`, `NO_INPUT`, `TICK_RATE`.
- Produces:
  - `step(state, inputs, cfg): SimEvent[]`, which mutates `state`. The phase order is countdown, playing, roundOver, then the next round or matchOver.
  - `rematch(state, cfg, seed)`. The spec writes this as `rematch(state, seed)`. Here it also takes `cfg`, because a round start needs `startLength` and `countdownSeconds`.
  - The events this task sends:
    - `countdown{n}` on each whole second of the countdown, then `go`
    - `overtime`, once per round
    - `boostStarted`
    - `death`
    - `roundOver{winner, deaths}`
    - `matchOver{winner}`

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/step.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { PI } from './detmath';
import { createMatch } from './state';
import { rematch, step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(state: MatchState, ticks: number, c: Config = cfg, inputs: PlayerInput[] = idle): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(state, inputs, c));
  return all;
}

function toPlaying(c: Config = cfg): MatchState {
  const s = createMatch(c, 7);
  run(s, Math.round(c.countdownSeconds * TICK_RATE), c);
  return s;
}

/** Teleports snake idx next to the left wall, facing it: dead within a few ticks. */
function aimAtWall(s: MatchState, idx: number): void {
  const sn = s.snakes[idx];
  sn.x = 20;
  sn.y = 500;
  sn.heading = PI;
}

describe('step: countdown', () => {
  it('counts 3-2-1 then GO after countdownSeconds, with snakes frozen', () => {
    const s = createMatch(cfg, 1);
    const x0 = s.snakes[0].x;
    const events = run(s, 3 * TICK_RATE - 1, cfg, [{ turn: 1, boost: true, use: true }, NO_INPUT]);
    expect(events).toEqual([
      { type: 'countdown', n: 3 },
      { type: 'countdown', n: 2 },
      { type: 'countdown', n: 1 },
    ]);
    expect(s.phase).toBe('countdown');
    expect(s.snakes[0].x).toBe(x0);
    expect(step(s, idle, cfg)).toEqual([{ type: 'go' }]);
    expect(s.phase).toBe('playing');
  });
});

describe('step: playing', () => {
  it('moves the snakes and counts round time', () => {
    const s = toPlaying();
    run(s, TICK_RATE);
    expect(s.roundTicks).toBe(TICK_RATE);
    expect(s.snakes[0].x).toBeCloseTo(260 + cfg.baseSpeed, 6);
  });

  it('awards the round to the survivor and reports the death', () => {
    const s = toPlaying();
    aimAtWall(s, 0);
    const events = run(s, 10);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'wall', killer: null });
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: 1 });
    expect(s.scores).toEqual([0, 1]);
    expect(s.phase).toBe('roundOver');
  });

  it('scores nothing when both die in the same tick', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 810, y: 500, heading: PI });
    const events = run(s, 3);
    expect(events.filter((e) => e.type === 'death')).toHaveLength(2);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: null });
    expect(s.scores).toEqual([0, 0]);
  });

  it('declares a draw when the round reaches roundMaxSeconds', () => {
    const c = { ...cfg, roundMaxSeconds: 1 };
    const s = toPlaying(c);
    const events = run(s, TICK_RATE, c);
    expect(events.find((e) => e.type === 'roundOver')).toEqual({ type: 'roundOver', winner: null, deaths: [] });
    expect(s.phase).toBe('roundOver');
  });

  it('enters overtime once, at overtimeAt', () => {
    const c = { ...cfg, overtimeAt: 1 };
    const s = toPlaying(c);
    const events = run(s, TICK_RATE + 5, c);
    expect(events.filter((e) => e.type === 'overtime')).toHaveLength(1);
    expect(s.overtime).toBe(true);
  });

  it('reports when a snake starts boosting', () => {
    const s = toPlaying();
    const events = run(s, 5, cfg, [{ turn: 0, boost: true, use: false }, NO_INPUT]);
    expect(events.filter((e) => e.type === 'boostStarted')).toEqual([{ type: 'boostStarted', player: 0 }]);
  });
});

describe('step: rounds and matches', () => {
  it('starts the next round after roundOverSeconds', () => {
    const s = toPlaying();
    aimAtWall(s, 0);
    run(s, 10);
    run(s, Math.round(cfg.roundOverSeconds * TICK_RATE));
    expect(s.round).toBe(2);
    expect(s.phase).toBe('countdown');
    expect(s.snakes.every((sn) => sn.alive)).toBe(true);
    expect(s.deaths).toEqual([]);
  });

  it('ends the match when someone reaches winsToWin, then stays frozen', () => {
    const c = { ...cfg, winsToWin: 2 };
    const s = createMatch(c, 3);
    const seen: SimEvent[] = [];
    for (let round = 0; round < 2; round++) {
      seen.push(...run(s, Math.round(c.countdownSeconds * TICK_RATE), c));
      aimAtWall(s, 0);
      seen.push(...run(s, 10 + Math.round(c.roundOverSeconds * TICK_RATE), c));
    }
    expect(seen.filter((e) => e.type === 'roundOver')).toHaveLength(2);
    expect(seen.find((e) => e.type === 'matchOver')).toEqual({ type: 'matchOver', winner: 1 });
    expect(s.phase).toBe('matchOver');
    const frozen = JSON.stringify(s.snakes);
    expect(run(s, 30, c)).toEqual([]);
    expect(JSON.stringify(s.snakes)).toBe(frozen);
  });

  it('rematch resets scores and starts a new countdown on Open', () => {
    const c = { ...cfg, winsToWin: 1 };
    const s = toPlaying(c);
    aimAtWall(s, 0);
    run(s, 10 + Math.round(c.roundOverSeconds * TICK_RATE), c);
    expect(s.phase).toBe('matchOver');
    rematch(s, c, 99);
    expect(s.phase).toBe('countdown');
    expect(s.scores).toEqual([0, 0]);
    expect(s.round).toBe(1);
    expect(s.matchWinner).toBeNull();
    expect(s.mapIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/step.test.ts`
Expected: FAIL with "Failed to resolve import './step'".

- [ ] **Step 3: Implement**

```ts file=src/sim/step.ts
import { detectHit, type Hit } from './collision';
import { TICK_RATE, type Config } from './config';
import { MAPS } from './maps';
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

  const growth = growthRate(cfg, state.overtime);
  state.snakes.forEach((s, i) => {
    if (s.alive && advanceSnake(s, i, inputs[i] ?? NO_INPUT, cfg, growth, state.grid)) {
      events.push({ type: 'boostStarted', player: i });
    }
  });

  // Evaluate every head before applying any death, so simultaneous deaths are fair.
  const hits: Array<Hit | null> = state.snakes.map((s, i) => (s.alive ? detectHit(state, i, cfg) : null));
  hits.forEach((hit, i) => {
    if (!hit) return;
    const s = state.snakes[i];
    s.alive = false;
    const record: DeathRecord = { player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y };
    state.deaths.push(record);
    events.push({ type: 'death', ...record });
  });

  const alive = state.snakes.filter((s) => s.alive);
  const timeUp = state.roundTicks >= Math.round(cfg.roundMaxSeconds * TICK_RATE);
  if (alive.length === 1) endRound(state, cfg, events, alive[0].id);
  else if (alive.length === 0 || timeUp) endRound(state, cfg, events, null);
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

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/sim && git commit -q -F- <<'EOF'
feat(sim): tick loop with countdown, deaths, scoring, overtime and rematch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 9: Invariants, test bot, determinism and soak

**Files:**
- Create: `src/sim/invariants.ts`, `src/sim/bots/simple-bot.ts`, `src/sim/index.ts`, `scripts/soak.ts`
- Test: `src/sim/determinism.test.ts`, `src/sim/soak.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces:
  - `checkInvariants(state, cfg): string[]` (an empty list means healthy).
  - Bot: `interface BotState`, `createBot(seed): BotState`, `botInput(bot, state, idx, cfg): PlayerInput`.
  - The public sim API in `src/sim/index.ts`, which the client imports from `'../sim'`.
  - `pnpm soak [--rounds N] [--seed S]`.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/determinism.test.ts
import { describe, expect, it } from 'vitest';
import { botInput, createBot, type BotState } from './bots/simple-bot';
import { DEFAULT_CONFIG } from './config';
import { cloneState, createMatch } from './state';
import { step } from './step';
import type { MatchState } from './types';

function drive(state: MatchState, bots: BotState[], ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    step(state, bots.map((b, i) => botInput(b, state, i, DEFAULT_CONFIG)), DEFAULT_CONFIG);
  }
}

describe('determinism', () => {
  it('replays identically from the same seed and inputs', () => {
    const a = createMatch(DEFAULT_CONFIG, 2024);
    const b = createMatch(DEFAULT_CONFIG, 2024);
    drive(a, [createBot(1), createBot(2)], 4000);
    drive(b, [createBot(1), createBot(2)], 4000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('continues identically from a cloned state', () => {
    const a = createMatch(DEFAULT_CONFIG, 7);
    const bots = [createBot(3), createBot(4)];
    drive(a, bots, 1500);
    const b = cloneState(a);
    const botsB = structuredClone(bots);
    drive(a, bots, 2500);
    drive(b, botsB, 2500);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
```

```ts file=src/sim/soak.test.ts
import { describe, expect, it } from 'vitest';
import { botInput, createBot } from './bots/simple-bot';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { checkInvariants } from './invariants';
import { createMatch } from './state';
import { rematch, step } from './step';

function soak(cfg: Config, rounds: number, seed: number) {
  const state = createMatch(cfg, seed);
  const bots = [createBot(seed + 1), createBot(seed + 2)];
  const problems: string[] = [];
  const lengths: number[] = [];
  const limit = rounds * (Math.round((cfg.roundMaxSeconds + cfg.countdownSeconds + cfg.roundOverSeconds) * TICK_RATE) + 10);
  for (let t = 0; t < limit && lengths.length < rounds; t++) {
    const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
    for (const e of events) if (e.type === 'roundOver') lengths.push(state.roundTicks);
    if (events.length > 0 || t % 97 === 0) problems.push(...checkInvariants(state, cfg));
    if (state.phase === 'matchOver') rematch(state, cfg, seed + t);
  }
  return { problems, lengths };
}

const FAST: Config = {
  ...DEFAULT_CONFIG,
  growthPerSecond: 150,
  overtimeAt: 20,
  roundMaxSeconds: 60,
  countdownSeconds: 1,
  roundOverSeconds: 1,
};

describe('soak', () => {
  it('plays many bot rounds without breaking invariants', () => {
    const { problems, lengths } = soak(FAST, 12, 11);
    expect(problems).toEqual([]);
    expect(lengths).toHaveLength(12);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(60 * TICK_RATE);
  });

  // Review Focus 4: extreme tuning-panel values must stay healthy.
  const extremes: Array<[string, Partial<Config>]> = [
    ['a tiny turning radius', { turnRate: 8, baseSpeed: 60 }],
    ['huge snakes and a short neck', { snakeRadius: 14, neckLength: 10 }],
    ['zero growth', { growthPerSecond: 0, overtimeGrowthMultiplier: 1, startLength: 20 }],
    ['a twitchy boost', { boostMeterSeconds: 0.5, boostRefillSeconds: 1, boostMultiplier: 3 }],
    ['fast, long snakes', { baseSpeed: 400, startLength: 600 }],
  ];
  for (const [name, overrides] of extremes) {
    it(`stays healthy with ${name}`, () => {
      const { problems, lengths } = soak({ ...FAST, ...overrides }, 3, 5);
      expect(problems).toEqual([]);
      expect(lengths).toHaveLength(3);
    });
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/determinism.test.ts src/sim/soak.test.ts`
Expected: FAIL with "Failed to resolve import './bots/simple-bot'".

- [ ] **Step 3: Implement**

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
  });
  const points = state.scores.reduce((a, b) => a + b, 0);
  if (points > state.round) problems.push(`${points} points after ${state.round} rounds`);
  return problems;
}
```

```ts file=src/sim/bots/simple-bot.ts
import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, type Config } from '../config';
import { detCos, detSin } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
import { NO_INPUT, type MatchState, type PlayerInput } from '../types';

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

const LOOK_STEPS = 12;
const STEP_TICKS = 3;
const TURNS = [-1, 0, 1] as const;

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

  let turn: -1 | 0 | 1;
  if (bot.wanderTicks > 0 && clear[bot.wanderTurn + 1] === LOOK_STEPS) turn = bot.wanderTurn;
  else if (clear[1] === best) turn = 0;
  else {
    const options = TURNS.filter((_, k) => clear[k] === best);
    turn = options[rngInt(bot.rng, options.length)];
  }

  if (bot.boostTicks > 0) bot.boostTicks--;
  else if (best === LOOK_STEPS && rngNext(bot.rng) < 0.004) bot.boostTicks = 20 + rngInt(bot.rng, 40);

  return { turn, boost: bot.boostTicks > 0, use: false };
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
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive) continue;
      const dx = other.x - x;
      const dy = other.y - y;
      if (dx * dx + dy * dy < 16 * r * r) return k - 1;
    }
  }
  return LOOK_STEPS;
}
```

```ts file=src/sim/index.ts
export * from './config';
export * from './types';
export { MAPS } from './maps';
export { cloneState, createMatch } from './state';
export { rematch, step } from './step';
export { checkInvariants } from './invariants';
export { botInput, createBot, type BotState } from './bots/simple-bot';
```

```ts file=scripts/soak.ts
import { botInput, checkInvariants, createBot, createMatch, DEFAULT_CONFIG, rematch, step, TICK_RATE } from '../src/sim';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const rounds = Number(args.get('rounds') ?? 100);
const seed = Number(args.get('seed') ?? 1);
const cfg = { ...DEFAULT_CONFIG };

const state = createMatch(cfg, seed);
const bots = [createBot(seed + 1), createBot(seed + 2)];
const lengths: number[] = [];
const causes = new Map<string, number>();
const problems: string[] = [];
let draws = 0;
let ticks = 0;
const started = performance.now();

while (lengths.length < rounds) {
  const events = step(state, bots.map((b, i) => botInput(b, state, i, cfg)), cfg);
  ticks++;
  for (const e of events) {
    if (e.type === 'death') causes.set(e.cause, (causes.get(e.cause) ?? 0) + 1);
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
console.log(`speed: ${(ticks / TICK_RATE / wall).toFixed(0)}× real time (${wall.toFixed(1)} s wall clock)`);
if (problems.length > 0) {
  console.error(`${problems.length} invariant problems; first: ${problems.slice(0, 5).join(' | ')}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run the tests and the soak**

Run: `pnpm vitest run src/sim && pnpm typecheck && pnpm soak --rounds 60`
Expected: all tests pass. The soak prints stats, reports a speed of at least 50× real time, and exits 0. Record the median and p90 round lengths for the checkpoint report. Bots only approximate human play, so values outside 60–180 s aren't a failure here. They'll inform the tuning discussion at the checkpoint.

- [ ] **Step 5: Commit**

```bash
git add src/sim scripts && git commit -q -F- <<'EOF'
feat(sim): invariants, look-ahead test bot, determinism tests and soak script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 10: Client foundations — keys, input, loop, text and settings

**Files:**
- Create: `src/client/keys.ts`, `src/client/input.ts`, `src/client/loop.ts`, `src/client/text.ts`, `src/client/settings.ts`
- Test: `src/client/input.test.ts`, `src/client/loop.test.ts`, `src/client/text.test.ts`, `src/client/settings.test.ts`

**Interfaces:**
- Consumes: `PlayerInput`, `DeathRecord`, `DEFAULT_CONFIG` from `'../sim'`.
- Produces:
  - Keys: `interface Binding`, `BINDINGS`, `GAME_KEYS`, `inputFromKeys(down, binding, usePressed): PlayerInput`.
  - Input: `class KeyboardInput(target: EventTarget)` with `sample(): PlayerInput[]`, `onKey(handler)`, `onBlur(handler)` and `isDown(code)`.
  - Loop: `interface Clock`, `browserClock`, and `class FixedLoop(tick, render(alpha, frameSeconds), clock?, dt?, maxSteps?, maxFrame?)` with `start()`, `frame(now)` and `timeScale`.
  - Text: `PLAYER_NAMES`, `describeDeath(record, names?)`, `describeRound(winner, deaths, names?) → { title, detail }`, `formatClock(ticks)`.
  - Settings:
    - `interface ClientSettings { bloom; bloomStrength; bloomThreshold; shakeScale; masterVolume; muted }` and `DEFAULT_SETTINGS`
    - `mergeSaved(defaults, saved)`, `loadStored(storage, key, defaults)`, `saveStored(storage, key, value)`, `browserStorage()`
    - `CONFIG_KEY`, `SETTINGS_KEY`

- [ ] **Step 1: Write the failing tests**

```ts file=src/client/input.test.ts
import { describe, expect, it } from 'vitest';
import { KeyboardInput } from './input';
import { BINDINGS, inputFromKeys } from './keys';

function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  return Object.assign(new Event(type), { code, repeat });
}

const idle = { turn: 0, boost: false, use: false };

describe('inputFromKeys', () => {
  const [p1, p2] = BINDINGS;

  it('maps turn keys to -1/0/+1 and treats both held as straight', () => {
    expect(inputFromKeys(new Set(['KeyA']), p1, false).turn).toBe(-1);
    expect(inputFromKeys(new Set(['KeyD']), p1, false).turn).toBe(1);
    expect(inputFromKeys(new Set(['KeyA', 'KeyD']), p1, false).turn).toBe(0);
    expect(inputFromKeys(new Set(), p1, false)).toEqual(idle);
  });

  // Review Focus 1: both players mashing keys at once.
  it("keeps the two players' inputs independent when many keys are held", () => {
    const all = new Set(['KeyA', 'KeyW', 'ArrowRight', 'ArrowUp', 'ArrowLeft']);
    expect(inputFromKeys(all, p1, false)).toEqual({ turn: -1, boost: true, use: false });
    expect(inputFromKeys(all, p2, true)).toEqual({ turn: 0, boost: true, use: true });
  });
});

describe('KeyboardInput', () => {
  it('latches a quick Use tap until the next sample', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    target.dispatchEvent(key('keydown', 'KeyS'));
    target.dispatchEvent(key('keyup', 'KeyS'));
    expect(input.sample()[0].use).toBe(true);
    expect(input.sample()[0].use).toBe(false);
  });

  it('ignores key repeat', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    const codes: string[] = [];
    input.onKey((code) => codes.push(code));
    target.dispatchEvent(key('keydown', 'ArrowDown'));
    input.sample();
    target.dispatchEvent(key('keydown', 'ArrowDown', true));
    expect(input.sample()[1].use).toBe(false);
    expect(codes).toEqual(['ArrowDown']);
  });

  // Review Focus 2: losing focus mid-round must not leave a snake turning forever.
  it('releases every key and notifies listeners when the window loses focus', () => {
    const target = new EventTarget();
    const input = new KeyboardInput(target);
    let blurs = 0;
    input.onBlur(() => blurs++);
    target.dispatchEvent(key('keydown', 'KeyA'));
    target.dispatchEvent(key('keydown', 'ArrowUp'));
    target.dispatchEvent(key('keydown', 'KeyS'));
    target.dispatchEvent(new Event('blur'));
    expect(input.sample()).toEqual([idle, idle]);
    expect(blurs).toBe(1);
  });
});
```

```ts file=src/client/loop.test.ts
import { describe, expect, it } from 'vitest';
import { FixedLoop, type Clock } from './loop';

function fakeClock(): Clock {
  return { now: () => 0, request: () => {} };
}

const TICK_MS = 1000 / 60;

describe('FixedLoop', () => {
  it('runs one tick per 1/60 s and reports the interpolation alpha', () => {
    let ticks = 0;
    let alpha = -1;
    const loop = new FixedLoop(() => ticks++, (a) => (alpha = a), fakeClock());
    loop.start();
    loop.frame(TICK_MS * 2.5);
    expect(ticks).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 6);
  });

  // Review Focus 3: a long-hidden tab must not fast-forward the game.
  it('runs at most 5 catch-up ticks after a long pause, then resumes normally', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.start();
    loop.frame(10_000);
    expect(ticks).toBe(5);
    loop.frame(10_000 + TICK_MS + 1);
    expect(ticks).toBe(6);
  });

  it('scales simulated time by timeScale', () => {
    let ticks = 0;
    const loop = new FixedLoop(() => ticks++, () => {}, fakeClock());
    loop.timeScale = 0.5;
    loop.start();
    loop.frame(TICK_MS * 4 + 1);
    expect(ticks).toBe(2);
  });
});
```

```ts file=src/client/text.test.ts
import { describe, expect, it } from 'vitest';
import type { DeathCause, DeathRecord } from '../sim';
import { describeDeath, describeRound, formatClock } from './text';

const d = (player: number, cause: DeathCause, killer: number | null): DeathRecord => ({ player, cause, killer, x: 0, y: 0 });

describe('text', () => {
  it('describes every cause of death', () => {
    expect(describeDeath(d(1, 'body', 0))).toBe("PINK hit CYAN's body");
    expect(describeDeath(d(0, 'self', 0))).toBe('CYAN hit their own tail');
    expect(describeDeath(d(0, 'wall', null))).toBe('CYAN hit the wall');
    expect(describeDeath(d(1, 'obstacle', null))).toBe('PINK crashed into a block');
    expect(describeDeath(d(0, 'blast', 0))).toBe('CYAN blew themselves up');
    expect(describeDeath(d(0, 'blast', 1))).toBe('CYAN got blasted by PINK');
    expect(describeDeath(d(0, 'headOn', 1))).toBe('Head-on collision');
  });

  it('titles the round and merges duplicate lines', () => {
    expect(describeRound(0, [d(1, 'wall', null)])).toEqual({ title: 'CYAN SCORES', detail: 'PINK hit the wall' });
    expect(describeRound(null, [d(0, 'headOn', 1), d(1, 'headOn', 0)])).toEqual({ title: 'DRAW', detail: 'Head-on collision' });
    expect(describeRound(null, [d(0, 'wall', null), d(1, 'wall', null)]).detail).toBe('CYAN hit the wall · PINK hit the wall');
    expect(describeRound(null, [])).toEqual({ title: 'DRAW', detail: 'Time ran out' });
  });

  it('formats the round clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(61 * 60)).toBe('1:01');
    expect(formatClock(150 * 60 + 59)).toBe('2:30');
  });
});
```

```ts file=src/client/settings.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../sim';
import { DEFAULT_SETTINGS, loadStored, mergeSaved, saveStored } from './settings';

describe('mergeSaved', () => {
  const defaults = { speed: 170, on: true, weights: { a: 1, b: 2 } };

  it('keeps valid saved values and ignores unknown keys', () => {
    const saved = { speed: 200, on: false, weights: { a: 5, b: 'x' }, extra: 1 };
    expect(mergeSaved(defaults, saved)).toEqual({ speed: 200, on: false, weights: { a: 5, b: 2 } });
  });

  // Review Focus 5: corrupted or outdated saved settings.
  it('rejects wrong types, NaN and Infinity', () => {
    expect(mergeSaved(defaults, { speed: 'fast', on: 1, weights: 3 })).toEqual(defaults);
    expect(mergeSaved(defaults, { speed: Number.NaN })).toEqual(defaults);
    expect(mergeSaved(defaults, JSON.parse('{"speed": 1e999}'))).toEqual(defaults);
    expect(mergeSaved(defaults, [1, 2])).toEqual(defaults);
  });

  it('returns a fresh copy', () => {
    const out = mergeSaved(defaults, null);
    out.weights.a = 99;
    expect(defaults.weights.a).toBe(1);
  });
});

describe('loadStored / saveStored', () => {
  it('falls back to defaults on corrupted JSON', () => {
    expect(loadStored({ getItem: () => '{not json' }, 'k', DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
  });

  it('falls back to defaults when storage throws or is missing', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
    };
    expect(loadStored(throwing, 'k', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(loadStored(undefined, 'k', DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips values', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveStored(storage, 'k', { ...DEFAULT_SETTINGS, muted: true });
    expect(loadStored(storage, 'k', DEFAULT_SETTINGS).muted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/client`
Expected: FAIL with "Failed to resolve import './input'", "'./loop'", "'./text'" and "'./settings'".

- [ ] **Step 3: Implement**

```ts file=src/client/keys.ts
import type { PlayerInput } from '../sim';

export interface Binding {
  left: string;
  right: string;
  boost: string;
  use: string;
}

/** Physical key codes (KeyboardEvent.code), so every keyboard layout works. */
export const BINDINGS: Binding[] = [
  { left: 'KeyA', right: 'KeyD', boost: 'KeyW', use: 'KeyS' },
  { left: 'ArrowLeft', right: 'ArrowRight', boost: 'ArrowUp', use: 'ArrowDown' },
];

/** Keys whose browser default action (scrolling, typing) is suppressed. */
export const GAME_KEYS: ReadonlySet<string> = new Set([
  ...BINDINGS.flatMap((b) => [b.left, b.right, b.boost, b.use]),
  'Space',
  'Backquote',
]);

export function inputFromKeys(down: ReadonlySet<string>, b: Binding, usePressed: boolean): PlayerInput {
  const left = down.has(b.left);
  const right = down.has(b.right);
  return { turn: left === right ? 0 : left ? -1 : 1, boost: down.has(b.boost), use: usePressed };
}
```

```ts file=src/client/input.ts
import type { PlayerInput } from '../sim';
import { BINDINGS, GAME_KEYS, inputFromKeys } from './keys';

/** Tracks held keys and latches Use presses between sim ticks. */
export class KeyboardInput {
  private readonly down = new Set<string>();
  private readonly useLatched = BINDINGS.map(() => false);
  private readonly keyHandlers: Array<(code: string) => void> = [];
  private readonly blurHandlers: Array<() => void> = [];

  constructor(target: EventTarget) {
    target.addEventListener('keydown', (e) => this.onKeyDown(e as KeyboardEvent));
    target.addEventListener('keyup', (e) => this.down.delete((e as KeyboardEvent).code));
    target.addEventListener('blur', () => this.releaseAll());
  }

  /** Called for every fresh (non-repeat) key press. */
  onKey(handler: (code: string) => void): void {
    this.keyHandlers.push(handler);
  }

  /** Called when the window loses focus (after all keys are released). */
  onBlur(handler: () => void): void {
    this.blurHandlers.push(handler);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Inputs for one sim tick; consumes latched Use presses. */
  sample(): PlayerInput[] {
    const out = BINDINGS.map((b, i) => inputFromKeys(this.down, b, this.useLatched[i]));
    this.useLatched.fill(false);
    return out;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    BINDINGS.forEach((b, i) => {
      if (e.code === b.use) this.useLatched[i] = true;
    });
    for (const handler of this.keyHandlers) handler(e.code);
  }

  private releaseAll(): void {
    this.down.clear();
    this.useLatched.fill(false);
    for (const handler of this.blurHandlers) handler();
  }
}
```

```ts file=src/client/loop.ts
export interface Clock {
  now(): number;
  request(callback: (now: number) => void): void;
}

export const browserClock: Clock = {
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
};

/**
 * Fixed-timestep loop: calls `tick` at 1/dt per second of (scaled) time and `render` once per
 * frame with the interpolation alpha. Long gaps are clamped so a hidden tab never fast-forwards.
 */
export class FixedLoop {
  timeScale = 1;
  private acc = 0;
  private last = 0;

  constructor(
    private readonly tick: () => void,
    private readonly render: (alpha: number, frameSeconds: number) => void,
    private readonly clock: Clock = browserClock,
    private readonly dt = 1 / 60,
    private readonly maxSteps = 5,
    private readonly maxFrame = 0.25,
  ) {}

  start(): void {
    this.last = this.clock.now();
    this.clock.request(this.frame);
  }

  /** One animation frame. Public so tests can drive it with a fake clock. */
  readonly frame = (now: number): void => {
    const frameSeconds = Math.min(this.maxFrame, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += frameSeconds * this.timeScale;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      this.tick();
      this.acc -= this.dt;
      steps++;
    }
    if (this.acc >= this.dt) this.acc = 0;
    this.render(this.acc / this.dt, frameSeconds);
    this.clock.request(this.frame);
  };
}
```

```ts file=src/client/text.ts
import type { DeathRecord } from '../sim';

export const PLAYER_NAMES: readonly string[] = ['CYAN', 'PINK'];

export function describeDeath(d: DeathRecord, names: readonly string[] = PLAYER_NAMES): string {
  const victim = names[d.player];
  const killer = d.killer === null ? '' : names[d.killer];
  switch (d.cause) {
    case 'wall':
      return `${victim} hit the wall`;
    case 'obstacle':
      return `${victim} crashed into a block`;
    case 'self':
      return `${victim} hit their own tail`;
    case 'body':
      return `${victim} hit ${killer}'s body`;
    case 'headOn':
      return 'Head-on collision';
    case 'blast':
      return d.killer === d.player ? `${victim} blew themselves up` : `${victim} got blasted by ${killer}`;
  }
}

export function describeRound(
  winner: number | null,
  deaths: readonly DeathRecord[],
  names: readonly string[] = PLAYER_NAMES,
): { title: string; detail: string } {
  const title = winner === null ? 'DRAW' : `${names[winner]} SCORES`;
  const lines: string[] = [];
  for (const d of deaths) {
    const line = describeDeath(d, names);
    if (!lines.includes(line)) lines.push(line);
  }
  return { title, detail: lines.length > 0 ? lines.join(' · ') : 'Time ran out' };
}

export function formatClock(ticks: number, tickRate = 60): string {
  const seconds = Math.floor(ticks / tickRate);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
```

```ts file=src/client/settings.ts
/** Client-only preferences (effects and audio); gameplay values live in the sim Config. */
export interface ClientSettings {
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  shakeScale: number;
  masterVolume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: ClientSettings = {
  bloom: true,
  bloomStrength: 1.5,
  bloomThreshold: 0.2,
  shakeScale: 1,
  masterVolume: 0.6,
  muted: false,
};

export const CONFIG_KEY = 'snakeboom.config.v1';
export const SETTINGS_KEY = 'snakeboom.settings.v1';

/**
 * A fresh copy of `defaults` with every saved value of the same type applied. Unknown keys,
 * wrong types, NaN and Infinity are ignored. Nested plain objects merge one level at a time.
 */
export function mergeSaved<T extends object>(defaults: T, saved: unknown): T {
  const out = structuredClone(defaults) as Record<string, unknown>;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return out as T;
  const src = saved as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const d = out[key];
    const v = src[key];
    if (typeof d === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    } else if (typeof d === 'boolean') {
      if (typeof v === 'boolean') out[key] = v;
    } else if (d && typeof d === 'object' && !Array.isArray(d)) {
      out[key] = mergeSaved(d, v);
    }
  }
  return out as T;
}

export function loadStored<T extends object>(
  storage: Pick<Storage, 'getItem'> | undefined,
  key: string,
  defaults: T,
): T {
  try {
    const raw = storage?.getItem(key);
    return mergeSaved(defaults, raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(defaults);
  }
}

export function saveStored(storage: Pick<Storage, 'setItem'> | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: settings simply won't persist this session.
  }
}

/** window.localStorage, or undefined where the browser blocks it. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS (sim and client); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/client && git commit -q -F- <<'EOF'
feat(client): keyboard input, fixed-step loop, round text and settings persistence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 11: Neon renderer — world, arena and chunked snakes

**Files:**
- Create: `src/client/colors.ts`, `src/client/render/world.ts`, `src/client/render/arena.ts`, `src/client/render/snakes.ts`, `src/client/render/renderer.ts`

**Interfaces:**
- Consumes: `MatchState`, `SnakeState`, `Config`, `ARENA_WIDTH`, `ARENA_HEIGHT`, `TILE_COLS`, `TILE_SIZE` from `'../../sim'`, and `ClientSettings`.
- Produces:
  - Colors: `PLAYER_COLORS: number[]` and `PALETTE`.
  - World: `HUD_HEIGHT = 64`, `interface World { app; root; bg; glow; bloom; base: {x, y, scale} }`, `createWorld(host, settings): Promise<World>`, `applyBloom(world, settings)`.
  - `class ArenaView(world)` with `drawTiles(tiles)`.
  - `class SnakeView(parent, color)` with `update(snake, alpha, radius)`, `hide()` and `reset()`.
  - `class Renderer(world)` with `draw(state | null, alpha, cfg)`.

This task has no unit tests, because it is pure drawing. Task 15 verifies it with screenshots in a real browser.

- [ ] **Step 1: Check the PixiJS 8 APIs used below against the installed version**

Run: `grep -n "class AdvancedBloomFilter" -A 30 node_modules/pixi-filters/lib/advanced-bloom/AdvancedBloomFilter.d.ts | head -40; grep -rn "stroke(" node_modules/pixi.js/lib/scene/graphics/shared/Graphics.d.ts | head -5`
Expected: `AdvancedBloomFilter` accepts `{ threshold, bloomScale, brightness, blur, quality }`, and `Graphics` exposes `moveTo`, `lineTo`, `circle`, `rect`, `fill` and `stroke({ width, color, alpha, cap, join })`. If a name differs, adapt the code to the installed API. Keep the behavior the same.

- [ ] **Step 2: Write the renderer**

```ts file=src/client/colors.ts
export const PLAYER_COLORS: number[] = [0x22f3ff, 0xff2e97];

export const PALETTE = {
  background: 0x05060d,
  gridLine: 0x0f1a2e,
  border: 0x9fd8ff,
  obstacle: 0xffb020,
  obstacleFill: 0x2a1a00,
  core: 0xffffff,
};

export const PLAYER_CSS = ['var(--cyan)', 'var(--pink)'];
```

```ts file=src/client/render/world.ts
import { Application, Container } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { ARENA_HEIGHT, ARENA_WIDTH } from '../../sim';
import { PALETTE } from '../colors';
import type { ClientSettings } from '../settings';

export const HUD_HEIGHT = 64;
const MARGIN = 16;

export interface World {
  app: Application;
  /** Scaled and letterboxed to fit the arena under the HUD; shaken by Fx via `base`. */
  root: Container;
  /** Layers that should not bloom (background grid). */
  bg: Container;
  /** Layers that bloom (border, blocks, snakes, effects). */
  glow: Container;
  bloom: AdvancedBloomFilter;
  base: { x: number; y: number; scale: number };
}

export async function createWorld(host: HTMLElement, settings: ClientSettings): Promise<World> {
  const app = new Application();
  await app.init({
    resizeTo: window,
    background: PALETTE.background,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    powerPreference: 'high-performance',
  });
  host.appendChild(app.canvas);

  const root = new Container();
  const bg = new Container();
  const glow = new Container();
  root.addChild(bg, glow);
  app.stage.addChild(root);

  const bloom = new AdvancedBloomFilter({ threshold: 0.2, bloomScale: 1.5, brightness: 1, blur: 8, quality: 6 });
  const world: World = { app, root, bg, glow, bloom, base: { x: 0, y: 0, scale: 1 } };
  applyBloom(world, settings);

  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const scale = Math.max(0.1, Math.min((w - 2 * MARGIN) / ARENA_WIDTH, (h - HUD_HEIGHT - MARGIN) / ARENA_HEIGHT));
    world.base.scale = scale;
    world.base.x = (w - ARENA_WIDTH * scale) / 2;
    world.base.y = HUD_HEIGHT + (h - HUD_HEIGHT - MARGIN - ARENA_HEIGHT * scale) / 2;
    root.scale.set(scale);
    root.position.set(world.base.x, world.base.y);
  };
  layout();
  app.renderer.on('resize', layout);
  return world;
}

export function applyBloom(world: World, settings: ClientSettings): void {
  world.bloom.threshold = settings.bloomThreshold;
  world.bloom.bloomScale = settings.bloomStrength;
  world.glow.filters = settings.bloom ? [world.bloom] : [];
}
```

```ts file=src/client/render/arena.ts
import { Graphics } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_SIZE } from '../../sim';
import { PALETTE } from '../colors';
import type { World } from './world';

const GRID_STEP = 40;

/** Background grid (no bloom), glowing border and obstacle blocks (bloom). */
export class ArenaView {
  private readonly grid = new Graphics();
  private readonly border = new Graphics();
  private readonly blocks = new Graphics();

  constructor(world: World) {
    world.bg.addChild(this.grid);
    world.glow.addChild(this.border, this.blocks);
    for (let x = GRID_STEP; x < ARENA_WIDTH; x += GRID_STEP) this.grid.moveTo(x, 0).lineTo(x, ARENA_HEIGHT);
    for (let y = GRID_STEP; y < ARENA_HEIGHT; y += GRID_STEP) this.grid.moveTo(0, y).lineTo(ARENA_WIDTH, y);
    this.grid.stroke({ width: 1, color: PALETTE.gridLine, alpha: 0.9 });
    this.border.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).stroke({ width: 4, color: PALETTE.border, alpha: 0.9 });
  }

  drawTiles(tiles: readonly number[]): void {
    const g = this.blocks;
    g.clear();
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== 1) continue;
      const x = (i % TILE_COLS) * TILE_SIZE;
      const y = Math.floor(i / TILE_COLS) * TILE_SIZE;
      g.rect(x + 1.5, y + 1.5, TILE_SIZE - 3, TILE_SIZE - 3);
    }
    g.fill({ color: PALETTE.obstacleFill }).stroke({ width: 2, color: PALETTE.obstacle });
  }
}
```

```ts file=src/client/render/snakes.ts
import { Container, Graphics } from 'pixi.js';
import type { SnakeState, Trail } from '../../sim';
import { PALETTE } from '../colors';

/** Points per body chunk. Only the tail and head chunks are redrawn each frame. */
const CHUNK = 128;

/** Draws one snake as a neon tube (colored stroke + bright core) with a glowing head. */
export class SnakeView {
  private readonly body = new Container();
  private readonly head = new Graphics();
  private readonly chunks = new Map<number, Graphics>();

  constructor(
    parent: Container,
    private readonly color: number,
  ) {
    const layer = new Container();
    layer.addChild(this.body, this.head);
    parent.addChild(layer);
  }

  reset(): void {
    for (const g of this.chunks.values()) g.destroy();
    this.chunks.clear();
    this.head.clear();
    this.body.visible = true;
    this.head.visible = true;
  }

  hide(): void {
    this.body.visible = false;
    this.head.visible = false;
  }

  update(s: SnakeState, alpha: number, radius: number): void {
    this.body.visible = true;
    this.head.visible = true;
    const t = s.trail;
    const startSeq = t.baseSeq + t.start;
    const headSeq = t.baseSeq + t.xs.length - 1;
    const firstChunk = Math.floor(startSeq / CHUNK);
    const lastChunk = Math.floor(headSeq / CHUNK);

    for (const [k, g] of this.chunks) {
      if (k < firstChunk) {
        g.destroy();
        this.chunks.delete(k);
      }
    }

    const hx = s.prevX + (s.x - s.prevX) * alpha;
    const hy = s.prevY + (s.y - s.prevY) * alpha;
    for (let k = firstChunk; k <= lastChunk; k++) {
      let g = this.chunks.get(k);
      const fresh = !g;
      if (!g) {
        g = new Graphics();
        this.chunks.set(k, g);
        this.body.addChild(g);
      }
      if (fresh || k === firstChunk || k >= lastChunk - 1) {
        this.drawChunk(g, t, k, startSeq, headSeq, hx, hy, radius);
      }
    }
    this.drawHead(hx, hy, s.heading, radius);
  }

  private drawChunk(
    g: Graphics,
    t: Trail,
    k: number,
    startSeq: number,
    headSeq: number,
    hx: number,
    hy: number,
    radius: number,
  ): void {
    g.clear();
    // Overlap one point with the previous chunk so chunks join seamlessly.
    const from = Math.max(k * CHUNK - 1, startSeq);
    const to = Math.min((k + 1) * CHUNK, headSeq);
    const runs: number[][] = [];
    let run: number[] = [];
    for (let seq = from; seq <= to; seq++) {
      const i = seq - t.baseSeq;
      if (!t.solid[i]) {
        if (run.length > 0) runs.push(run);
        run = [];
        continue;
      }
      if (seq === headSeq) run.push(hx, hy);
      else run.push(t.xs[i], t.ys[i]);
    }
    if (run.length > 0) runs.push(run);

    for (const pass of [
      { width: radius * 2, color: this.color, alpha: 1 },
      { width: Math.max(1.5, radius * 0.7), color: PALETTE.core, alpha: 0.85 },
    ]) {
      for (const pts of runs) {
        if (pts.length === 2) {
          g.circle(pts[0], pts[1], pass.width / 2).fill({ color: pass.color, alpha: pass.alpha });
          continue;
        }
        g.moveTo(pts[0], pts[1]);
        for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]);
        g.stroke({ width: pass.width, color: pass.color, alpha: pass.alpha, cap: 'round', join: 'round' });
      }
    }
  }

  private drawHead(x: number, y: number, heading: number, radius: number): void {
    const g = this.head;
    g.clear();
    g.circle(x, y, radius * 1.25).fill({ color: this.color });
    g.circle(x, y, radius * 0.7).fill({ color: PALETTE.core });
    const ex = x + Math.cos(heading) * radius * 0.55;
    const ey = y + Math.sin(heading) * radius * 0.55;
    g.circle(ex, ey, Math.max(1.2, radius * 0.28)).fill({ color: PALETTE.background });
  }
}
```

```ts file=src/client/render/renderer.ts
import type { Config, MatchState } from '../../sim';
import { PLAYER_COLORS } from '../colors';
import { ArenaView } from './arena';
import { SnakeView } from './snakes';
import type { World } from './world';

/** Draws a MatchState. Round changes are detected by the tiles array being replaced. */
export class Renderer {
  private readonly arena: ArenaView;
  private readonly snakes: SnakeView[];
  private lastTiles: readonly number[] | null = null;

  constructor(world: World) {
    this.arena = new ArenaView(world);
    this.snakes = PLAYER_COLORS.map((color) => new SnakeView(world.glow, color));
  }

  draw(state: MatchState | null, alpha: number, cfg: Config): void {
    if (!state) {
      if (this.lastTiles) {
        this.arena.drawTiles([]);
        for (const view of this.snakes) view.reset();
        this.lastTiles = null;
      }
      for (const view of this.snakes) view.hide();
      return;
    }
    if (state.tiles !== this.lastTiles) {
      this.arena.drawTiles(state.tiles);
      for (const view of this.snakes) view.reset();
      this.lastTiles = state.tiles;
    }
    state.snakes.forEach((s, i) => {
      const view = this.snakes[i];
      if (!view) return;
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg.snakeRadius);
      else view.hide();
    });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean. Fix any API-name mismatches against the installed PixiJS and pixi-filters types.

- [ ] **Step 4: Commit**

```bash
git add src/client && git commit -q -F- <<'EOF'
feat(client): neon PixiJS renderer with bloom, arena grid and chunked snake tubes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 12: HUD, screens and neon CSS

**Files:**
- Create: `src/client/style.css`, `src/client/hud.ts`, `src/client/screens.ts`

**Interfaces:**
- Consumes: `MatchState`, `Config`, `TICK_RATE`, `formatClock`, `PLAYER_NAMES`, `PLAYER_CSS`.
- Produces:
  - `class Hud(root: HTMLElement)` with `update(state | null, cfg)`.
  - `class Screens(root: HTMLElement)` with these methods:
    - `title(winsToWin)`
    - `countdown(n | 'GO')`
    - `roundOver(title, detail, winner | null)`
    - `matchOver(winner, scores)`
    - `paused()`
    - `clear()`

The HUD and screens are verified visually in Task 15.

- [ ] **Step 1: Write the styles and overlays**

```css file=src/client/style.css
:root {
  --bg: #05060d;
  --cyan: #22f3ff;
  --pink: #ff2e97;
  --text: #e8f4ff;
  --dim: #7d8db0;
  --red: #ff3b3b;
  --hud-h: 64px;
}

html,
body {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font-family: 'Orbitron', system-ui, sans-serif;
  user-select: none;
}

#game {
  position: fixed;
  inset: 0;
}

#hud {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--hud-h);
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 0 24px;
  pointer-events: none;
  visibility: hidden;
}

#hud.on {
  visibility: visible;
}

.side {
  display: flex;
  align-items: center;
  gap: 16px;
}

.side.p2 {
  flex-direction: row-reverse;
}

.side.p1 {
  color: var(--cyan);
}

.side.p2 {
  color: var(--pink);
}

.name {
  font-weight: 900;
  letter-spacing: 0.14em;
  text-shadow: 0 0 8px currentColor, 0 0 20px currentColor;
}

.pips {
  display: flex;
  gap: 6px;
}

.pip {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.45;
}

.pip.on {
  background: currentColor;
  opacity: 1;
  box-shadow: 0 0 10px currentColor;
}

.boost {
  width: 110px;
  height: 8px;
  border: 1px solid currentColor;
  border-radius: 4px;
  overflow: hidden;
  opacity: 0.9;
}

.boost .fill {
  height: 100%;
  background: currentColor;
  box-shadow: 0 0 10px currentColor;
}

.clock {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-shadow: 0 0 10px rgba(159, 216, 255, 0.6);
}

.clock.overtime {
  color: var(--red);
  text-shadow: 0 0 12px var(--red);
  animation: pulse 0.8s ease-in-out infinite;
}

#screens {
  position: fixed;
  inset: var(--hud-h) 0 0 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  text-align: center;
  padding: 0 16px;
}

.big {
  font-size: clamp(64px, 14vw, 180px);
  font-weight: 900;
  text-shadow: 0 0 18px currentColor, 0 0 48px currentColor;
  animation: pop 0.35s ease-out;
}

.logo {
  font-size: clamp(44px, 9vw, 120px);
  font-weight: 900;
  letter-spacing: 0.06em;
  background: linear-gradient(90deg, var(--cyan), var(--pink));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 14px rgba(255, 46, 151, 0.55));
}

.panel {
  padding: 28px 40px;
  border-radius: 16px;
  background: rgba(5, 6, 13, 0.72);
  backdrop-filter: blur(4px);
}

.controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 40px;
  margin-top: 28px;
  font-size: 14px;
  letter-spacing: 0.08em;
}

.controls h3 {
  margin: 0 0 10px;
  font-size: 16px;
  text-shadow: 0 0 8px currentColor;
}

.controls .p1 {
  color: var(--cyan);
}

.controls .p2 {
  color: var(--pink);
}

.controls p {
  margin: 6px 0;
  color: var(--text);
}

kbd {
  display: inline-block;
  min-width: 1.6em;
  padding: 2px 6px;
  border: 1px solid currentColor;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
}

.hint {
  margin-top: 28px;
  letter-spacing: 0.2em;
  animation: blink 1.4s ease-in-out infinite;
}

.small {
  margin-top: 12px;
  color: var(--dim);
  font-size: 12px;
  letter-spacing: 0.12em;
}

.banner-title {
  font-size: clamp(36px, 7vw, 92px);
  font-weight: 900;
  letter-spacing: 0.06em;
  text-shadow: 0 0 16px currentColor, 0 0 40px currentColor;
  animation: pop 0.35s ease-out;
}

.banner-detail {
  margin-top: 12px;
  font-size: clamp(14px, 2vw, 22px);
  color: var(--text);
  letter-spacing: 0.08em;
}

.fatal {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  text-align: center;
  color: var(--text);
}

@media (max-width: 640px) {
  .controls {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .boost {
    width: 60px;
  }
}

@keyframes pop {
  from {
    transform: scale(1.5);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes pulse {
  50% {
    opacity: 0.55;
  }
}

@keyframes blink {
  50% {
    opacity: 0.35;
  }
}
```

```ts file=src/client/hud.ts
import { TICK_RATE, type Config, type MatchState } from '../sim';
import { PLAYER_NAMES, formatClock } from './text';

interface Side {
  pips: HTMLElement;
  fill: HTMLElement;
}

/** Top bar: names, score pips, boost meters and the round clock. */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <div class="side p1"><span class="name">${PLAYER_NAMES[0]}</span><span class="pips"></span><span class="boost"><span class="fill" style="display:block"></span></span></div>
      <div class="clock">0:00</div>
      <div class="side p2"><span class="name">${PLAYER_NAMES[1]}</span><span class="pips"></span><span class="boost"><span class="fill" style="display:block"></span></span></div>`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((side) => ({
      pips: side.querySelector<HTMLElement>('.pips')!,
      fill: side.querySelector<HTMLElement>('.fill')!,
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
      if (side) side.fill.style.width = `${Math.round(s.boostMeter * 100)}%`;
    });

    const clock = state.overtime ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}` : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime);
    }
  }
}
```

```ts file=src/client/screens.ts
import { PLAYER_CSS } from './colors';
import { PLAYER_NAMES } from './text';

/** Centered overlay messages. All strings are our own, never user input. */
export class Screens {
  private token = 0;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.token++;
    this.root.innerHTML = '';
  }

  title(winsToWin: number): void {
    this.show(`
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>
            <p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p></div>
        </div>
        <div class="hint">PRESS SPACE TO START</div>
        <div class="small">FIRST TO ${winsToWin} · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`);
  }

  countdown(n: number | 'GO'): void {
    const token = this.show(`<div class="big" style="color:var(--text)">${n}</div>`);
    if (n === 'GO') this.clearLater(token, 700);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
    const color = winner === null ? 'var(--text)' : PLAYER_CSS[winner];
    this.show(`<div><div class="banner-title" style="color:${color}">${title}</div><div class="banner-detail">${detail}</div></div>`);
  }

  matchOver(winner: number, scores: readonly number[]): void {
    this.show(`
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${PLAYER_NAMES[winner]} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">SPACE REMATCH · ESC MENU</div>
      </div>`);
  }

  paused(): void {
    this.show(`<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`);
  }

  private show(html: string): number {
    this.token++;
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

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/client && git commit -q -F- <<'EOF'
feat(client): neon HUD, title/countdown/banner screens and styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---
### Task 13: Effects and sound

**Files:**
- Create: `src/client/render/fx.ts`, `src/client/audio.ts`, and `src/client/zzfx.d.ts` (only if the zzfx package ships no types)

**Interfaces:**
- Consumes: `World`, `SnakeState`, `ClientSettings`.
- Produces:
  - `class Fx(world, settings)` with `timeScale`, `deathBurst(snake, color)`, `ring(x, y, maxR, life, color)`, `spark(...)`, `addShake(amount)`, `clear()` and `update(frameSeconds)`.
  - `type SoundName = 'beep' | 'go' | 'boost' | 'death' | 'roundWin' | 'draw' | 'matchWin' | 'overtime'`.
  - `class Sound(settings)` with `unlock()` and `play(name, volumeScale?)`.

This task is verified in the browser in Task 15.

- [ ] **Step 1: Check the ZzFX package API**

Run: `ls node_modules/zzfx; sed -n '1,40p' node_modules/zzfx/package.json; grep -n "export" node_modules/zzfx/*.js | head`
Expected: it exports `zzfx` (a function) and `ZZFX` (an object with `volume` and an AudioContext property, `audioContext` or `x`). Use whatever names the package actually exports. If there are no `.d.ts` files, create the declaration below and match it to the real export names.

```ts file=src/client/zzfx.d.ts
declare module 'zzfx' {
  export function zzfx(...parameters: Array<number | undefined>): unknown;
  export const ZZFX: {
    volume: number;
    sampleRate: number;
    audioContext: AudioContext;
  };
}
```

- [ ] **Step 2: Write the effects and sound bank**

```ts file=src/client/render/fx.ts
import { Graphics } from 'pixi.js';
import type { SnakeState } from '../../sim';
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

const MAX_PARTICLES = 1500;

/** Client-only juice: sparks, shockwave rings and screen shake, driven by sim events. */
export class Fx {
  /** Scales particle and ring time (slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
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
    this.shake = 0;
    this.g.clear();
  }

  update(frameSeconds: number): void {
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

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

```ts file=src/client/audio.ts
import { ZZFX, zzfx } from 'zzfx';
import type { ClientSettings } from './settings';

export type SoundName = 'beep' | 'go' | 'boost' | 'death' | 'roundWin' | 'draw' | 'matchWin' | 'overtime';

// ZzFX parameters: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve,
// slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay,
// sustainVolume, decay, tremolo, filter. Omitted values use ZzFX defaults.
const BANK: Record<SoundName, Array<number | undefined>> = {
  beep: [0.5, 0, 520, 0, 0.06, 0.12, 1, 1.5],
  go: [0.7, 0, 780, 0.01, 0.12, 0.3, 1, 1.5, 0, 0, 390, 0.06],
  boost: [0.35, 0.05, 140, 0.03, 0.12, 0.2, 2, 1.2, 8, 0, 0, 0, 0, 0.4],
  death: [1.1, 0.1, 220, 0.01, 0.18, 0.7, 2, 2.4, -6, 0, 0, 0, 0, 1.2, 0, 0.3, 0, 0.6, 0.12],
  roundWin: [0.6, 0, 523, 0.01, 0.09, 0.22, 1, 1, 0, 0, 262, 0.09, 0.09],
  draw: [0.5, 0, 330, 0.02, 0.15, 0.3, 1, 1, -2],
  matchWin: [0.8, 0, 392, 0.02, 0.3, 0.6, 1, 1, 0, 0, 196, 0.12, 0.12],
  overtime: [0.6, 0, 880, 0, 0.25, 0.1, 0, 1, 0, 0, -220, 0.1, 0.2, 0, 8],
};

/** Synthesized sound effects (no audio files). */
export class Sound {
  constructor(private readonly settings: ClientSettings) {}

  /** Browsers keep audio suspended until a user gesture; call on every key press. */
  unlock(): void {
    const ctx = ZZFX.audioContext;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {});
  }

  play(name: SoundName, volumeScale = 1): void {
    if (this.settings.muted || this.settings.masterVolume <= 0) return;
    ZZFX.volume = this.settings.masterVolume * volumeScale;
    try {
      zzfx(...BANK[name]);
    } catch {
      // Audio unavailable (no device or blocked): play silently.
    }
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client && git commit -q -F- <<'EOF'
feat(client): death shatter particles, shockwave rings, screen shake and ZzFX sounds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 14: Live tuning panel

**Files:**
- Create: `src/client/tuning.ts`

**Interfaces:**
- Consumes: `Config`, `DEFAULT_CONFIG`, `ClientSettings`, `DEFAULT_SETTINGS`, lil-gui.
- Produces: `interface TuningPanel { show(); hide(); refresh() }` and `createTuningPanel(cfg, settings, hooks: { onChange(): void }): TuningPanel`. The panel starts hidden. The caller toggles `show()` and `hide()`, and calls `refresh()` after changing values from outside the panel.

- [ ] **Step 1: Write the panel**

```ts file=src/client/tuning.ts
import GUI from 'lil-gui';
import { DEFAULT_CONFIG, type Config } from '../sim';
import { DEFAULT_SETTINGS, type ClientSettings } from './settings';

export interface TuningPanel {
  show(): void;
  hide(): void;
  /** Re-reads values changed outside the panel (e.g. the M mute key). */
  refresh(): void;
}

/** Live sliders for every M1 tunable. The sim reads `cfg` each tick, so changes apply at once. */
export function createTuningPanel(cfg: Config, settings: ClientSettings, hooks: { onChange(): void }): TuningPanel {
  const gui = new GUI({ title: 'SnakeBoom tuning  ( ` to hide )' });

  const move = gui.addFolder('Movement');
  move.add(cfg, 'baseSpeed', 60, 400, 5).name('speed');
  move.add(cfg, 'turnRate', 1, 8, 0.1).name('turn rate (rad/s)');
  move.add(cfg, 'snakeRadius', 3, 14, 0.5).name('thickness (radius)');
  move.add(cfg, 'neckLength', 10, 60, 1).name('neck length');

  const growth = gui.addFolder('Growth');
  growth.add(cfg, 'startLength', 20, 600, 10).name('start length');
  growth.add(cfg, 'growthPerSecond', 0, 200, 5).name('growth per second');
  growth.add(cfg, 'overtimeAt', 10, 300, 5).name('overtime at (s)');
  growth.add(cfg, 'overtimeGrowthMultiplier', 1, 10, 0.5).name('overtime growth ×');
  growth.add(cfg, 'roundMaxSeconds', 30, 600, 10).name('round cap (s)');

  const boost = gui.addFolder('Boost');
  boost.add(cfg, 'boostMultiplier', 1, 3, 0.1).name('speed ×');
  boost.add(cfg, 'boostMeterSeconds', 0.5, 6, 0.1).name('meter (s)');
  boost.add(cfg, 'boostRefillSeconds', 1, 20, 0.5).name('refill (s)');

  const match = gui.addFolder('Match');
  match.add(cfg, 'winsToWin', 1, 10, 1).name('first to');
  match.add(cfg, 'countdownSeconds', 1, 5, 1).name('countdown (s)');
  match.add(cfg, 'roundOverSeconds', 1, 6, 0.5).name('round banner (s)');

  const fx = gui.addFolder('Effects');
  fx.add(settings, 'bloom');
  fx.add(settings, 'bloomStrength', 0, 4, 0.1).name('bloom strength');
  fx.add(settings, 'bloomThreshold', 0, 1, 0.05).name('bloom threshold');
  fx.add(settings, 'shakeScale', 0, 3, 0.1).name('screen shake');

  const audio = gui.addFolder('Audio');
  audio.add(settings, 'masterVolume', 0, 1, 0.05).name('volume');
  audio.add(settings, 'muted');

  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const actions = {
    reset: () => {
      Object.assign(cfg, structuredClone(DEFAULT_CONFIG));
      Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
      refresh();
      hooks.onChange();
    },
    copy: () => {
      void navigator.clipboard?.writeText(JSON.stringify({ config: cfg, settings }, null, 2)).catch(() => {});
    },
  };
  gui.add(actions, 'reset').name('Reset to defaults');
  gui.add(actions, 'copy').name('Copy config JSON');
  gui.onChange(() => hooks.onChange());
  gui.hide();

  return { show: () => gui.show(), hide: () => gui.hide(), refresh };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If lil-gui's typings differ (for example, if `onChange` is not on the root GUI), adapt the code to the installed API.

- [ ] **Step 3: Commit**

```bash
git add src/client && git commit -q -F- <<'EOF'
feat(client): live lil-gui tuning panel with persistence hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
```

---

### Task 15: Wire the client, verify in a browser and hit the M1 checkpoint

**Files:**
- Modify: `src/client/main.ts` (replace the stub), and `src/client/input.ts` (`onKeyDown`, to ignore typing in form fields)
- Modify: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–14.
- Produces: a playable game from `pnpm dev`, the M1 checkpoint PR, and the playtest hand-off.

- [ ] **Step 1: Stop gameplay keys from firing while typing in the tuning panel**

In `src/client/input.ts`, make this the first line of `onKeyDown`:

```ts
    const tag = (e.target as { tagName?: string } | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
```

- [ ] **Step 2: Write the entry point and README**

```ts file=src/client/main.ts
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/900.css';
import './style.css';
import { createMatch, DEFAULT_CONFIG, rematch, step, type MatchState, type SimEvent } from '../sim';
import { Sound } from './audio';
import { PLAYER_COLORS } from './colors';
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
    if (paused) screens.paused();
    else screens.clear();
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

  screens.title(cfg.winsToWin);
  new FixedLoop(
    () => {
      if (state && !paused) handle(step(state, input.sample(), cfg));
    },
    (alpha, frameSeconds) => {
      renderer.draw(state, alpha, cfg);
      fx.update(frameSeconds);
      hud.update(state, cfg);
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

````md file=README.md
# SnakeBoom

A two-player neon snake duel. Your snake keeps growing: trap your opponent so they crash into your body, a wall, or themselves.

## Play

```bash
pnpm install
pnpm dev        # opens the game at http://localhost:5173
```

| Player | Steer | Boost | Use item |
|---|---|---|---|
| **CYAN** | A / D | W | S |
| **PINK** | ← / → | ↑ | ↓ |

<kbd>Space</kbd> start / rematch · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute · <kbd>`</kbd> tuning panel (every gameplay number is a live slider).

## Develop

```bash
pnpm test        # unit tests (rules engine + client helpers)
pnpm typecheck
pnpm build
pnpm soak --rounds 100   # headless bot-vs-bot stats: round lengths, death causes, speed
```

The rules engine (`src/sim`) is deterministic, pure TypeScript that also runs in Node, ready for a future game server. Design: `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`.
````

- [ ] **Step 3: Run the whole suite and the build**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm soak --rounds 60`
Expected: every test passes, typecheck is clean, the build succeeds, and the soak exits 0 and reports ≥ 50× real time.

- [ ] **Step 4: Verify in a real browser**

Start the dev server in the background with `pnpm vite --port 5173 --strictPort`. In the scratchpad, install Playwright with Chromium (`npm i playwright && npx playwright install chromium`) and run a script that does the following:
1. Opens `http://localhost:5173` at 1440×900 with SwiftShader WebGL (`--use-angle=swiftshader --enable-unsafe-swiftshader`), recording console errors and page errors.
2. Screenshots the title screen.
3. Presses Space and screenshots the countdown.
4. After GO, holds `KeyD` and `ArrowUp` for 1.5 s, then screenshots mid-round (neon trails, HUD, boost meter).
5. Holds `KeyA` until P1 circles into its own body, or waits up to 20 s, then screenshots the round banner.
6. Presses Backquote and screenshots the tuning panel.

Look at every screenshot. Expect glowing cyan and pink tubes on the dark grid, a readable HUD, and banner text. Expect zero console errors. Fix anything that looks wrong, then run the script again.

- [ ] **Step 5: Commit, push and open the checkpoint PR**

```bash
git add -A && git commit -q -F- <<'EOF'
feat: playable M1 duel — client wiring, pause/focus handling and README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01SGsAubwFBYA2t9ztX1WE9u
EOF
git push -u origin v1-prototype
```
Open a PR titled "M1: Duel — playable two-player prototype". The body should cover:
- what's playable
- the soak stats (median and p90 round length, speed)
- how to run it
- the playtest questions from spec M1: does steering feel good? Are speed, turning and growth right? Does trapping your opponent work?

End the body with the PR attribution footer. **Do not merge.** Stop and hand the game to the user for the M1 playtest.
