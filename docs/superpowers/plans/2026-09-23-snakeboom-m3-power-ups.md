# SnakeBoom M3 (Power-ups) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the five power-ups from spec §3.5. **Ghost** makes your head pass through bodies, heads and blocks. **Shield** is passive and turns your next death into a deflection followed by a grace period. **Turbo** gives free boost. **Slow** slows your opponent, and **Reverse** swaps their controls. The pickup mix is weighted, and every effect has status visuals, sounds and tuning sliders.

**Architecture:**
- `SnakeState` gains `effects` (tick timers for ghost, turbo, slow, reverse and grace).
- `items.ts` starts effects and counts them down.
- `snake.ts` applies Slow, Turbo and Reverse to movement.
- `collision.ts` ignores everything except walls for ghosts and snakes in grace, and treats a ghost's head as intangible to others.
- A new `shield.ts` handles deflection.
- `step.ts` judges every head first, then lets a held Shield save each doomed snake before applying deaths.

**Tech Stack:** Same as M1/M2.

**Spec:** `docs/superpowers/specs/2026-09-23-snakeboom-v1-design.md`. Milestone **M3** covers §3.5 (items and Shield deflection), §3.3 (Ghost and Shield in the death rules), §4.1 (status visuals) and §4.4 (sounds).

## Global Constraints

- Every M1 and M2 constraint still applies: sim purity, plain-data state, the 60 Hz tick, exact pins, and ZzFX-only audio. A new purity rule bans the `**` operator in `src/sim`, because exponentiation may round differently across engines.
- New defaults, copied from spec §6:
  - `ghostDuration` 3 s, `ghostWarning` 0.75 s, `shieldGrace` 0.5 s
  - `turboDuration` 4 s, `slowDuration` 4 s, `slowFactor` 0.6, `reverseDuration` 4 s
  - Weights: bomb 35, and 13 each for ghost, shield, turbo, slow and reverse
- Colors: Ghost `#e8f4ff`, Shield `#3dff7a`, Turbo `#ffe14d`, Slow `#4d7cff`, Reverse `#b44dff`.
- Rules (spec §3.5):
  - A Ghost's **head** passes through bodies, other heads and blocks, but walls and blasts still kill it. Its body stays solid to others, and if the head is inside something when Ghost ends, it dies.
  - A Shield works while held: it absorbs the next death of any kind. Walls turn the head to slide along the wall, and blasts are absorbed without deflecting. Everything else pushes the head clear and turns it along the surface.
  - After a Shield saves you, grace makes you immune to everything except walls, blasts included.
  - Slow and Reverse hit every live opponent. Using an effect again restarts its timer.
- Work happens on branch `v1-prototype`, with one commit per task and the two trailers on each. At the end: open a PR, merge it, and tag `v0.3.0`.
- Code blocks follow the M2 convention (`file=` for a whole file, `edit file=` for exact-match hunks).

## Review Focus

1. **Shield deflections at the arena edge or in a corner.** An alive head must never end up outside the arena. Tested in Task 3 (the corner case) and Task 4 (the "shields only" soak).
2. **A Ghost wearing off inside a body or block.** The snake dies unless it holds a Shield. Tested in Task 4.
3. **Slow plus turning at full rate.** At a 30-unit turning radius, a slowed snake must still never clip its own neck. Tested in Task 1.
4. **Every power-up at once** (Slow, Reverse, Turbo and boost stacking). This must produce no NaN and break no invariants. Tested in Task 4 (the "every power-up at once" soak).
5. **"Reset to defaults" in the tuning panel.** Resetting must keep the Pickup-mix sliders bound to the live weights object. Tested in Task 5 (`resetInPlace`).

---

### Task 1: Effects model — Ghost, Turbo, Slow and Reverse timers; Slow, Turbo and Reverse movement

**Files:**
- Modify: `src/sim/config.ts` (edit), `src/sim/types.ts` (edit), `src/sim/snake.ts` (full), `src/sim/items.ts` (full), `src/client/colors.ts` (edit), `src/client/text.ts` (edit)
- Test: `src/sim/effects.test.ts` (new), `src/sim/items.test.ts` (edit), `src/sim/pickups.test.ts` (edit), `src/client/text.test.ts` (edit)

**Interfaces:**
- Produces:
  - `PickupKind = 'bomb' | 'ghost' | 'shield' | 'turbo' | 'slow' | 'reverse'`
  - `EffectTimers { ghost; turbo; slow; reverse; grace }` and `EffectName = 'ghost' | 'turbo' | 'slow' | 'reverse'`
  - `SnakeState.effects`
  - New events: `itemUsed{player, kind}`, `effectStarted{player, effect}`, `effectEnded{player, effect}` and `shieldBlocked{player, x, y, cause}`
  - Snake functions: `noEffects()` and `snakeSpeed(s, cfg)`
  - `tickItemTimers(state, events)`, which now takes the events list

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/effects.test.ts
import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE, type Config, type PickupKind } from './config';
import { detectHit } from './collision';
import { createGrid } from './grid';
import { createItem, tickItemTimers, useItem } from './items';
import { advanceSnake, createSnake, snakeSpeed } from './snake';
import { createMatch } from './state';
import type { MatchState, SimEvent } from './types';

const cfg: Config = structuredClone(DEFAULT_CONFIG);

function holding(kind: PickupKind): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  s.snakes[0].item = createItem(kind, cfg);
  return s;
}

function use(s: MatchState, idx = 0): SimEvent[] {
  const events: SimEvent[] = [];
  useItem(s, idx, cfg, events);
  return events;
}

describe('power-ups', () => {
  it('Ghost and Turbo affect the user; Slow and Reverse hit the opponent', () => {
    for (const [kind, target] of [
      ['ghost', 0],
      ['turbo', 0],
      ['slow', 1],
      ['reverse', 1],
    ] as const) {
      const s = holding(kind);
      expect(use(s)).toEqual([
        { type: 'itemUsed', player: 0, kind },
        { type: 'effectStarted', player: target, effect: kind },
      ]);
      expect(s.snakes[target].effects[kind]).toBe(Math.round(cfg[`${kind}Duration`] * TICK_RATE));
      expect(s.snakes[0].item).toBeNull();
    }
  });

  it('a Shield is passive: Use does nothing', () => {
    const s = holding('shield');
    expect(use(s)).toEqual([]);
    expect(s.snakes[0].item).toEqual({ kind: 'shield', charges: 1 });
  });

  it('Slow and Reverse skip dead opponents', () => {
    const s = holding('slow');
    s.snakes[1].alive = false;
    expect(use(s)).toEqual([{ type: 'itemUsed', player: 0, kind: 'slow' }]);
  });

  it('effects wear off and report it; grace wears off silently', () => {
    const s = holding('ghost');
    use(s);
    s.snakes[1].effects.grace = 3;
    const events: SimEvent[] = [];
    for (let t = 0; t < Math.round(cfg.ghostDuration * TICK_RATE); t++) tickItemTimers(s, events);
    expect(s.snakes[0].effects.ghost).toBe(0);
    expect(s.snakes[1].effects.grace).toBe(0);
    expect(events).toEqual([{ type: 'effectEnded', player: 0, effect: 'ghost' }]);
  });

  it('Slow cuts speed to slowFactor', () => {
    const sn = createSnake(0, 800, 500, 0, cfg);
    expect(snakeSpeed(sn, cfg)).toBe(cfg.baseSpeed);
    sn.effects.slow = 10;
    expect(snakeSpeed(sn, cfg)).toBeCloseTo(cfg.baseSpeed * cfg.slowFactor, 9);
  });

  it('Turbo lets you boost without draining the meter, even from empty', () => {
    const sn = createSnake(0, 400, 500, 0, cfg);
    sn.boostMeter = 0;
    sn.effects.turbo = 100;
    advanceSnake(sn, 0, { turn: 0, boost: true, use: false }, cfg, 0, createGrid(ARENA_WIDTH, ARENA_HEIGHT));
    expect(sn.boosting).toBe(true);
    expect(sn.boostMeter).toBe(0);
    expect(sn.x).toBeCloseTo(400 + (cfg.baseSpeed * cfg.boostMultiplier) / TICK_RATE, 9);
  });

  it('Reverse swaps left and right', () => {
    const grid = createGrid(ARENA_WIDTH, ARENA_HEIGHT);
    const normal = createSnake(0, 800, 500, 0, cfg);
    const reversed = createSnake(1, 800, 500, 0, cfg);
    reversed.effects.reverse = 100;
    advanceSnake(normal, 0, { turn: 1, boost: false, use: false }, cfg, 0, grid);
    advanceSnake(reversed, 1, { turn: 1, boost: false, use: false }, cfg, 0, grid);
    expect(normal.heading).toBeGreaterThan(0);
    expect(reversed.heading).toBeCloseTo(-normal.heading, 12);
  });

  // Review Focus 3: the neck stays safe at Slow's tighter turning circle.
  it('never clips its own neck while slowed and turning at the maximum rate', () => {
    const s = holding('bomb');
    const me = s.snakes[0];
    me.effects.slow = 10_000;
    for (let t = 0; t < 3 * TICK_RATE; t++) {
      advanceSnake(me, 0, { turn: 1, boost: false, use: false }, cfg, 0, s.grid);
      expect(detectHit(s, 0, cfg)).toBeNull();
    }
  });
});
```

```edit file=src/sim/items.test.ts
<<<< OLD
    for (let t = 0; t < Math.round(cfg.bombDropCooldown * TICK_RATE); t++) tickItemTimers(s);
==== NEW
    for (let t = 0; t < Math.round(cfg.bombDropCooldown * TICK_RATE); t++) tickItemTimers(s, []);
>>>>
```

```edit file=src/sim/pickups.test.ts
<<<< OLD
  it('picks kinds by weight and returns null when no weight is positive', () => {
    const rng = createRng(1);
    expect(pickKind({ bomb: 5 }, rng)).toBe('bomb');
    expect(pickKind({ bomb: 0 }, rng)).toBeNull();
  });
==== NEW
  it('picks kinds by weight and returns null when no weight is positive', () => {
    const rng = createRng(1);
    const none = { bomb: 0, ghost: 0, shield: 0, turbo: 0, slow: 0, reverse: 0 };
    expect(pickKind({ ...none, shield: 5 }, rng)).toBe('shield');
    expect(pickKind(none, rng)).toBeNull();
  });

  it('follows the default mix: bombs about 35%, each power-up about 13%', () => {
    const rng = createRng(4);
    const counts: Record<string, number> = {};
    const draws = 20_000;
    for (let i = 0; i < draws; i++) {
      const kind = pickKind(DEFAULT_CONFIG.pickupWeights, rng)!;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    expect(counts.bomb / draws).toBeCloseTo(0.35, 1);
    for (const kind of ['ghost', 'shield', 'turbo', 'slow', 'reverse']) expect(counts[kind] / draws).toBeCloseTo(0.13, 1);
  });
>>>>
```

```edit file=src/client/text.test.ts
<<<< OLD
    expect(describeItem({ kind: 'bomb', charges: 3 })).toBe('BOMB ×3');
==== NEW
    expect(describeItem({ kind: 'bomb', charges: 3 })).toBe('BOMB ×3');
    expect(describeItem({ kind: 'ghost', charges: 1 })).toBe('GHOST');
    expect(describeItem({ kind: 'shield', charges: 1 })).toBe('SHIELD');
    expect(describeItem({ kind: 'turbo', charges: 1 })).toBe('TURBO');
    expect(describeItem({ kind: 'slow', charges: 1 })).toBe('SLOW');
    expect(describeItem({ kind: 'reverse', charges: 1 })).toBe('REVERSE');
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/effects.test.ts src/sim/pickups.test.ts src/client/text.test.ts`
Expected: FAIL. Power-up kinds don't exist yet, `snakeSpeed` isn't exported, and `describeItem` returns undefined for them.

- [ ] **Step 3: Implement**

```edit file=src/sim/config.ts
<<<< OLD
/** What a pickup can contain. M3 adds the power-ups. */
export type PickupKind = 'bomb';
==== NEW
/** What a pickup can contain. */
export type PickupKind = 'bomb' | 'ghost' | 'shield' | 'turbo' | 'slow' | 'reverse';
>>>>
<<<< OLD
  /** Fuse given to a bomb caught in another bomb's blast. */
  chainDelay: number;
==== NEW
  /** Fuse given to a bomb caught in another bomb's blast. */
  chainDelay: number;
  ghostDuration: number;
  /** The final part of a Ghost during which the head flickers as a warning. */
  ghostWarning: number;
  /** Invulnerability (except walls) after a Shield absorbs a hit. */
  shieldGrace: number;
  turboDuration: number;
  slowDuration: number;
  /** Speed multiplier while slowed. */
  slowFactor: number;
  reverseDuration: number;
>>>>
<<<< OLD
  pickupWeights: { bomb: 35 },
==== NEW
  pickupWeights: { bomb: 35, ghost: 13, shield: 13, turbo: 13, slow: 13, reverse: 13 },
>>>>
<<<< OLD
  chainDelay: 0.12,
==== NEW
  chainDelay: 0.12,
  ghostDuration: 3,
  ghostWarning: 0.75,
  shieldGrace: 0.5,
  turboDuration: 4,
  slowDuration: 4,
  slowFactor: 0.6,
  reverseDuration: 4,
>>>>
```

```edit file=src/sim/types.ts
<<<< OLD
export interface PickupState {
==== NEW
/** Timed effects on a snake, in ticks remaining (0 = off). */
export interface EffectTimers {
  ghost: number;
  turbo: number;
  slow: number;
  reverse: number;
  /** Shield grace: immune to everything except walls. */
  grace: number;
}

/** Effects announced by effectStarted/effectEnded events (grace is internal). */
export type EffectName = 'ghost' | 'turbo' | 'slow' | 'reverse';

export interface PickupState {
>>>>
<<<< OLD
  /** Bumped whenever a blast punches holes in this trail, so the renderer redraws it. */
  holeVersion: number;
}
==== NEW
  /** Bumped whenever a blast punches holes in this trail, so the renderer redraws it. */
  holeVersion: number;
  effects: EffectTimers;
}
>>>>
<<<< OLD
  | { type: 'bombDropped'; id: number; player: number; x: number; y: number }
==== NEW
  | { type: 'bombDropped'; id: number; player: number; x: number; y: number }
  | { type: 'itemUsed'; player: number; kind: PickupKind }
  | { type: 'effectStarted'; player: number; effect: EffectName }
  | { type: 'effectEnded'; player: number; effect: EffectName }
  | { type: 'shieldBlocked'; player: number; x: number; y: number; cause: DeathCause }
>>>>
```

```ts file=src/sim/snake.ts
import { DT, type Config } from './config';
import { detCos, detSin, wrapAngle } from './detmath';
import { gridInsert } from './grid';
import { createTrail, trailPush, trailTrim } from './trail';
import type { EffectTimers, Grid, PlayerInput, SnakeState } from './types';

export function noEffects(): EffectTimers {
  return { ghost: 0, turbo: 0, slow: 0, reverse: 0, grace: 0 };
}

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
    item: null,
    useCooldown: 0,
    holeVersion: 0,
    effects: noEffects(),
  };
}

/** Growth in units per second. */
export function growthRate(cfg: Config, overtime: boolean): number {
  return cfg.growthPerSecond * (overtime ? cfg.overtimeGrowthMultiplier : 1);
}

/** Current speed in units per second: boosting and Slow both multiply. */
export function snakeSpeed(s: SnakeState, cfg: Config): number {
  return cfg.baseSpeed * (s.boosting ? cfg.boostMultiplier : 1) * (s.effects.slow > 0 ? cfg.slowFactor : 1);
}

/**
 * Advances a live snake by one tick: boost meter (Turbo makes boosting free), steering
 * (Reverse swaps left and right), movement, a new trail point (indexed in the grid), growth
 * and tail trimming. Returns true on the tick boosting starts.
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
  const turbo = s.effects.turbo > 0;
  if (input.boost && (s.boostMeter > 0 || turbo)) {
    s.boosting = true;
    if (!turbo) s.boostMeter = Math.max(0, s.boostMeter - DT / cfg.boostMeterSeconds);
  } else {
    s.boosting = false;
    if (!input.boost) s.boostMeter = Math.min(1, s.boostMeter + DT / cfg.boostRefillSeconds);
  }

  s.prevX = s.x;
  s.prevY = s.y;
  const turn = s.effects.reverse > 0 ? -input.turn : input.turn;
  s.heading = wrapAngle(s.heading + turn * cfg.turnRate * DT);
  const dist = snakeSpeed(s, cfg) * DT;
  s.x += detCos(s.heading) * dist;
  s.y += detSin(s.heading) * dist;

  const seq = trailPush(s.trail, s.x, s.y);
  gridInsert(grid, s.x, s.y, idx, seq);
  s.targetLength += growth * DT;
  trailTrim(s.trail, s.targetLength);
  return s.boosting && !wasBoosting;
}
```

```ts file=src/sim/items.ts
import { TICK_RATE, type Config, type PickupKind } from './config';
import type { EffectName, ItemState, MatchState, SimEvent } from './types';

const ANNOUNCED: EffectName[] = ['ghost', 'turbo', 'slow', 'reverse'];

export function createItem(kind: PickupKind, cfg: Config): ItemState {
  return { kind, charges: kind === 'bomb' ? Math.max(1, Math.round(cfg.bombCharges)) : 1 };
}

/** Counts down Use cooldowns and effect timers, reporting effects that run out. Call once per playing tick. */
export function tickItemTimers(state: MatchState, events: SimEvent[]): void {
  state.snakes.forEach((s, player) => {
    if (s.useCooldown > 0) s.useCooldown--;
    if (s.effects.grace > 0) s.effects.grace--;
    for (const effect of ANNOUNCED) {
      if (s.effects[effect] <= 0) continue;
      s.effects[effect]--;
      if (s.effects[effect] === 0) events.push({ type: 'effectEnded', player, effect });
    }
  });
}

function startEffect(state: MatchState, player: number, effect: EffectName, seconds: number, events: SimEvent[]): void {
  state.snakes[player].effects[effect] = Math.max(1, Math.round(seconds * TICK_RATE));
  events.push({ type: 'effectStarted', player, effect });
}

/** Uses the held item. A Shield is passive (Use does nothing); everything else is spent. */
export function useItem(state: MatchState, idx: number, cfg: Config, events: SimEvent[]): void {
  const s = state.snakes[idx];
  const item = s.item;
  if (!item || s.useCooldown > 0 || item.kind === 'shield') return;
  const opponents = state.snakes.flatMap((o, j) => (j !== idx && o.alive ? [j] : []));
  if (item.kind !== 'bomb') events.push({ type: 'itemUsed', player: idx, kind: item.kind });
  switch (item.kind) {
    case 'bomb': {
      const fuse = Math.max(1, Math.round(cfg.bombFuse * TICK_RATE));
      const id = state.nextId++;
      state.bombs.push({ id, owner: idx, x: s.x, y: s.y, fuse, maxFuse: fuse, chainDepth: 0 });
      events.push({ type: 'bombDropped', id, player: idx, x: s.x, y: s.y });
      s.useCooldown = Math.round(cfg.bombDropCooldown * TICK_RATE);
      break;
    }
    case 'ghost':
      startEffect(state, idx, 'ghost', cfg.ghostDuration, events);
      break;
    case 'turbo':
      startEffect(state, idx, 'turbo', cfg.turboDuration, events);
      break;
    case 'slow':
      for (const j of opponents) startEffect(state, j, 'slow', cfg.slowDuration, events);
      break;
    case 'reverse':
      for (const j of opponents) startEffect(state, j, 'reverse', cfg.reverseDuration, events);
      break;
  }
  item.charges--;
  if (item.charges <= 0) s.item = null;
}
```

```edit file=src/client/colors.ts
<<<< OLD
export const PICKUP_COLORS: Record<PickupKind, number> = {
  bomb: 0xff4d2e,
};
==== NEW
export const PICKUP_COLORS: Record<PickupKind, number> = {
  bomb: 0xff4d2e,
  ghost: 0xe8f4ff,
  shield: 0x3dff7a,
  turbo: 0xffe14d,
  slow: 0x4d7cff,
  reverse: 0xb44dff,
};
>>>>
```

```edit file=src/client/text.ts
<<<< OLD
    case 'bomb':
      return `BOMB ×${item.charges}`;
  }
==== NEW
    case 'bomb':
      return `BOMB ×${item.charges}`;
    case 'ghost':
      return 'GHOST';
    case 'shield':
      return 'SHIELD';
    case 'turbo':
      return 'TURBO';
    case 'slow':
      return 'SLOW';
    case 'reverse':
      return 'REVERSE';
  }
>>>>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS. `step.ts` still calls `tickItemTimers(state)` with one argument, which is a typecheck error until Task 4. To keep this commit green, also apply this one-line edit now:

```edit file=src/sim/step.ts
<<<< OLD
  tickItemTimers(state);
==== NEW
  tickItemTimers(state, events);
>>>>
```

- [ ] **Step 5: Commit** with message `feat(sim): power-up effects — Ghost, Turbo, Slow and Reverse timers, with Slow/Turbo/Reverse movement` (plus the trailers).

---
### Task 2: Ghost and grace in collisions

**Files:**
- Modify: `src/sim/collision.ts` (full)
- Test: `src/sim/ghost.test.ts` (new)

**Interfaces:**
- Produces:
  - `isProtected(s)`, which is true while a snake has Ghost or grace.
  - `detectHit` changes: a protected head only checks walls. Other ghosts' heads never count as a head-on. Trail points within `2r` of path behind a ghost's head are ignored, because a ghost's head is intangible but its body is not.

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/ghost.test.ts
import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { detectHit } from './collision';
import { DEFAULT_CONFIG } from './config';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState } from './types';

const cfg = DEFAULT_CONFIG;

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

function setPath(state: MatchState, idx: number, pts: Array<[number, number]>): void {
  const sn = state.snakes[idx];
  sn.trail = createTrail();
  for (const [x, y] of pts) trailPush(sn.trail, x, y);
  const [hx, hy] = pts[pts.length - 1];
  Object.assign(sn, { x: hx, y: hy, prevX: hx, prevY: hy, targetLength: 1e9 });
  rebuildGrid(state);
}

function line(x0: number, y0: number, x1: number, y1: number, step = 3): Array<[number, number]> {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, k): [number, number] => [x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
}

describe('ghost and grace', () => {
  it('a ghost head passes through bodies, its own tail and blocks', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 598));
    s.snakes[0].effects.ghost = 10;
    expect(detectHit(s, 0, cfg)).toBeNull();
    setTile(s.tiles, 25, 29, true); // x 500..520, y 580..600: right under the head
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, [...line(200, 300, 400, 300), ...line(400, 312, 250, 312)]);
    expect(detectHit(s, 0, cfg)).toBeNull();
  });

  it('walls still kill a ghost', () => {
    const s = playing();
    setPath(s, 0, line(40, 500, 6, 500));
    s.snakes[0].effects.ghost = 10;
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });

  it("a ghost's head is intangible to others, but its body is solid", () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    s.snakes[1].effects.ghost = 10;
    setPath(s, 0, line(700, 450, 700, 592));
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, line(500, 450, 500, 592));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'body', killer: 1 });
  });

  it('grace ignores heads, bodies and blocks, but not walls', () => {
    const s = playing();
    setPath(s, 1, line(300, 600, 700, 600));
    setPath(s, 0, line(500, 400, 500, 590));
    s.snakes[0].effects.grace = 10;
    expect(detectHit(s, 0, cfg)).toBeNull();
    setPath(s, 0, line(40, 300, 6, 300));
    expect(detectHit(s, 0, cfg)).toEqual({ cause: 'wall', killer: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/ghost.test.ts`
Expected: FAIL. Ghosted heads are still reported as `body`, `obstacle` or `self` hits.

- [ ] **Step 3: Implement**

```ts file=src/sim/collision.ts
import { circleHitsTiles, circleHitsWall } from './arena';
import type { Config } from './config';
import { gridQuery } from './grid';
import { headCum } from './trail';
import type { DeathCause, MatchState, SnakeState } from './types';

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

/** Ghosts and snakes in Shield grace ignore everything except walls. */
export function isProtected(s: SnakeState): boolean {
  return s.effects.ghost > 0 || s.effects.grace > 0;
}

/**
 * Checks one live head against heads, bodies, blocks and walls (blasts are resolved elsewhere).
 * Priority: headOn > body > self > obstacle > wall. Ties pick the lowest snake index, so the
 * result never depends on grid visit order. A ghost's head (its newest 2r of path) is
 * intangible to others; the rest of its body is solid.
 */
export function detectHit(state: MatchState, idx: number, cfg: Config): Hit | null {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const touch = 2 * r;

  if (!isProtected(me)) {
    let headOn = -1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive || other.effects.ghost > 0) continue;
      const dx = other.x - me.x;
      const dy = other.y - me.y;
      if (dx * dx + dy * dy < touch * touch && (headOn < 0 || j < headOn)) headOn = j;
    }
    if (headOn >= 0) return { cause: 'headOn', killer: headOn };

    const neckStart = headCum(me.trail) - cfg.neckLength;
    const ghostHeadFrom = state.snakes.map((o) => (o.effects.ghost > 0 ? headCum(o.trail) - touch : Infinity));
    const found = { body: -1, self: false };
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
      if (snake === idx) {
        if (me.trail.cum[i] < neckStart) found.self = true;
        return;
      }
      if (state.snakes[snake].trail.cum[i] >= ghostHeadFrom[snake]) return;
      if (found.body < 0 || snake < found.body) found.body = snake;
    });
    if (found.body >= 0) return { cause: 'body', killer: found.body };
    if (found.self) return { cause: 'self', killer: idx };
    if (circleHitsTiles(state.tiles, me.x, me.y, r)) return { cause: 'obstacle', killer: null };
  }

  if (circleHitsWall(me.x, me.y, r)) return { cause: 'wall', killer: null };
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS (the M1/M2 collision tests are unchanged); typecheck clean.

- [ ] **Step 5: Commit** with message `feat(sim): Ghost heads pass through bodies, heads and blocks; Shield grace ignores all but walls` (plus the trailers).

---

### Task 3: Shield deflection

**Files:**
- Modify: `src/sim/arena.ts` (edit)
- Create: `src/sim/shield.ts`
- Test: `src/sim/shield.test.ts`

**Interfaces:**
- Produces:
  - `nearestSolidTilePoint(tiles, x, y, r): {x, y} | null`
  - `contactPoint(state, idx, cause, cfg): {x, y} | null`
  - `tryShield(state, idx, cause, cfg, events): boolean`. It returns false and changes nothing without a held Shield. Otherwise it spends the Shield, deflects the head (or does nothing more for a blast), sets grace, and emits `shieldBlocked`.

- [ ] **Step 1: Write the failing test**

```ts file=src/sim/shield.test.ts
import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE } from './config';
import { HALF_PI, PI } from './detmath';
import { createItem } from './items';
import { tryShield } from './shield';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const r = cfg.snakeRadius;

function shielded(x: number, y: number, heading: number): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  const me = s.snakes[0];
  me.trail = createTrail();
  trailPush(me.trail, x, y);
  Object.assign(me, { x, y, prevX: x, prevY: y, heading, item: createItem('shield', cfg) });
  rebuildGrid(s);
  return s;
}

function verticalBody(s: MatchState, x: number): void {
  const pink = s.snakes[1];
  pink.trail = createTrail();
  for (let y = 300; y <= 700; y += 3) trailPush(pink.trail, x, y);
  Object.assign(pink, { x, y: 699 });
  rebuildGrid(s);
}

describe('shield', () => {
  it('does nothing without a shield', () => {
    const s = shielded(3, 500, PI);
    s.snakes[0].item = null;
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'wall', cfg, events)).toBe(false);
    expect(events).toEqual([]);
    expect(s.snakes[0].x).toBe(3);
  });

  it('turns a wall crash into a slide along the wall, then grace', () => {
    const s = shielded(3, 500, PI - 0.3);
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'wall', cfg, events)).toBe(true);
    const me = s.snakes[0];
    expect(me.x).toBe(r + 0.5);
    expect(me.heading).toBe(HALF_PI);
    expect(me.item).toBeNull();
    expect(me.effects.grace).toBe(Math.round(cfg.shieldGrace * TICK_RATE));
    expect(events).toEqual([{ type: 'shieldBlocked', player: 0, x: r + 0.5, y: 500, cause: 'wall' }]);
  });

  // Review Focus 1: corners and edges never leave the head outside the arena.
  it('backs straight out of a corner', () => {
    const s = shielded(2, 3, (-3 * PI) / 4);
    tryShield(s, 0, 'wall', cfg, []);
    const me = s.snakes[0];
    expect([me.x, me.y]).toEqual([r + 0.5, r + 0.5]);
    expect(me.heading).toBeCloseTo(PI / 4, 12);
  });

  it('pushes clear of a body and slides along it', () => {
    const s = shielded(795, 501, 0.2);
    verticalBody(s, 800);
    tryShield(s, 0, 'body', cfg, []);
    const me = s.snakes[0];
    expect(me.x).toBeCloseTo(800 - 2 * r - 0.5, 9);
    expect(me.y).toBeCloseTo(501, 9);
    expect(me.heading).toBeCloseTo(HALF_PI, 9);
  });

  it('pushes clear of a block and slides along it', () => {
    const s = shielded(797, 510, 0.2);
    setTile(s.tiles, 40, 25, true); // x 800..820, y 500..520
    tryShield(s, 0, 'obstacle', cfg, []);
    const me = s.snakes[0];
    expect(me.x).toBeCloseTo(800 - r - 0.5, 9);
    expect(me.y).toBeCloseTo(510, 9);
    expect(me.heading).toBeCloseTo(HALF_PI, 9);
  });

  it('absorbs a blast without moving', () => {
    const s = shielded(600, 600, 1);
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'blast', cfg, events)).toBe(true);
    const me = s.snakes[0];
    expect([me.x, me.y, me.heading]).toEqual([600, 600, 1]);
    expect(events[0]).toMatchObject({ type: 'shieldBlocked', cause: 'blast' });
  });

  it('never pushes the head out of the arena', () => {
    const s = shielded(ARENA_WIDTH - 9, 501, 0);
    verticalBody(s, ARENA_WIDTH - 20);
    tryShield(s, 0, 'body', cfg, []);
    expect(s.snakes[0].x).toBeLessThanOrEqual(ARENA_WIDTH - r - 0.5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/sim/shield.test.ts`
Expected: FAIL with "Cannot find module './shield'".

- [ ] **Step 3: Implement**

```edit file=src/sim/arena.ts
<<<< OLD
/** Clears every solid tile a circle touches; returns the cleared indices in ascending order. */
==== NEW
/** The closest point on any solid tile a circle touches, or null when it touches none. */
export function nearestSolidTilePoint(
  tiles: readonly number[],
  x: number,
  y: number,
  r: number,
): { x: number; y: number } | null {
  const found = { x: 0, y: 0, d: Infinity };
  forEachSolidTileTouching(tiles, x, y, r, (index) => {
    const left = (index % TILE_COLS) * TILE_SIZE;
    const top = Math.floor(index / TILE_COLS) * TILE_SIZE;
    const nx = x < left ? left : x > left + TILE_SIZE ? left + TILE_SIZE : x;
    const ny = y < top ? top : y > top + TILE_SIZE ? top + TILE_SIZE : y;
    const d = (x - nx) * (x - nx) + (y - ny) * (y - ny);
    if (d < found.d) {
      found.x = nx;
      found.y = ny;
      found.d = d;
    }
  });
  return found.d < Infinity ? { x: found.x, y: found.y } : null;
}

/** Clears every solid tile a circle touches; returns the cleared indices in ascending order. */
>>>>
```

```ts file=src/sim/shield.ts
import { nearestSolidTilePoint } from './arena';
import { forEachSolidPointNear } from './collision';
import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config } from './config';
import { HALF_PI, PI, detAtan2, detCos, detSin } from './detmath';
import { headCum } from './trail';
import type { DeathCause, MatchState, SimEvent, SnakeState } from './types';

/**
 * Spends a held Shield to survive `cause`. A blast is simply absorbed; a wall turns the head to
 * slide along it; anything else pushes the head clear and turns it along the surface. Grants
 * shieldGrace. Returns false (changing nothing) when the snake holds no Shield.
 */
export function tryShield(state: MatchState, idx: number, cause: DeathCause, cfg: Config, events: SimEvent[]): boolean {
  const s = state.snakes[idx];
  if (s.item?.kind !== 'shield') return false;
  s.item = null;
  if (cause === 'wall') slideAlongWall(s, cfg.snakeRadius);
  else if (cause !== 'blast') pushClear(state, idx, cause, cfg);
  s.effects.grace = Math.max(1, Math.round(cfg.shieldGrace * TICK_RATE));
  events.push({ type: 'shieldBlocked', player: idx, x: s.x, y: s.y, cause });
  return true;
}

/** The nearest point that blocks the head for `cause` (a head, trail point or block edge), or null. */
export function contactPoint(
  state: MatchState,
  idx: number,
  cause: DeathCause,
  cfg: Config,
): { x: number; y: number } | null {
  const me = state.snakes[idx];
  const touch = 2 * cfg.snakeRadius;
  if (cause === 'obstacle') return nearestSolidTilePoint(state.tiles, me.x, me.y, cfg.snakeRadius);
  const found = { x: 0, y: 0, d: Infinity };
  const consider = (x: number, y: number) => {
    const dx = x - me.x;
    const dy = y - me.y;
    const d = dx * dx + dy * dy;
    if (d < found.d) {
      found.x = x;
      found.y = y;
      found.d = d;
    }
  };
  if (cause === 'headOn') {
    state.snakes.forEach((o, j) => {
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      if (j !== idx && o.alive && dx * dx + dy * dy < touch * touch) consider(o.x, o.y);
    });
  } else if (cause === 'body' || cause === 'self') {
    const neckStart = headCum(me.trail) - cfg.neckLength;
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, i) => {
      const t = state.snakes[snake].trail;
      const blocks = cause === 'self' ? snake === idx && t.cum[i] < neckStart : snake !== idx;
      if (blocks) consider(t.xs[i], t.ys[i]);
    });
  }
  return found.d < Infinity ? { x: found.x, y: found.y } : null;
}

function clampInside(s: SnakeState, r: number): void {
  const m = r + 0.5;
  s.x = Math.min(Math.max(s.x, m), ARENA_WIDTH - m);
  s.y = Math.min(Math.max(s.y, m), ARENA_HEIGHT - m);
}

function slideAlongWall(s: SnakeState, r: number): void {
  const left = s.x - r < 0;
  const right = s.x + r > ARENA_WIDTH;
  const top = s.y - r < 0;
  const bottom = s.y + r > ARENA_HEIGHT;
  clampInside(s, r);
  const hx = detCos(s.heading);
  const hy = detSin(s.heading);
  if ((left || right) && (top || bottom)) s.heading = detAtan2(top ? 1 : -1, left ? 1 : -1);
  else if (left || right) s.heading = hy >= 0 ? HALF_PI : -HALF_PI;
  else if (top || bottom) s.heading = hx >= 0 ? 0 : PI;
  s.prevX = s.x;
  s.prevY = s.y;
}

function pushClear(state: MatchState, idx: number, cause: DeathCause, cfg: Config): void {
  const s = state.snakes[idx];
  const r = cfg.snakeRadius;
  const c = contactPoint(state, idx, cause, cfg);
  if (c) {
    let nx = s.x - c.x;
    let ny = s.y - c.y;
    const len = Math.sqrt(nx * nx + ny * ny);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
    } else {
      nx = -detCos(s.heading);
      ny = -detSin(s.heading);
    }
    const clearance = (cause === 'obstacle' ? r : 2 * r) + 0.5;
    s.x = c.x + nx * clearance;
    s.y = c.y + ny * clearance;
    // Slide along the surface: of the two tangents, take the one closest to the old heading.
    const hx = detCos(s.heading);
    const hy = detSin(s.heading);
    let tx = -ny;
    let ty = nx;
    if (tx * hx + ty * hy < 0) {
      tx = -tx;
      ty = -ty;
    }
    s.heading = detAtan2(ty, tx);
  }
  clampInside(s, r);
  s.prevX = s.x;
  s.prevY = s.y;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/sim && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** with message `feat(sim): Shield deflection — slide along walls and bodies, absorb blasts, grace afterwards` (plus the trailers).

---

### Task 4: Power-ups in the tick loop; bots, invariants, purity and soak

**Files:**
- Modify: `src/sim/step.ts` (edit), `src/sim/invariants.ts` (edit), `src/sim/bots/simple-bot.ts` (edit), `src/sim/purity.test.ts` (edit), `src/sim/soak.test.ts` (edit)
- Test: `src/sim/step-powerups.test.ts` (new)

**Interfaces:**
- Consumes: `tryShield`, `isProtected` (indirectly, through `detectHit`), and `EffectTimers`.
- Produces:
  - `step` judges every head, then applies saves and deaths. Grace ignores blasts, and a held Shield saves.
  - Bots use every kind of item.
  - The purity test bans `**`.

- [ ] **Step 1: Write the failing tests**

```ts file=src/sim/step-powerups.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { HALF_PI, PI } from './detmath';
import { createItem } from './items';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000 };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(s: MatchState, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, idle, cfg));
  return all;
}

function toPlaying(): MatchState {
  const s = createMatch(cfg, 5);
  run(s, Math.round(cfg.countdownSeconds * TICK_RATE));
  return s;
}

const deaths = (events: SimEvent[]) => events.flatMap((e) => (e.type === 'death' ? [[e.player, e.cause]] : []));

describe('step with power-ups', () => {
  it('a Shield saves you from a wall once; the next crash kills', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    cyan.item = createItem('shield', cfg);
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    const first = run(s, 3);
    expect(first).toContainEqual(expect.objectContaining({ type: 'shieldBlocked', player: 0, cause: 'wall' }));
    expect(deaths(first)).toEqual([]);
    expect(cyan.alive).toBe(true);
    expect(cyan.item).toBeNull();
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    expect(deaths(run(s, 3))).toEqual([[0, 'wall']]);
  });

  it('grace shrugs off a blast right after a Shield save', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    cyan.item = createItem('shield', cfg);
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    run(s, 3);
    s.bombs.push({ id: 99, owner: 1, x: cyan.x, y: cyan.y, fuse: 1, maxFuse: 1, chainDepth: 0 });
    expect(deaths(run(s, 1))).toEqual([]);
    expect(cyan.alive).toBe(true);
  });

  // Review Focus 2: a Ghost that wears off inside a body dies.
  it('a Ghost drives through a body, then dies if it wears off inside one', () => {
    const s = toPlaying();
    const [cyan, pink] = s.snakes;
    pink.trail = createTrail();
    for (let y = 200; y <= 800; y += 3) trailPush(pink.trail, 800, y);
    Object.assign(pink, { x: 800, y: 800, prevX: 800, prevY: 800, heading: 0, targetLength: 1e9 });
    cyan.trail = createTrail();
    trailPush(cyan.trail, 760, 500);
    Object.assign(cyan, { x: 760, y: 500, prevX: 760, prevY: 500, heading: 0 });
    cyan.effects.ghost = TICK_RATE;
    rebuildGrid(s);
    expect(deaths(run(s, 30))).toEqual([]);
    expect(cyan.x).toBeGreaterThan(820);

    Object.assign(cyan, { x: 800, y: 400, heading: -HALF_PI });
    cyan.effects.ghost = 2;
    expect(deaths(run(s, 3))).toEqual([[0, 'body']]);
  });

  it('head-on: the shielded snake bounces off and the other dies', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    a.item = createItem('shield', cfg);
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 806, y: 500, heading: PI });
    const events = run(s, 1);
    expect(deaths(events)).toEqual([[1, 'headOn']]);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: 0 });
    expect(a.alive).toBe(true);
  });

  it('head-on with two Shields: both bounce off and live', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    a.item = createItem('shield', cfg);
    b.item = createItem('shield', cfg);
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 806, y: 500, heading: PI });
    const events = run(s, 1);
    expect(deaths(events)).toEqual([]);
    expect(events.filter((e) => e.type === 'shieldBlocked')).toHaveLength(2);
  });
});
```

```edit file=src/sim/purity.test.ts
<<<< OLD
  [/from\s+['"]node:/, 'node: import'],
==== NEW
  [/from\s+['"]node:/, 'node: import'],
  [/\*\*/, 'exponent operator (use multiplication)'],
>>>>
```

```edit file=src/sim/soak.test.ts
<<<< OLD
    ['no pickups at all', { maxPickups: 0 }],
==== NEW
    ['no pickups at all', { maxPickups: 0 }],
    [
      'shields only',
      {
        pickupWeights: { bomb: 0, ghost: 0, shield: 1, turbo: 0, slow: 0, reverse: 0 },
        firstPickupDelay: 0,
        pickupInterval: 1,
        maxPickups: 4,
      },
    ],
    [
      'ghosts only',
      {
        pickupWeights: { bomb: 0, ghost: 1, shield: 0, turbo: 0, slow: 0, reverse: 0 },
        firstPickupDelay: 0,
        pickupInterval: 1,
        maxPickups: 4,
        ghostDuration: 10,
      },
    ],
    [
      'every power-up at once',
      { firstPickupDelay: 0, pickupInterval: 0.5, maxPickups: 6, slowFactor: 0.2, turboDuration: 20, reverseDuration: 20 },
    ],
>>>>
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/sim/step-powerups.test.ts src/sim/purity.test.ts`
Expected: FAIL. Shields don't save anyone yet, and the purity test flags the `**` in `simple-bot.ts`.

- [ ] **Step 3: Implement**

```edit file=src/sim/step.ts
<<<< OLD
import { pickNextMap, startRound } from './state';
==== NEW
import { tryShield } from './shield';
import { pickNextMap, startRound } from './state';
>>>>
<<<< OLD
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
==== NEW
  // Everyone alive at the start of the tick is judged before anyone moves or dies, so
  // simultaneous deaths are fair. Grace ignores blasts; a held Shield turns a death into a save.
  const hits: DeathRecord[] = [];
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const bomber = blasted.get(i);
    if (bomber !== undefined && s.effects.grace <= 0) {
      hits.push({ player: i, cause: 'blast', killer: bomber, x: s.x, y: s.y });
      return;
    }
    const hit = detectHit(state, i, cfg);
    if (hit) hits.push({ player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y });
  });
  for (const d of hits) {
    if (tryShield(state, d.player, d.cause, cfg, events)) continue;
    state.snakes[d.player].alive = false;
    state.deaths.push(d);
    events.push({ type: 'death', ...d });
  }
>>>>
```

```edit file=src/sim/invariants.ts
<<<< OLD
    if (s.item && s.item.charges < 1) problems.push(`snake ${i}: holds an empty item`);
==== NEW
    if (s.item && s.item.charges < 1) problems.push(`snake ${i}: holds an empty item`);
    for (const [name, v] of Object.entries(s.effects)) {
      if (!Number.isInteger(v) || v < 0) problems.push(`snake ${i}: effect ${name} is ${v}`);
    }
>>>>
```

```edit file=src/sim/bots/simple-bot.ts
<<<< OLD
  let use = false;
  if (me.item) {
    const near = state.snakes.some((o, j) => j !== idx && o.alive && dist2(o, me.x, me.y) < BOMB_RANGE * BOMB_RANGE);
    use = rngNext(bot.rng) < (near ? 0.08 : 0.005);
  }
==== NEW
  const near = state.snakes.some((o, j) => j !== idx && o.alive && dist2(o, me.x, me.y) < BOMB_RANGE * BOMB_RANGE);
  let use = false;
  switch (me.item?.kind) {
    case 'bomb':
    case 'slow':
    case 'reverse':
      use = rngNext(bot.rng) < (near ? 0.08 : 0.005);
      break;
    case 'ghost':
      use = best < LOOK_STEPS / 3; // escape when boxed in
      break;
    case 'turbo':
      use = best === LOOK_STEPS && rngNext(bot.rng) < 0.01;
      break;
  }
>>>>
<<<< OLD
    for (const b of state.bombs) if (dist2(b, x, y) < (cfg.blastRadius + r) ** 2 && b.fuse < 45) return k - 1;
==== NEW
    const danger = cfg.blastRadius + r;
    for (const b of state.bombs) if (dist2(b, x, y) < danger * danger && b.fuse < 45) return k - 1;
>>>>
```

- [ ] **Step 4: Run the tests and the soak**

Run: `pnpm vitest run src/sim && pnpm typecheck && pnpm soak --rounds 60`
Expected: every test passes, including the "shields only", "ghosts only" and "every power-up at once" soaks. The typecheck is clean, and the soak exits 0 at ≥ 50× real time.

- [ ] **Step 5: Commit** with message `feat(sim): Shields save, grace protects, bots use every power-up; ban ** in the sim` (plus the trailers).

---
### Task 5: Client visuals — glyphs, status overlays, sounds, HUD colors, tuning

**Files:**
- Modify:
  - Full: `src/client/render/snakes.ts`
  - Edits: `src/client/render/renderer.ts`, `src/client/render/pickups.ts`, `src/client/render/fx.ts`, `src/client/audio.ts`, `src/client/style.css`, `src/client/tuning.ts`, `src/client/settings.ts`, `src/client/screens.ts`
- Test: `src/client/settings.test.ts` (edit)

**Interfaces:**
- Produces:
  - `SnakeView.update(s, alpha, cfg, t)`, which now takes the whole config and the animation time.
  - `Fx.shieldBurst(x, y)`.
  - New sounds: `ghost`, `ghostEnd`, `shield`, `turbo`, `slow`, `reverse`.
  - `resetInPlace(target, defaults)`, which keeps nested objects the same instances.

- [ ] **Step 1: Write the failing test**

```edit file=src/client/settings.test.ts
<<<< OLD
import { DEFAULT_SETTINGS, loadStored, mergeSaved, saveStored } from './settings';
==== NEW
import { DEFAULT_SETTINGS, loadStored, mergeSaved, resetInPlace, saveStored } from './settings';
>>>>
<<<< OLD
describe('loadStored / saveStored', () => {
==== NEW
describe('resetInPlace', () => {
  // M3 Review Focus 5: tuning-panel sliders stay bound to the live weights object.
  it('restores defaults while keeping nested objects the same instances', () => {
    const live = structuredClone(DEFAULT_CONFIG);
    const weights = live.pickupWeights;
    live.baseSpeed = 999;
    weights.bomb = 0;
    resetInPlace(live, DEFAULT_CONFIG);
    expect(live).toEqual(DEFAULT_CONFIG);
    expect(live.pickupWeights).toBe(weights);
    expect(live.pickupWeights).not.toBe(DEFAULT_CONFIG.pickupWeights);
  });
});

describe('loadStored / saveStored', () => {
>>>>
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/client/settings.test.ts`
Expected: FAIL. `resetInPlace` is not exported.

- [ ] **Step 3: Implement**

```edit file=src/client/settings.ts
<<<< OLD
export function loadStored<T extends object>(
==== NEW
/** Resets `target` to `defaults` in place, keeping nested objects the same instances (UI bindings stay live). */
export function resetInPlace<T extends object>(target: T, defaults: T): void {
  const t = target as Record<string, unknown>;
  const d = defaults as Record<string, unknown>;
  for (const key of Object.keys(d)) {
    const dv = d[key];
    const tv = t[key];
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && tv && typeof tv === 'object') {
      resetInPlace(tv as object, dv as object);
    } else {
      t[key] = structuredClone(dv);
    }
  }
}

export function loadStored<T extends object>(
>>>>
```

```ts file=src/client/render/snakes.ts
import { Container, Graphics } from 'pixi.js';
import { TICK_RATE, type Config, type SnakeState, type Trail } from '../../sim';
import { PALETTE, PICKUP_COLORS } from '../colors';

/** Points per body chunk. Only the tail and head chunks are redrawn each frame. */
const CHUNK = 128;

/** One chunk's two strokes; they live in separate layers so every core sits above every tube. */
interface Chunk {
  tube: Graphics;
  core: Graphics;
}

/** Draws one snake as a neon tube (colored stroke + bright core) with a glowing, status-aware head. */
export class SnakeView {
  private readonly tubes = new Container();
  private readonly cores = new Container();
  private readonly head = new Graphics();
  private readonly chunks = new Map<number, Chunk>();
  private lastHoleVersion = -1;

  constructor(
    parent: Container,
    private readonly color: number,
  ) {
    const layer = new Container();
    layer.addChild(this.tubes, this.cores, this.head);
    parent.addChild(layer);
  }

  reset(): void {
    for (const chunk of this.chunks.values()) destroyChunk(chunk);
    this.chunks.clear();
    this.lastHoleVersion = -1;
    this.head.clear();
    this.setVisible(true);
  }

  hide(): void {
    this.setVisible(false);
  }

  update(s: SnakeState, alpha: number, cfg: Config, t: number): void {
    this.setVisible(true);
    const radius = cfg.snakeRadius;
    const trail = s.trail;
    const startSeq = trail.baseSeq + trail.start;
    const headSeq = trail.baseSeq + trail.xs.length - 1;
    const firstChunk = Math.floor(startSeq / CHUNK);
    const lastChunk = Math.floor(headSeq / CHUNK);

    for (const [k, chunk] of this.chunks) {
      if (k < firstChunk) {
        destroyChunk(chunk);
        this.chunks.delete(k);
      }
    }

    // Blasts punch holes anywhere along the body, so a new hole redraws every chunk once.
    const holesChanged = s.holeVersion !== this.lastHoleVersion;
    this.lastHoleVersion = s.holeVersion;
    const hx = s.prevX + (s.x - s.prevX) * alpha;
    const hy = s.prevY + (s.y - s.prevY) * alpha;
    for (let k = firstChunk; k <= lastChunk; k++) {
      let chunk = this.chunks.get(k);
      const fresh = !chunk;
      if (!chunk) {
        chunk = { tube: new Graphics(), core: new Graphics() };
        this.chunks.set(k, chunk);
        this.tubes.addChild(chunk.tube);
        this.cores.addChild(chunk.core);
      }
      if (fresh || holesChanged || k === firstChunk || k >= lastChunk - 1) {
        this.drawChunk(chunk, trail, k, startSeq, headSeq, hx, hy, radius);
      }
    }
    this.drawHead(s, hx, hy, cfg, t);
  }

  private setVisible(visible: boolean): void {
    this.tubes.visible = visible;
    this.cores.visible = visible;
    this.head.visible = visible;
  }

  private drawChunk(
    chunk: Chunk,
    trail: Trail,
    k: number,
    startSeq: number,
    headSeq: number,
    hx: number,
    hy: number,
    radius: number,
  ): void {
    // Overlap one point with the previous chunk so chunks join seamlessly.
    const from = Math.max(k * CHUNK - 1, startSeq);
    const to = Math.min((k + 1) * CHUNK, headSeq);
    const runs: number[][] = [];
    let run: number[] = [];
    for (let seq = from; seq <= to; seq++) {
      const i = seq - trail.baseSeq;
      if (!trail.solid[i]) {
        if (run.length > 0) runs.push(run);
        run = [];
        continue;
      }
      if (seq === headSeq) run.push(hx, hy);
      else run.push(trail.xs[i], trail.ys[i]);
    }
    if (run.length > 0) runs.push(run);

    strokeRuns(chunk.tube, runs, radius * 2, this.color);
    strokeRuns(chunk.core, runs, Math.max(1.5, radius * 0.7), PALETTE.core);
  }

  /** The head plus status: turbo streaks, slow halo, ghost glow, shield ring, grace flash, reverse swirl. */
  private drawHead(s: SnakeState, x: number, y: number, cfg: Config, t: number): void {
    const g = this.head;
    const r = cfg.snakeRadius;
    const e = s.effects;
    g.clear();

    if (e.turbo > 0) {
      const bx = -Math.cos(s.heading);
      const by = -Math.sin(s.heading);
      for (const side of [-0.8, 0, 0.8]) {
        const ox = -by * side * r;
        const oy = bx * side * r;
        g.moveTo(x + ox + bx * r * 1.5, y + oy + by * r * 1.5).lineTo(x + ox + bx * r * 3.4, y + oy + by * r * 3.4);
      }
      g.stroke({ width: 2, color: PICKUP_COLORS.turbo, cap: 'round' });
    }
    if (e.slow > 0) {
      g.circle(x, y, r * 2.1).stroke({ width: 2, color: PICKUP_COLORS.slow, alpha: 0.55 + 0.3 * Math.sin(t * 10) });
    }

    const flicker = e.ghost > 0 && e.ghost < cfg.ghostWarning * TICK_RATE && Math.floor(t * 12) % 2 === 0;
    if (e.ghost > 0 && !flicker) {
      g.circle(x, y, r * 1.6).fill({ color: PICKUP_COLORS.ghost, alpha: 0.25 });
      g.circle(x, y, r * 0.9).fill({ color: PICKUP_COLORS.ghost, alpha: 0.75 });
    } else {
      g.circle(x, y, r * 1.25).fill({ color: this.color });
      g.circle(x, y, r * 0.7).fill({ color: PALETTE.core });
    }
    const ex = x + Math.cos(s.heading) * r * 0.55;
    const ey = y + Math.sin(s.heading) * r * 0.55;
    g.circle(ex, ey, Math.max(1.2, r * 0.28)).fill({ color: PALETTE.background });

    if (s.item?.kind === 'shield') {
      g.circle(x, y, r * 2.4).stroke({ width: 2.5, color: PICKUP_COLORS.shield, alpha: 0.85 });
    }
    if (e.grace > 0 && Math.floor(t * 16) % 2 === 0) {
      g.circle(x, y, r * 2.8).stroke({ width: 3, color: PICKUP_COLORS.shield });
    }
    if (e.reverse > 0) {
      const a = t * 8;
      const cy = y - r * 2.8;
      g.moveTo(x + Math.cos(a) * r, cy + Math.sin(a) * r)
        .arc(x, cy, r, a, a + Math.PI * 1.4)
        .stroke({ width: 2, color: PICKUP_COLORS.reverse, cap: 'round' });
    }
  }
}

/** Opaque strokes, so the one-point overlap between chunks never shows a seam. */
function strokeRuns(g: Graphics, runs: readonly number[][], width: number, color: number): void {
  g.clear();
  for (const pts of runs) {
    if (pts.length === 2) {
      g.circle(pts[0], pts[1], width / 2).fill({ color });
      continue;
    }
    g.moveTo(pts[0], pts[1]);
    for (let j = 2; j < pts.length; j += 2) g.lineTo(pts[j], pts[j + 1]);
    g.stroke({ width, color, cap: 'round', join: 'round' });
  }
}

function destroyChunk(chunk: Chunk): void {
  chunk.tube.destroy();
  chunk.core.destroy();
}
```

```edit file=src/client/render/renderer.ts
<<<< OLD
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg.snakeRadius);
==== NEW
      if (s.alive) view.update(s, state.phase === 'playing' ? alpha : 1, cfg, timeSeconds);
>>>>
```

```edit file=src/client/render/pickups.ts
<<<< OLD
    case 'bomb':
      g.circle(x - s * 0.1, y + s * 0.15, s * 0.7).fill({ color });
      g.moveTo(x + s * 0.3, y - s * 0.4)
        .lineTo(x + s * 0.75, y - s * 0.9)
        .stroke({ width: 2, color: PALETTE.fuse, cap: 'round' });
      break;
  }
==== NEW
    case 'bomb':
      g.circle(x - s * 0.1, y + s * 0.15, s * 0.7).fill({ color });
      g.moveTo(x + s * 0.3, y - s * 0.4)
        .lineTo(x + s * 0.75, y - s * 0.9)
        .stroke({ width: 2, color: PALETTE.fuse, cap: 'round' });
      break;
    case 'ghost':
      g.circle(x, y - s * 0.15, s * 0.6).fill({ color });
      g.rect(x - s * 0.6, y - s * 0.15, s * 1.2, s * 0.75).fill({ color });
      g.circle(x - s * 0.22, y - s * 0.2, s * 0.14).fill({ color: PALETTE.background });
      g.circle(x + s * 0.22, y - s * 0.2, s * 0.14).fill({ color: PALETTE.background });
      break;
    case 'shield':
      g.poly([x, y - s * 0.9, x + s * 0.75, y - s * 0.55, x + s * 0.6, y + s * 0.35, x, y + s * 0.9, x - s * 0.6, y + s * 0.35, x - s * 0.75, y - s * 0.55]).stroke({
        width: 2.5,
        color,
        join: 'round',
      });
      break;
    case 'turbo':
      g.poly([x + s * 0.15, y - s * 0.95, x - s * 0.55, y + s * 0.1, x - s * 0.05, y + s * 0.1, x - s * 0.2, y + s * 0.95, x + s * 0.55, y - s * 0.15, x + s * 0.05, y - s * 0.15]).fill({
        color,
      });
      break;
    case 'slow':
      g.poly([x - s * 0.55, y - s * 0.8, x + s * 0.55, y - s * 0.8, x, y]).fill({ color });
      g.poly([x - s * 0.55, y + s * 0.8, x + s * 0.55, y + s * 0.8, x, y]).fill({ color });
      break;
    case 'reverse':
      g.moveTo(x - s * 0.7, y - s * 0.3)
        .lineTo(x + s * 0.45, y - s * 0.3)
        .moveTo(x + s * 0.7, y + s * 0.3)
        .lineTo(x - s * 0.45, y + s * 0.3)
        .stroke({ width: 2.5, color, cap: 'round' });
      g.poly([x + s * 0.8, y - s * 0.3, x + s * 0.35, y - s * 0.62, x + s * 0.35, y + s * 0.02]).fill({ color });
      g.poly([x - s * 0.8, y + s * 0.3, x - s * 0.35, y - s * 0.02, x - s * 0.35, y + s * 0.62]).fill({ color });
      break;
  }
>>>>
```

```edit file=src/client/render/fx.ts
<<<< OLD
import { PALETTE } from '../colors';
==== NEW
import { PALETTE, PICKUP_COLORS } from '../colors';
>>>>
<<<< OLD
  pickupBurst(x: number, y: number, color: number): void {
==== NEW
  /** A Shield soaking up a hit: a bright green ring, sparks and a little shake. */
  shieldBurst(x: number, y: number): void {
    this.ring(x, y, 46, 0.4, PICKUP_COLORS.shield);
    this.ring(x, y, 26, 0.25, 0xffffff);
    for (let k = 0; k < 30; k++) this.spark(x, y, PICKUP_COLORS.shield, 120 + Math.random() * 200, 0.3 + Math.random() * 0.4, 2);
    this.addShake(6);
  }

  pickupBurst(x: number, y: number, color: number): void {
>>>>
```

```edit file=src/client/audio.ts
<<<< OLD
  | 'tick';
==== NEW
  | 'tick'
  | 'ghost'
  | 'ghostEnd'
  | 'shield'
  | 'turbo'
  | 'slow'
  | 'reverse';
>>>>
<<<< OLD
  tick: [0.3, 0, 1600, 0, 0.005, 0.03, 0],
==== NEW
  tick: [0.3, 0, 1600, 0, 0.005, 0.03, 0],
  ghost: [0.5, 0, 300, 0.05, 0.25, 0.3, 0, 1, 2, 0, 0, 0, 0, 0, 5],
  ghostEnd: [0.4, 0, 500, 0.01, 0.05, 0.15, 0, 1, -3],
  shield: [0.9, 0.05, 400, 0, 0.05, 0.3, 1, 2, 0, 0, 200, 0.02, 0, 0, 0, 0.1],
  turbo: [0.6, 0, 200, 0.02, 0.3, 0.2, 2, 1, 6, 0.5],
  slow: [0.6, 0, 600, 0.02, 0.3, 0.3, 1, 1, -6, -0.2],
  reverse: [0.6, 0, 440, 0.01, 0.3, 0.2, 1, 1, 0, 0, 0, 0, 0, 0, 12],
>>>>
```

```edit file=src/client/style.css
<<<< OLD
  --bomb: #ff4d2e;
==== NEW
  --bomb: #ff4d2e;
  --ghost: #e8f4ff;
  --shield: #3dff7a;
  --turbo: #ffe14d;
  --slow: #4d7cff;
  --reverse: #b44dff;
>>>>
<<<< OLD
.slot[data-kind='bomb'] {
  color: var(--bomb);
}
==== NEW
.slot[data-kind='bomb'] {
  color: var(--bomb);
}

.slot[data-kind='ghost'] {
  color: var(--ghost);
}

.slot[data-kind='shield'] {
  color: var(--shield);
}

.slot[data-kind='turbo'] {
  color: var(--turbo);
}

.slot[data-kind='slow'] {
  color: var(--slow);
}

.slot[data-kind='reverse'] {
  color: var(--reverse);
}
>>>>
```

```edit file=src/client/tuning.ts
<<<< OLD
import { DEFAULT_CONFIG, type Config } from '../sim';
import { DEFAULT_SETTINGS, type ClientSettings } from './settings';
==== NEW
import { DEFAULT_CONFIG, type Config, type PickupKind } from '../sim';
import { DEFAULT_SETTINGS, resetInPlace, type ClientSettings } from './settings';
>>>>
<<<< OLD
  const fx = gui.addFolder('Effects');
==== NEW
  const power = gui.addFolder('Power-ups');
  power.add(cfg, 'ghostDuration', 0.5, 10, 0.25).name('ghost (s)');
  power.add(cfg, 'ghostWarning', 0, 3, 0.25).name('ghost warning (s)');
  power.add(cfg, 'shieldGrace', 0, 3, 0.1).name('shield grace (s)');
  power.add(cfg, 'turboDuration', 0.5, 15, 0.5).name('turbo (s)');
  power.add(cfg, 'slowDuration', 0.5, 15, 0.5).name('slow (s)');
  power.add(cfg, 'slowFactor', 0.1, 1, 0.05).name('slow speed ×');
  power.add(cfg, 'reverseDuration', 0.5, 15, 0.5).name('reverse (s)');

  const mix = gui.addFolder('Pickup mix');
  for (const kind of Object.keys(cfg.pickupWeights) as PickupKind[]) mix.add(cfg.pickupWeights, kind, 0, 100, 1);

  const fx = gui.addFolder('Effects');
>>>>
<<<< OLD
      Object.assign(cfg, structuredClone(DEFAULT_CONFIG));
      Object.assign(settings, structuredClone(DEFAULT_SETTINGS));
==== NEW
      resetInPlace(cfg, DEFAULT_CONFIG);
      resetInPlace(settings, DEFAULT_SETTINGS);
>>>>
```

```edit file=src/client/screens.ts
<<<< OLD
        <div class="small">GRAB PICKUPS FOR BOMBS · BLASTS BREAK BODIES AND BLOCKS</div>
==== NEW
        <div class="small">PICKUPS: BOMB · GHOST · SHIELD · TURBO · SLOW · REVERSE</div>
>>>>
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit** with message `feat(client): power-up glyphs, status overlays, sounds, HUD colors and tuning; reset keeps sliders bound` (plus the trailers).

---

### Task 6: Wire the events, verify in a browser, ship v0.3.0

**Files:**
- Modify: `src/client/main.ts` (edit), `README.md` (edit)

**Interfaces:**
- Consumes: everything above.
- Produces: the playable M3 build, a merged PR, and the `v0.3.0` tag.

- [ ] **Step 1: Handle the power-up events**

```edit file=src/client/main.ts
<<<< OLD
import { createMatch, DEFAULT_CONFIG, rematch, step, type MatchState, type SimEvent } from '../sim';
import { Sound } from './audio';
==== NEW
import { createMatch, DEFAULT_CONFIG, rematch, step, type MatchState, type PickupKind, type SimEvent } from '../sim';
import { Sound, type SoundName } from './audio';
>>>>
<<<< OLD
const FUSE_TICK_EVERY = 8;
==== NEW
const FUSE_TICK_EVERY = 8;

const ITEM_SOUNDS: Partial<Record<PickupKind, SoundName>> = {
  ghost: 'ghost',
  turbo: 'turbo',
  slow: 'slow',
  reverse: 'reverse',
};
>>>>
<<<< OLD
        case 'explosion':
          fx.explosion(e.x, e.y, e.radius, e.chainDepth, e.tilesDestroyed);
          sound.play('explosion', 1, 1 + 0.12 * Math.min(e.chainDepth, 5));
          break;
==== NEW
        case 'explosion':
          fx.explosion(e.x, e.y, e.radius, e.chainDepth, e.tilesDestroyed);
          sound.play('explosion', 1, 1 + 0.12 * Math.min(e.chainDepth, 5));
          break;
        case 'itemUsed': {
          const name = ITEM_SOUNDS[e.kind];
          if (name) sound.play(name);
          break;
        }
        case 'effectStarted': {
          const s = state.snakes[e.player];
          fx.pickupBurst(s.x, s.y, PICKUP_COLORS[e.effect]);
          break;
        }
        case 'effectEnded':
          if (e.effect === 'ghost') sound.play('ghostEnd', 0.7);
          break;
        case 'shieldBlocked':
          fx.shieldBurst(e.x, e.y);
          sound.play('shield');
          break;
>>>>
```

```edit file=README.md
<<<< OLD
Grab glowing pickups for bombs (three per pickup, dropped with Use).
==== NEW
Pickups also hold power-ups: **Ghost** (your head slips through bodies and blocks for 3 s), **Shield** (automatically survive your next crash), **Turbo** (free boost), and **Slow** / **Reverse** (slow your opponent or swap their left and right). Both item slots show on the HUD, so you always know what your opponent is holding.

Grab glowing pickups for bombs (three per pickup, dropped with Use).
>>>>
```

- [ ] **Step 2: Run the whole suite, the build and the soak**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm soak --rounds 60`
Expected: everything is green. The soak shows shield saves in the log (a count of `shieldBlocked` is optional) and runs at ≥ 50× real time.

- [ ] **Step 3: Verify in a real browser**

Start the dev server on port 5199 with `BROWSER=none`. Use Playwright with Chrome and Metal, driving the game through `window.__snakeboom.state`:
1. Inject one pickup of each kind and screenshot the six glyphs.
2. Give CYAN a Shield (screenshot the ring), steer it into the left wall, and screenshot the save burst.
3. Give PINK a Reverse and press ↓ to use it, then screenshot the swirl above CYAN.
4. Give CYAN a Ghost and press S, then screenshot the ghost head.
5. Give CYAN a Turbo and PINK a Slow, use both, and screenshot the streaks and the halo.
6. Screenshot the HUD item labels in their colors.

Check that the console has zero errors.

- [ ] **Step 4: Commit, PR, merge, tag**

Commit with `feat: playable M3 power-ups — Ghost, Shield, Turbo, Slow and Reverse` (plus the trailers). Push `v1-prototype` and open a PR titled "M3: Power-ups — Ghost, Shield, Turbo, Slow, Reverse". Merge it, sync `main` (over HTTPS if SSH hiccups), fast-forward `v1-prototype`, then tag the merge commit `v0.3.0` and push the tag.
