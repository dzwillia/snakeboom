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
  s.snakes[0].items = [createItem(kind, cfg)];
  return s;
}

function use(s: MatchState, idx = 0): SimEvent[] {
  const events: SimEvent[] = [];
  useItem(s, idx, cfg, events);
  return events;
}

describe('power-ups', () => {
  it('Ghost affects the user; Reverse hits the opponent', () => {
    for (const [kind, target] of [
      ['ghost', 0],
      ['reverse', 1],
    ] as const) {
      const s = holding(kind);
      expect(use(s)).toEqual([
        { type: 'itemUsed', player: 0, kind },
        { type: 'effectStarted', player: target, effect: kind },
      ]);
      expect(s.snakes[target].effects[kind]).toBe(Math.round(cfg[`${kind}Duration`] * TICK_RATE));
      expect(s.snakes[0].items).toEqual([]);
    }
  });

  it('Use with an empty queue does nothing, even while shielded', () => {
    const s = holding('bomb');
    s.snakes[0].items = [];
    s.snakes[0].shield = true;
    expect(use(s)).toEqual([]);
    expect(s.snakes[0].shield).toBe(true);
  });

  it('Reverse skips dead opponents', () => {
    const s = holding('reverse');
    s.snakes[1].alive = false;
    expect(use(s)).toEqual([{ type: 'itemUsed', player: 0, kind: 'reverse' }]);
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

  it('speed is base speed, doubled while boosting', () => {
    const sn = createSnake(0, 800, 500, 0, cfg);
    expect(snakeSpeed(sn, cfg)).toBe(cfg.baseSpeed);
    sn.boosting = true;
    expect(snakeSpeed(sn, cfg)).toBeCloseTo(cfg.baseSpeed * cfg.boostMultiplier, 9);
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

  // The neck stays safe while turning at the maximum rate.
  it('never clips its own neck while turning at the maximum rate', () => {
    const s = holding('bomb');
    const me = s.snakes[0];
    for (let t = 0; t < 3 * TICK_RATE; t++) {
      advanceSnake(me, 0, { turn: 1, boost: false, use: false }, cfg, 0, s.grid);
      expect(detectHit(s, 0, cfg)).toBeNull();
    }
  });
});
