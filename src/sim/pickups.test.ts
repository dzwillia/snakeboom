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
    const none = { bomb: 0, ghost: 0, shield: 0, turbo: 0, slow: 0, reverse: 0 };
    expect(pickKind({ ...none, shield: 5 }, rng)).toBe('shield');
    expect(pickKind(none, rng)).toBeNull();
  });

  it('follows the default pickup mix', () => {
    const rng = createRng(4);
    const counts: Record<string, number> = {};
    const draws = 20_000;
    for (let i = 0; i < draws; i++) {
      const kind = pickKind(DEFAULT_CONFIG.pickupWeights, rng)!;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    const weights = DEFAULT_CONFIG.pickupWeights;
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [kind, w] of Object.entries(weights)) expect(counts[kind] / draws).toBeCloseTo(w / total, 1);
  });

  it('spawns the first pickup after firstPickupDelay, then one per interval up to maxPickups', () => {
    const s = playing();
    const first = Math.round(cfg.firstPickupDelay * TICK_RATE);
    const interval = Math.round(cfg.pickupInterval * TICK_RATE);
    expect(tick(s, first - 1)).toEqual([]);
    const spawned = tick(s, 1);
    expect(spawned).toEqual([expect.objectContaining({ type: 'pickupSpawned' })]);
    tick(s, interval * (cfg.maxPickups - 1));
    expect(s.pickups).toHaveLength(cfg.maxPickups);
    tick(s, interval);
    expect(s.pickups).toHaveLength(cfg.maxPickups);
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
