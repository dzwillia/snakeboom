import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { hashState } from './hash';
import { findSpawnPoint, updatePickups } from './pickups';
import { createMatch } from './state';
import { step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, hearts: 2, roundMaxSeconds: 4, borderCloseSeconds: 2, borderCloseSpeed: 30, borderCrushSpeed: 300 };

function playing(c: Config = cfg): MatchState {
  const s = createMatch(c, 3);
  s.phase = 'playing';
  s.phaseTicks = 0;
  return s;
}

function run(s: MatchState, ticks: number, c: Config = cfg, inputs: PlayerInput[] = [NO_INPUT, NO_INPUT]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, c));
  return out;
}

// M9 Review Focus 2 and 3: the closing border is deterministic, fair, and always ends the round.
describe('the closing border', () => {
  it('stays put, then closes at borderCloseSpeed, then at borderCrushSpeed past the cap', () => {
    const s = playing();
    // Park both snakes in the middle, circling, so nothing else happens.
    s.snakes[0].x = 700;
    s.snakes[1].x = 900;
    for (const sn of s.snakes) sn.y = 500;
    const circle: PlayerInput[] = [
      { turn: 1, boost: false, use: false, select: false },
      { turn: -1, boost: false, use: false, select: false },
    ];
    const events = run(s, 2 * TICK_RATE, cfg, circle);
    expect(s.inset).toBe(0);
    expect(events.some((e) => e.type === 'borderClosing')).toBe(false);
    const more = run(s, TICK_RATE, cfg, circle);
    expect(more.filter((e) => e.type === 'borderClosing')).toHaveLength(1);
    expect(s.inset).toBeCloseTo(30, 6);
    run(s, TICK_RATE, cfg, circle);
    expect(s.inset).toBeCloseTo(60, 6);
    run(s, 10, cfg, circle);
    expect(s.inset).toBeCloseTo(60 + (300 * 10) / TICK_RATE, 6);
  });

  it('is part of the hashed state', () => {
    const a = playing();
    const b = playing();
    expect(hashState(a)).toBe(hashState(b));
    b.inset = 5;
    expect(hashState(a)).not.toBe(hashState(b));
  });

  it('costs a heart and deflects a head the border reaches, like a wall', () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 800, y: 20, heading: 0 });
    Object.assign(s.snakes[1], { x: 800, y: 500, heading: 0 });
    // Skip to the closing phase and drive along the top edge.
    s.roundTicks = Math.round((cfg.roundMaxSeconds - cfg.borderCloseSeconds) * TICK_RATE);
    const events = run(s, TICK_RATE, cfg);
    const lost = events.filter((e) => e.type === 'heartLost' && e.player === 0);
    expect(lost.length).toBeGreaterThanOrEqual(1);
    expect(lost[0]).toMatchObject({ cause: 'wall' });
    expect(me.alive).toBe(true);
    expect(me.y - cfg.snakeRadius).toBeGreaterThanOrEqual(s.inset - 1e-6);
  });

  it('never lets a round end in a draw at the cap: someone dies within seconds', () => {
    const s = playing();
    Object.assign(s.snakes[0], { x: 700, y: 500 });
    Object.assign(s.snakes[1], { x: 900, y: 500 });
    const circle: PlayerInput[] = [
      { turn: 1, boost: false, use: false, select: false },
      { turn: -1, boost: false, use: false, select: false },
    ];
    let over: SimEvent | undefined;
    for (let t = 0; t < 12 * TICK_RATE && !over; t++) over = step(s, circle, cfg).find((e) => e.type === 'roundOver');
    expect(over).toBeDefined();
    expect(s.roundTicks).toBeLessThan((cfg.roundMaxSeconds + 6) * TICK_RATE);
    // The crush ends it one way or another: a wall hit, or two snakes squeezed into each other.
    const deaths = (over as { deaths: { cause: string }[] }).deaths;
    expect(deaths.length).toBeGreaterThan(0);
    expect(s.inset).toBeGreaterThan(0);
  });

  it('keeps pickups out of the dead zone and expires any it swallows', () => {
    const s = playing();
    s.inset = 300;
    for (let i = 0; i < 50; i++) {
      const spot = findSpawnPoint(s, cfg);
      if (!spot) continue;
      expect(spot.x).toBeGreaterThanOrEqual(300 + cfg.pickupClearance);
      expect(spot.x).toBeLessThanOrEqual(ARENA_WIDTH - 300 - cfg.pickupClearance);
      expect(spot.y).toBeGreaterThanOrEqual(300 + cfg.pickupClearance);
      expect(spot.y).toBeLessThanOrEqual(ARENA_HEIGHT - 300 - cfg.pickupClearance);
    }
    s.pickups = [
      { id: 1, kind: 'missile', x: 100, y: 500, ttl: 500 },
      { id: 2, kind: 'ghost', x: 800, y: 500, ttl: 500 },
    ];
    const events: SimEvent[] = [];
    updatePickups(s, cfg, events);
    expect(events.filter((e) => e.type === 'pickupExpired').map((e) => (e as { id: number }).id)).toEqual([1]);
    expect(s.pickups.map((p) => p.id)).toEqual([2]);
  });

  it('resets to zero at the start of the next round', () => {
    const s = playing();
    s.inset = 100;
    s.snakes[1].alive = false;
    run(s, 1 + Math.round(cfg.roundOverSeconds * TICK_RATE), cfg);
    expect(s.round).toBe(2);
    expect(s.inset).toBe(0);
  });
});
