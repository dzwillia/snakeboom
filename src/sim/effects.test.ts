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
