# SnakeBoom M4 (Polish and Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish v1 (spec milestone M4):
- A title screen with a "first to N" selector.
- The full death sequence: hit-stop, flash, slow-motion shatter and a camera punch-in.
- Chain reactions that escalate visually.
- Overtime visuals.
- Near-miss sparks (the stretch goal).
- An audio pass: chains are ducked, and near misses get a sound. `SoundGate` repeat throttling already shipped in v0.5.0.
- A reduced-motion option.
- A performance pass on a late-overtime stress scene.
- A final soak.
- A complete README.

**Architecture:**
- The sim gains `nearMiss` events, detected by `nearMiss.ts` with a per-snake cooldown.
- The client gets small pure, tested helpers:
  - `deathBeatAt` (the death-sequence timeline)
  - `nextWins` (the title selector)
  - a reduced-motion default in `settings.ts`
- `Fx` gains a camera (zoom around a point), a full-screen flash and chain escalation.
- `ArenaView` pulses its border during overtime.

**Tech Stack:** Same as M1–M3.

**Spec:** `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`. Milestone **M4** covers §4.2 (effects), §4.3 (title with "First to N"), §4.4 (audio) and §6 (client effect settings), plus success criterion 3 (performance).

## Global Constraints

- Every earlier constraint still applies. Client effect defaults, from spec §6: `hitStopSeconds` 0.12, `slowMoScale` 0.3, `slowMoSeconds` 0.8. `winsToWin` can be 1–10.
- `prefers-reduced-motion` turns on `reduceMotion` by default: no shake, flashes or camera punch. Players can toggle it in the tuning panel.
- **Git safety:** before every commit, run `git branch --show-current` and confirm it prints `v1-prototype`. Ship with this sequence:
  1. Push.
  2. Poll `gh api …/compare/main...v1-prototype` until `ahead_by` is above 0.
  3. Open the PR and merge it.
  4. Verify that the merge commit contains the branch tip.
  5. Tag `v0.6.0` and push the tag.

  Also bump `package.json` to `0.6.0`. v0.4.0 and v0.5.0 were playtest-feedback releases, so M4 ships as v0.6.0.

## Review Focus

1. **Many near misses in a row while skimming a body.** The sparks must stay readable rather than become a firehose. Tested in Task 1 (the cooldown).
2. **Reduced motion.** When `prefers-reduced-motion` is set and nothing has been saved yet, `reduceMotion` must be on, and a player's saved choice must win afterwards. Tested in Task 2 (`settingsDefaults`).
3. **Several deaths or re-triggers while a death beat is still running.** The beat must restart cleanly and never leave time frozen or the camera zoomed. Tested in Task 2 (`deathBeatAt` at and after the end).
4. **The title selector pushed past its limits.** It must clamp to 1–10. Tested in Task 2 (`nextWins`).
5. **Very long snakes with big chains (late overtime).** The game must hold frame rate. Checked in Task 4 (the browser stress scene).

---

### Task 1: Near-miss events in the sim

**Files:**
- Modify: `src/sim/types.ts` (edit), `src/sim/snake.ts` (edit), `src/sim/step.ts` (edit)
- Create: `src/sim/nearMiss.ts`
- Test: `src/sim/nearMiss.test.ts`

**Interfaces:**
- Produces:
  - `SnakeState.nearMissCooldown` (ticks)
  - Event `nearMiss{player, x, y}`
  - `NEAR_MISS_MARGIN = 6`, `NEAR_MISS_COOLDOWN = 24`, and `detectNearMisses(state, cfg, events)`. Only another snake's solid body counts. Heads that are protected (ghost or grace) or dead don't count.

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/nearMiss.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { detectNearMisses, NEAR_MISS_COOLDOWN, NEAR_MISS_MARGIN } from './nearMiss';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const touch = 2 * cfg.snakeRadius;

/** PINK's body runs along y = 600; CYAN's head sits `gap` above it. */
function skimming(gap: number): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  const pink = s.snakes[1];
  pink.trail = createTrail();
  for (let x = 300; x <= 900; x += 3) trailPush(pink.trail, x, 600);
  Object.assign(pink, { x: 900, y: 600 });
  const cyan = s.snakes[0];
  cyan.trail = createTrail();
  for (let x = 400; x <= 600; x += 3) trailPush(cyan.trail, x, 600 - gap);
  Object.assign(cyan, { x: 598, y: 600 - gap });
  rebuildGrid(s);
  return s;
}

function detect(s: MatchState): SimEvent[] {
  const events: SimEvent[] = [];
  detectNearMisses(s, cfg, events);
  return events;
}

describe('near misses', () => {
  it('reports a head skimming the other snake’s body', () => {
    const s = skimming(touch + NEAR_MISS_MARGIN - 1);
    expect(detect(s)).toEqual([{ type: 'nearMiss', player: 0, x: 598, y: 600 - (touch + NEAR_MISS_MARGIN - 1) }]);
  });

  it('ignores bodies farther than the margin', () => {
    expect(detect(skimming(touch + NEAR_MISS_MARGIN + 1))).toEqual([]);
  });

  // Review Focus 1: skimming along a body must not fire every tick.
  it('waits NEAR_MISS_COOLDOWN ticks before reporting the same snake again', () => {
    const s = skimming(touch + 2);
    expect(detect(s)).toHaveLength(1);
    for (let t = 0; t < NEAR_MISS_COOLDOWN; t++) expect(detect(s)).toEqual([]);
    expect(detect(s)).toHaveLength(1);
  });

  it('ignores your own body, ghosts and dead snakes', () => {
    const own = createMatch(cfg, 1);
    own.phase = 'playing';
    const cyan = own.snakes[0];
    cyan.trail = createTrail();
    for (let x = 200; x <= 400; x += 3) trailPush(cyan.trail, x, 300);
    for (let x = 400; x >= 250; x -= 3) trailPush(cyan.trail, x, 318);
    Object.assign(cyan, { x: 250, y: 318 });
    rebuildGrid(own);
    expect(detect(own)).toEqual([]);

    const ghost = skimming(touch + 2);
    ghost.snakes[0].effects.ghost = 10;
    expect(detect(ghost)).toEqual([]);

    const dead = skimming(touch + 2);
    dead.snakes[0].alive = false;
    expect(detect(dead)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/nearMiss.test.ts`
Expected: FAIL with "Cannot find module './nearMiss'".

- [ ] **Step 3: Implement**

```edit file=src/sim/types.ts
<<<< OLD
  holeVersion: number;
  effects: EffectTimers;
}
==== NEW
  holeVersion: number;
  effects: EffectTimers;
  /** Ticks until another near miss can be reported for this snake. */
  nearMissCooldown: number;
}
>>>>
<<<< OLD
  | { type: 'shieldBlocked'; player: number; x: number; y: number; cause: DeathCause }
==== NEW
  | { type: 'shieldBlocked'; player: number; x: number; y: number; cause: DeathCause }
  | { type: 'nearMiss'; player: number; x: number; y: number }
>>>>
```

```edit file=src/sim/snake.ts
<<<< OLD
    effects: noEffects(),
  };
==== NEW
    effects: noEffects(),
    nearMissCooldown: 0,
  };
>>>>
```

```ts file=src/sim/nearMiss.ts
import { forEachSolidPointNear, isProtected } from './collision';
import type { Config } from './config';
import type { MatchState, SimEvent } from './types';

/** How far beyond touching still counts as a close call. */
export const NEAR_MISS_MARGIN = 6;
/** Ticks between near-miss reports for the same snake. */
export const NEAR_MISS_COOLDOWN = 24;

/**
 * Reports live, unprotected heads skimming another snake's body without touching it, so the
 * client can throw sparks. One report per snake per NEAR_MISS_COOLDOWN ticks.
 */
export function detectNearMisses(state: MatchState, cfg: Config, events: SimEvent[]): void {
  const reach = 2 * cfg.snakeRadius + NEAR_MISS_MARGIN;
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    if (s.nearMissCooldown > 0) {
      s.nearMissCooldown--;
      return;
    }
    if (isProtected(s)) return;
    const found = { skim: false };
    forEachSolidPointNear(state, s.x, s.y, reach, (snake) => {
      if (snake !== i) found.skim = true;
    });
    if (!found.skim) return;
    s.nearMissCooldown = NEAR_MISS_COOLDOWN;
    events.push({ type: 'nearMiss', player: i, x: s.x, y: s.y });
  });
}
```

```edit file=src/sim/step.ts
<<<< OLD
import { collectPickups, updatePickups } from './pickups';
==== NEW
import { detectNearMisses } from './nearMiss';
import { collectPickups, updatePickups } from './pickups';
>>>>
<<<< OLD
  if (alive.length === 0 || timeUp) return endRound(state, cfg, events, null);
  updatePickups(state, cfg, events);
==== NEW
  if (alive.length === 0 || timeUp) return endRound(state, cfg, events, null);
  detectNearMisses(state, cfg, events);
  updatePickups(state, cfg, events);
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS (the determinism and soak tests now include near-miss state); typecheck clean.

- [ ] **Step 5: Commit** (on `v1-prototype`) with message `feat(sim): near-miss events with a per-snake cooldown` (plus the trailers).

---
### Task 2: Client helpers — death-beat timeline, the title selector, reduced-motion defaults

**Files:**
- Create: `src/client/deathBeat.ts`
- Modify: `src/client/text.ts` (edit), `src/client/settings.ts` (edit)
- Test: `src/client/deathBeat.test.ts` (new), `src/client/text.test.ts` (edit), `src/client/settings.test.ts` (edit)

**Interfaces:**
- Produces:
  - `deathBeatAt(elapsed, settings): { fxTimeScale; flash; zoom }` and `PUNCH = 0.06`
  - `nextWins(current, delta): number`, which clamps to 1–10
  - `ClientSettings` gains `hitStopSeconds`, `slowMoScale`, `slowMoSeconds` and `reduceMotion`
  - `settingsDefaults(prefersReducedMotion): ClientSettings`

- [ ] **Step 1: Write the failing tests**

```ts file=src/client/deathBeat.test.ts
import { describe, expect, it } from 'vitest';
import { deathBeatAt, PUNCH } from './deathBeat';

const beat = { hitStopSeconds: 0.12, slowMoScale: 0.3, slowMoSeconds: 0.8 };

describe('deathBeatAt', () => {
  it('starts frozen, flashing and punched in', () => {
    expect(deathBeatAt(0, beat)).toEqual({ fxTimeScale: 0, flash: 0.6, zoom: 1 + PUNCH });
  });

  it('fades the flash across the hit-stop', () => {
    const mid = deathBeatAt(0.06, beat);
    expect(mid.fxTimeScale).toBe(0);
    expect(mid.flash).toBeCloseTo(0.3, 9);
    expect(mid.zoom).toBeLessThan(1 + PUNCH);
  });

  it('runs in slow motion after the hit-stop, easing the camera back', () => {
    const slow = deathBeatAt(0.5, beat);
    expect(slow.fxTimeScale).toBe(0.3);
    expect(slow.flash).toBe(0);
    expect(slow.zoom).toBeGreaterThan(1);
  });

  // Review Focus 3: the beat always ends cleanly.
  it('returns to normal at the end, after it, and for nonsense times', () => {
    for (const t of [0.92, 5, -1, Number.NaN]) expect(deathBeatAt(t, beat)).toEqual({ fxTimeScale: 1, flash: 0, zoom: 1 });
  });

  it('copes with a zero-length hit-stop', () => {
    expect(deathBeatAt(0, { ...beat, hitStopSeconds: 0 })).toMatchObject({ fxTimeScale: 0.3, flash: 0 });
  });
});
```

```edit file=src/client/text.test.ts
<<<< OLD
import { describeDeath, describeItem, describeRound, formatClock } from './text';
==== NEW
import { describeDeath, describeItem, describeRound, formatClock, nextWins } from './text';
>>>>
<<<< OLD
  it('formats the round clock', () => {
==== NEW
  // Review Focus 4: the title selector clamps to 1–10.
  it('steps the first-to-N target and clamps it to 1–10', () => {
    expect(nextWins(5, 1)).toBe(6);
    expect(nextWins(5, -1)).toBe(4);
    expect(nextWins(10, 1)).toBe(10);
    expect(nextWins(1, -1)).toBe(1);
    expect(nextWins(3.4, 1)).toBe(4);
  });

  it('formats the round clock', () => {
>>>>
```

```edit file=src/client/settings.test.ts
<<<< OLD
import { DEFAULT_SETTINGS, loadStored, mergeSaved, resetInPlace, saveStored } from './settings';
==== NEW
import { DEFAULT_SETTINGS, loadStored, mergeSaved, resetInPlace, saveStored, settingsDefaults } from './settings';
>>>>
<<<< OLD
describe('resetInPlace', () => {
==== NEW
describe('settingsDefaults', () => {
  // Review Focus 2: honor prefers-reduced-motion until the player chooses.
  it('turns on reduced motion when the system asks for it', () => {
    expect(settingsDefaults(true).reduceMotion).toBe(true);
    expect(settingsDefaults(false)).toEqual(DEFAULT_SETTINGS);
  });

  it("lets a player's saved choice win over the system default", () => {
    const storage = { getItem: () => JSON.stringify({ reduceMotion: false }) };
    expect(loadStored(storage, 'k', settingsDefaults(true)).reduceMotion).toBe(false);
  });
});

describe('resetInPlace', () => {
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/client`
Expected: FAIL. `./deathBeat`, `nextWins` and `settingsDefaults` don't exist yet.

- [ ] **Step 3: Implement**

```ts file=src/client/deathBeat.ts
export interface DeathBeatSettings {
  hitStopSeconds: number;
  slowMoScale: number;
  slowMoSeconds: number;
}

export interface DeathBeatFrame {
  /** Multiplies effect time: 0 during the hit-stop, slowMoScale after it, then 1. */
  fxTimeScale: number;
  /** Full-screen white flash alpha. */
  flash: number;
  /** Camera zoom around the death point. */
  zoom: number;
}

/** How far the camera punches in at the moment of death. */
export const PUNCH = 0.06;

/**
 * The death beat `elapsed` seconds after a death: a frozen, flashing hit-stop, then slow motion,
 * while the camera punches in and eases back out. Outside the beat everything is normal.
 */
export function deathBeatAt(elapsed: number, s: DeathBeatSettings): DeathBeatFrame {
  const total = s.hitStopSeconds + s.slowMoSeconds;
  if (!(elapsed >= 0) || elapsed >= total) return { fxTimeScale: 1, flash: 0, zoom: 1 };
  const inHitStop = elapsed < s.hitStopSeconds;
  const k = elapsed / total;
  return {
    fxTimeScale: inHitStop ? 0 : s.slowMoScale,
    flash: inHitStop ? 0.6 * (1 - elapsed / s.hitStopSeconds) : 0,
    zoom: 1 + PUNCH * (1 - k) * (1 - k),
  };
}
```

```edit file=src/client/text.ts
<<<< OLD
export function formatClock(ticks: number, tickRate = 60): string {
==== NEW
/** The title screen's first-to-N selector: one step at a time, clamped to 1–10. */
export function nextWins(current: number, delta: number): number {
  return Math.min(10, Math.max(1, Math.round(current) + delta));
}

export function formatClock(ticks: number, tickRate = 60): string {
>>>>
```

```edit file=src/client/settings.ts
<<<< OLD
  masterVolume: number;
  muted: boolean;
}
==== NEW
  masterVolume: number;
  muted: boolean;
  /** Freeze-frame at the moment of death. */
  hitStopSeconds: number;
  /** Effect speed during the slow-motion shatter. */
  slowMoScale: number;
  slowMoSeconds: number;
  /** No shake, flashes or camera punch. */
  reduceMotion: boolean;
}
>>>>
<<<< OLD
  masterVolume: 0.6,
  muted: false,
};
==== NEW
  masterVolume: 0.6,
  muted: false,
  hitStopSeconds: 0.12,
  slowMoScale: 0.3,
  slowMoSeconds: 0.8,
  reduceMotion: false,
};

/** Defaults for this device: reduced motion follows the system preference until the player chooses. */
export function settingsDefaults(prefersReducedMotion: boolean): ClientSettings {
  return { ...DEFAULT_SETTINGS, reduceMotion: prefersReducedMotion };
}
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** (on `v1-prototype`) with message `feat(client): death-beat timeline, first-to-N selector and reduced-motion defaults` (plus the trailers).

---

### Task 3: The juice — death beat, chain escalation, overtime, near-miss sparks, title selector

**Files:**
- Modify:
  - Full: `src/client/render/fx.ts`
  - Edits: `src/client/render/arena.ts`, `src/client/render/renderer.ts`, `src/client/screens.ts`, `src/client/audio.ts`, `src/client/tuning.ts`

**Interfaces:**
- Produces:
  - `Fx` additions: `setCamera(zoom, x, y)`, `setFlash(alpha)`, `nearMissSparks(x, y, color)`, and chain-scaled `explosion`. Everything respects `settings.reduceMotion`.
  - `ArenaView.setAlert(active, t)`.
  - `Screens.title(winsToWin)`, which shows ◀ N ▶, and `Screens.flash(text, colorCss, ms)`.
  - A `nearMiss` sound.

This task is verified in the browser in Task 4.

- [ ] **Step 1: Write the effects, arena alert, screens, sound and tuning**

```ts file=src/client/render/fx.ts
import { Graphics } from 'pixi.js';
import { ARENA_HEIGHT, ARENA_WIDTH, TILE_COLS, TILE_SIZE, type SnakeState } from '../../sim';
import { PALETTE, PICKUP_COLORS } from '../colors';
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

const MAX_PARTICLES = 2500;

/**
 * Client-only juice: sparks, shockwave rings, flashes, screen shake, a camera that can punch in
 * around a point, and a full-screen flash. Reduced motion turns off shake, flashes and the punch.
 */
export class Fx {
  /** Scales particle and ring time (hit-stop and slow motion); shake always decays in real time. */
  timeScale = 1;
  private readonly g = new Graphics();
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private flashes: Flash[] = [];
  private shake = 0;
  private screenFlash = 0;
  private chainFlash = 0;
  private camera = { zoom: 1, x: 0, y: 0 };

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
    const stride = Math.max(1, Math.floor((t.xs.length - t.start) / 260));
    for (let i = t.start; i < t.xs.length; i += stride) {
      if (!t.solid[i]) continue;
      this.spark(t.xs[i], t.ys[i], color, 30 + Math.random() * 110, 0.5 + Math.random() * 0.9, 2 + Math.random() * 2);
    }
    for (let k = 0; k < 70; k++) {
      const c = k % 3 === 0 ? 0xffffff : color;
      this.spark(s.x, s.y, c, 120 + Math.random() * 260, 0.4 + Math.random() * 0.8, 2 + Math.random() * 3);
    }
    this.ring(s.x, s.y, 90, 0.5, color);
    this.ring(s.x, s.y, 40, 0.3, 0xffffff);
    this.addShake(14);
  }

  /** A bomb going off. Chain links grow: bigger flash, more sparks, wider rings, more shake. */
  explosion(x: number, y: number, radius: number, chainDepth: number, tiles: readonly number[]): void {
    const depth = Math.min(chainDepth, 6);
    const grow = 1 + 0.12 * depth;
    this.flashes.push({ x, y, r: radius * grow, life: 0.18, maxLife: 0.18 });
    this.ring(x, y, radius * 1.15 * grow, 0.45, 0xffffff);
    this.ring(x, y, radius * 0.8 * grow, 0.32, depth >= 2 ? 0xff3030 : PALETTE.fuse);
    for (let k = 0; k < 70 + 20 * depth; k++) {
      const c = k % 4 === 0 ? 0xffffff : k % 2 === 0 ? PALETTE.bomb : PALETTE.fuse;
      this.spark(x, y, c, 150 + Math.random() * 380 * grow, 0.3 + Math.random() * 0.6, 2 + Math.random() * 3);
    }
    this.debris(tiles);
    this.addShake(8 + 4 * Math.min(chainDepth, 4));
    if (depth >= 2) this.chainFlash = Math.max(this.chainFlash, 0.08 + 0.04 * depth);
  }

  /** Amber rubble from blocks that were blown up or crushed. */
  debris(tiles: readonly number[]): void {
    for (const index of tiles) {
      const tx = (index % TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      const ty = Math.floor(index / TILE_COLS) * TILE_SIZE + TILE_SIZE / 2;
      for (let k = 0; k < 3; k++) {
        this.spark(tx, ty, PALETTE.obstacle, 60 + Math.random() * 180, 0.5 + Math.random() * 0.7, 3 + Math.random() * 2);
      }
    }
  }

  /** A Shield soaking up a hit: a bright green ring, sparks and a little shake. */
  shieldBurst(x: number, y: number): void {
    this.ring(x, y, 46, 0.4, PICKUP_COLORS.shield);
    this.ring(x, y, 26, 0.25, 0xffffff);
    for (let k = 0; k < 30; k++) this.spark(x, y, PICKUP_COLORS.shield, 120 + Math.random() * 200, 0.3 + Math.random() * 0.4, 2);
    this.addShake(6);
  }

  /** A close call: a quick spray of white and colored sparks off the head. */
  nearMissSparks(x: number, y: number, color: number): void {
    for (let k = 0; k < 14; k++) {
      this.spark(x, y, k % 2 === 0 ? 0xffffff : color, 90 + Math.random() * 160, 0.18 + Math.random() * 0.2, 1.5);
    }
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

  /** Zooms the camera by `zoom` around world point (x, y); 1 means no punch. */
  setCamera(zoom: number, x: number, y: number): void {
    this.camera = { zoom, x, y };
  }

  /** Sets the full-screen flash (the death beat drives this every frame). */
  setFlash(alpha: number): void {
    this.screenFlash = alpha;
  }

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.flashes = [];
    this.shake = 0;
    this.screenFlash = 0;
    this.chainFlash = 0;
    this.camera = { zoom: 1, x: 0, y: 0 };
    this.g.clear();
  }

  update(frameSeconds: number): void {
    const calm = this.settings.reduceMotion;
    const dt = frameSeconds * this.timeScale;
    const drag = Math.pow(0.04, dt);
    const g = this.g;
    g.clear();

    const flashAlpha = calm ? 0 : Math.max(this.screenFlash, this.chainFlash);
    if (flashAlpha > 0.005) g.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).fill({ color: 0xffffff, alpha: flashAlpha });
    this.chainFlash *= Math.pow(0.0005, frameSeconds);

    this.flashes = this.flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of this.flashes) {
      const k = 1 - f.life / f.maxLife;
      g.circle(f.x, f.y, f.r * (0.55 + 0.45 * k)).fill({ color: 0xffffff, alpha: (calm ? 0.35 : 0.75) * (1 - k) });
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
    const shake = calm ? 0 : this.shake;
    const jitter = () => (shake > 0.3 ? (Math.random() * 2 - 1) * shake * b.scale : 0);
    const zoom = calm ? 1 : this.camera.zoom;
    this.world.root.scale.set(b.scale * zoom);
    this.world.root.position.set(
      b.x + this.camera.x * b.scale * (1 - zoom) + jitter(),
      b.y + this.camera.y * b.scale * (1 - zoom) + jitter(),
    );
  }
}
```

```edit file=src/client/render/arena.ts
<<<< OLD
  private readonly blocks = new Graphics();
==== NEW
  private readonly blocks = new Graphics();
  private alerting = false;
>>>>
<<<< OLD
    this.border.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).stroke({ width: 4, color: PALETTE.border, alpha: 0.9 });
  }
==== NEW
    this.drawBorder(PALETTE.border, 0.9);
  }

  /** Overtime: the border pulses red; otherwise it stays its calm blue-white. */
  setAlert(active: boolean, t: number): void {
    if (active) this.drawBorder(0xff3b3b, 0.55 + 0.4 * Math.sin(t * 8));
    else if (this.alerting) this.drawBorder(PALETTE.border, 0.9);
    this.alerting = active;
  }

  private drawBorder(color: number, alpha: number): void {
    this.border.clear();
    this.border.rect(0, 0, ARENA_WIDTH, ARENA_HEIGHT).stroke({ width: 4, color, alpha });
  }
>>>>
```

```edit file=src/client/render/renderer.ts
<<<< OLD
    this.pickups.draw(state.pickups, cfg, timeSeconds);
==== NEW
    this.arena.setAlert(state.overtime && state.phase === 'playing', timeSeconds);
    this.pickups.draw(state.pickups, cfg, timeSeconds);
>>>>
<<<< OLD
      for (const view of this.snakes) view.hide();
      return;
==== NEW
      for (const view of this.snakes) view.hide();
      this.arena.setAlert(false, timeSeconds);
      return;
>>>>
```

```edit file=src/client/screens.ts
<<<< OLD
        <div class="small">FIRST TO ${winsToWin} · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
==== NEW
        <div class="selector">FIRST TO <kbd>◀</kbd> <span class="wins">${winsToWin}</span> <kbd>▶</kbd></div>
        <div class="small"><kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
>>>>
<<<< OLD
  roundOver(title: string, detail: string, winner: number | null): void {
==== NEW
  /** A transient callout (like OVERTIME) that clears itself unless something replaces it first. */
  flash(text: string, colorCss: string, ms: number): void {
    const token = this.show(`<div class="banner-title" style="color:${colorCss}">${text}</div>`, 'countdown');
    this.clearLater(token, ms);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
>>>>
```

```edit file=src/client/style.css
<<<< OLD
.hint {
==== NEW
.selector {
  margin-top: 22px;
  font-size: 18px;
  letter-spacing: 0.14em;
}

.selector .wins {
  display: inline-block;
  min-width: 1.6em;
  font-size: 26px;
  font-weight: 900;
  text-shadow: 0 0 10px currentColor;
}

.hint {
>>>>
```

```edit file=src/client/audio.ts
<<<< OLD
  | 'scrape';
==== NEW
  | 'scrape'
  | 'nearMiss';
>>>>
<<<< OLD
  scrape: [0.25, 0.2, 120, 0, 0.03, 0.06, 4, 1, 0, 0, 0, 0, 0, 2],
==== NEW
  scrape: [0.25, 0.2, 120, 0, 0.03, 0.06, 4, 1, 0, 0, 0, 0, 0, 2],
  nearMiss: [0.3, 0.05, 1100, 0, 0.02, 0.09, 0, 1, -24],
>>>>
<<<< OLD
  private readonly gate = new SoundGate({ scrape: 150, tick: 60, explosion: 45 });
==== NEW
  private readonly gate = new SoundGate({ scrape: 150, tick: 60, explosion: 45, nearMiss: 120 });
>>>>
```

```edit file=src/client/tuning.ts
<<<< OLD
  fx.add(settings, 'shakeScale', 0, 3, 0.1).name('screen shake');
==== NEW
  fx.add(settings, 'shakeScale', 0, 3, 0.1).name('screen shake');
  fx.add(settings, 'reduceMotion').name('reduce motion');
  fx.add(settings, 'hitStopSeconds', 0, 0.5, 0.01).name('death freeze (s)');
  fx.add(settings, 'slowMoScale', 0.05, 1, 0.05).name('death slow-mo ×');
  fx.add(settings, 'slowMoSeconds', 0, 3, 0.1).name('death slow-mo (s)');
>>>>
```

- [ ] **Step 2: Typecheck and test**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 3: Commit** with message `feat(client): death beat, escalating chains, overtime alarm, near-miss sparks and the first-to-N selector` (plus the trailers).

---

### Task 4: Wire it up, stress-test performance, final README, ship v0.6.0

**Files:**
- Modify: `src/client/main.ts` (edit), `package.json` (edit), `README.md` (full)

**Interfaces:**
- Consumes: everything above.
- Produces: the v1-complete build, `v0.6.0`.

- [ ] **Step 1: Wire the death beat, selector, overtime callout, near misses and motion default**

```edit file=src/client/main.ts
<<<< OLD
import { browserStorage, CONFIG_KEY, DEFAULT_SETTINGS, loadStored, saveStored, SETTINGS_KEY } from './settings';
import { describeRound } from './text';
==== NEW
import { deathBeatAt } from './deathBeat';
import { browserStorage, CONFIG_KEY, loadStored, saveStored, SETTINGS_KEY, settingsDefaults } from './settings';
import { describeRound, nextWins } from './text';
>>>>
<<<< OLD
  const settings = loadStored(storage, SETTINGS_KEY, DEFAULT_SETTINGS);
==== NEW
  const prefersCalm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = loadStored(storage, SETTINGS_KEY, settingsDefaults(prefersCalm));
>>>>
<<<< OLD
  const fuseStage = new Map<number, number>();
==== NEW
  const fuseStage = new Map<number, number>();
  let beat: { start: number; x: number; y: number } | null = null;
  const now = () => performance.now() / 1000;
>>>>
<<<< OLD
        case 'overtime':
          sound.play('overtime');
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
          break;
==== NEW
        case 'overtime':
          sound.play('overtime');
          screens.flash(`OVERTIME · GROWTH ×${cfg.overtimeGrowthMultiplier}`, 'var(--red)', 1600);
          break;
        case 'death':
          fx.deathBurst(state.snakes[e.player], PLAYER_COLORS[e.player]);
          sound.play('death');
          beat = { start: now(), x: e.x, y: e.y };
          break;
        case 'nearMiss':
          fx.nearMissSparks(e.x, e.y, PLAYER_COLORS[e.player]);
          sound.play('nearMiss', 0.5);
          break;
>>>>
<<<< OLD
      case 'Space':
        if (!state) {
==== NEW
      case 'ArrowLeft':
      case 'KeyA':
      case 'ArrowRight':
      case 'KeyD':
        if (!state) {
          cfg.winsToWin = nextWins(cfg.winsToWin, code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1);
          tuning.refresh();
          persist();
          screens.title(cfg.winsToWin);
        }
        return;
      case 'Space':
        if (!state) {
>>>>
<<<< OLD
    (alpha, frameSeconds) => {
      renderer.draw(state, alpha, cfg, performance.now() / 1000);
==== NEW
    (alpha, frameSeconds) => {
      const f = beat ? deathBeatAt(now() - beat.start, settings) : null;
      if (beat && f && f.fxTimeScale === 1 && f.zoom === 1) beat = null;
      fx.timeScale = f ? f.fxTimeScale : 1;
      fx.setCamera(f ? f.zoom : 1, beat ? beat.x : 0, beat ? beat.y : 0);
      fx.setFlash(f ? f.flash : 0);
      renderer.draw(state, alpha, cfg, performance.now() / 1000);
>>>>
```

```edit file=package.json
<<<< OLD
  "version": "0.1.0",
==== NEW
  "version": "0.6.0",
>>>>
```

- [ ] **Step 2: Write the final README**

````md file=README.md
# SnakeBoom

A two-player neon snake duel on one keyboard. Your snake never stops growing: trap your opponent so they crash into your body, a block, a wall, or themselves, and throw bombs that blow holes in everything.

## Play

```bash
pnpm install
pnpm dev        # opens the game in your browser (http://localhost:5199)
```

| Player | Steer | Boost | Use item |
|---|---|---|---|
| **CYAN** | A / D | W | S |
| **PINK** | ← / → | ↑ | ↓ |

On the title screen, ← / → picks the match length (first to 1–10). <kbd>Space</kbd> starts or rematches, <kbd>Esc</kbd> pauses, <kbd>M</kbd> mutes, and <kbd>`</kbd> opens the tuning panel, where every gameplay number is a live slider.

## How it plays

- **Dying:** you die if your head hits a wall, a block, your opponent's body or your own. A head-on collision means both die, and the round is a draw. First to the target wins.
- **Growth and overtime:** snakes keep growing, and after 2:30 overtime triples the growth.
- **Pickups** spawn all round. You carry up to **three items** and Use fires the oldest. Both item queues show on the HUD, so you always know what your opponent has.

| Item | What it does |
|---|---|
| **Bomb ×3** | Thrown ahead of your opponent. A reticle marks the blast zone, and it goes off 1 s after landing. Blasts kill heads (yours too), punch holes through bodies, destroy blocks and set off other bombs. |
| **Ghost** | For 3 s your head slips through bodies, heads and blocks. Walls and blasts still kill. |
| **Shield** | A bubble that saves you from your next crash. It never takes a slot. |
| **Turbo** | 4 s of free boost. |
| **Slow** | Your opponent moves at 60% speed for 4 s. |
| **Reverse** | Your opponent's left and right are swapped for 4 s. |
| **Bulldozer** | For 5 s your plow shoves blocks (and crushes the ones it can't move), straight into your opponent if you aim well. |

Five hand-made, symmetrical maps rotate between rounds: Open, Pillars, Cross, Bunkers and Lanes.

## Develop

```bash
pnpm test                 # unit tests (rules engine + client helpers)
pnpm typecheck
pnpm build                # static site in dist/
pnpm soak --rounds 100    # headless bot-vs-bot stats: round lengths, deaths, pickups, speed
```

- `src/sim` is the rules engine. It's deterministic, pure TypeScript with no browser APIs: fixed 60 Hz ticks, seeded random numbers, its own trig functions, and plain-data state. The same code can run on a game server, which is the next milestone: online 1v1 duels with invite links.
- `src/client` is the PixiJS renderer with bloom, plus HTML overlays, ZzFX-generated sounds and a lil-gui tuning panel.

Design: `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md` · Plans: `docs/superpowers/plans/`
````

- [ ] **Step 3: Verify everything**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm soak --rounds 200`
Expected: everything is green, and the soak runs at ≥ 50× real time.

Then run the browser checks in Chrome with Metal:
- **Title selector:** press → twice and expect "FIRST TO 7".
- **Death beat:** start a match, steer CYAN into a wall, and screenshot about 0.05 s after death (the flash with the punch-in).
- **Overtime:** set `overtimeAt` to 1 through the dev handle and screenshot the red border and callout.
- **Stress scene:** give both snakes 6,000-point zig-zag trails, Ghost for 10,000 ticks and a huge `targetLength`. Fire a 10-bomb chain and measure frames per second over 3 s. Expect ≥ 55 fps (the headless cap is 60).
- **Console:** zero errors.

If the stress scene drops below 55 fps, profile it with the Chrome performance API and fix it before shipping.

- [ ] **Step 4: Commit and ship**

Commit with `feat: SnakeBoom v1 polish — death beat, overtime alarm, near misses, title selector, README` (plus the trailers). Ship with the safe sequence from the Global Constraints and tag `v0.6.0`.
