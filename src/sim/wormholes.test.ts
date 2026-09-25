import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { checkInvariants } from './invariants';
import { createMatch } from './state';
import { step } from './step';
import { headCum, trailLength } from './trail';
import { type MatchState, type PlayerInput, type SimEvent, type WormholeState } from './types';
import { enterWormholes, updateWormholes } from './wormholes';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, borderCloseSeconds: 0, hearts: 1 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
/** Holding a turn keeps a snake circling in one spot (radius about 44) instead of running into the wall. */
const circle: PlayerInput = { turn: 1, boost: false, use: false };

function playing(seed = 5): MatchState {
  const s = createMatch(cfg, seed);
  s.phase = 'playing';
  s.phaseTicks = 0;
  return s;
}

/** A wormhole placed by hand: portal at (px, py), exit at (ex, ey). */
function hole(s: MatchState, px: number, py: number, ex: number, ey: number, ttl = 600): WormholeState {
  const w = { id: s.nextId++, x: px, y: py, exitX: ex, exitY: ey, ttl };
  s.wormholes.push(w);
  return w;
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = [straight, straight]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, cfg));
  return out;
}

describe('wormholes', () => {
  it('opens one every wormholeInterval with the exit at least wormholeMinJump away, and closes it after wormholeLifetime', () => {
    const s = playing();
    const events: SimEvent[] = [];
    const interval = Math.round(cfg.wormholeInterval * TICK_RATE);
    for (let t = 0; t < interval - 1; t++) updateWormholes(s, cfg, events);
    expect(s.wormholes).toEqual([]);
    updateWormholes(s, cfg, events);
    expect(s.wormholes).toHaveLength(1);
    const w = s.wormholes[0];
    expect(Math.hypot(w.exitX - w.x, w.exitY - w.y)).toBeGreaterThanOrEqual(cfg.wormholeMinJump);
    expect(events).toEqual([{ type: 'wormholeOpened', id: w.id, x: w.x, y: w.y, exitX: w.exitX, exitY: w.exitY }]);
    expect(checkInvariants(s, cfg)).toEqual([]);

    // The timer firing while one is open opens nothing: one at a time.
    s.wormholeTimer = 1;
    updateWormholes(s, cfg, events);
    expect(s.wormholes).toHaveLength(1);
    expect(s.wormholeTimer).toBe(interval);
    const life = Math.round(cfg.wormholeLifetime * TICK_RATE);
    let ticks = 1;
    while (s.wormholes.length > 0) {
      updateWormholes(s, cfg, events);
      ticks++;
    }
    expect(ticks).toBe(life);
    expect(events.at(-1)).toEqual({ type: 'wormholeClosed', id: w.id });
  });

  it('never opens with wormholeInterval 0', () => {
    const s = playing();
    const off = { ...cfg, wormholeInterval: 0 };
    for (let t = 0; t < 60 * TICK_RATE; t++) updateWormholes(s, off, []);
    expect(s.wormholes).toEqual([]);
  });

  it('sends a head touching the portal to the exit, keeping its heading and leaving its body behind', () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    hole(s, 700, 500, 2400, 1400);
    const before = trailLength(me.trail);
    const events = run(s, 30);
    const warp = events.find((e) => e.type === 'warped');
    expect(warp).toMatchObject({ type: 'warped', player: 0, x: 2400, y: 1400 });
    expect(warp && warp.type === 'warped' && warp.fromX).toBeGreaterThan(650);
    expect(me.heading).toBe(0);
    // Since then the head has moved on from the exit, and the body is one jump: a non-solid point of zero length.
    expect(me.x).toBeGreaterThan(2400);
    expect(me.y).toBeCloseTo(1400, 6);
    const t = me.trail;
    const jumps = t.solid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    expect(jumps).toHaveLength(1);
    const j = jumps[0];
    expect(t.cum[j]).toBe(t.cum[j - 1]);
    expect(t.xs[j]).toBe(2400);
    // The chord across the map added no length.
    expect(trailLength(t)).toBeLessThan(before + 30 * cfg.baseSpeed / TICK_RATE + 1);
    expect(headCum(t)).toBeGreaterThan(t.cum[j]);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('will not take the same head again during portalCooldown, but will after it', () => {
    const s = playing();
    const me = s.snakes[0];
    // The exit sits right on a second portal that leads straight back.
    Object.assign(me, { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    hole(s, 700, 500, 2400, 1400);
    const events: SimEvent[] = [];
    run(s, 25).forEach((e) => events.push(e));
    expect(events.filter((e) => e.type === 'warped')).toHaveLength(1);
    expect(me.portalCooldown).toBeGreaterThan(0);
    // Park the head back on the portal while the cooldown runs: nothing happens.
    Object.assign(me, { x: 700, y: 500 });
    enterWormholes(s, cfg, events);
    expect(events.filter((e) => e.type === 'warped')).toHaveLength(1);
    me.portalCooldown = 0;
    enterWormholes(s, cfg, events);
    expect(events.filter((e) => e.type === 'warped')).toHaveLength(2);
  });

  it('does not count a loop that spans a jump', () => {
    // CYAN draws a wide box around PINK, but its path goes through a wormhole halfway round: no chord, no kill.
    const s = playing();
    const me = s.snakes[0];
    const other = s.snakes[1];
    Object.assign(other, { x: 1600, y: 1000, prevX: 1600, prevY: 1000, heading: 0 });
    Object.assign(me, { x: 1200, y: 600, prevX: 1200, prevY: 600, heading: 0, targetLength: 5000 });
    // Portal on the box's top edge, exit on its bottom edge, so the loop closes back at the start.
    hole(s, 2000, 600, 2000, 1400, 6000);
    const left: PlayerInput = { turn: -1, boost: false, use: false };
    const events: SimEvent[] = [];
    // East along the top, through the portal, out at the bottom heading east; then turn round and come back west along the bottom, then north up the left side.
    events.push(...run(s, 180, [straight, circle]));
    expect(events.some((e) => e.type === 'warped')).toBe(true);
    // Turn 180° (u-turn to the left takes ~pi / turnRate seconds).
    const uTurn = Math.round((Math.PI / cfg.turnRate) * TICK_RATE);
    events.push(...run(s, uTurn, [left, circle]));
    events.push(...run(s, 200, [straight, circle]));
    events.push(...run(s, Math.round((Math.PI / 2 / cfg.turnRate) * TICK_RATE), [circle, circle]));
    events.push(...run(s, 240, [straight, circle]));
    expect(me.alive).toBe(true);
    expect(events.some((e) => e.type === 'encircled')).toBe(false);
    expect(other.alive).toBe(true);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('closes a wormhole the border swallows', () => {
    const s = playing();
    hole(s, 40, 500, 2400, 1400);
    s.inset = 100;
    const events: SimEvent[] = [];
    updateWormholes(s, cfg, events);
    expect(s.wormholes).toEqual([]);
    expect(events).toEqual([{ type: 'wormholeClosed', id: expect.any(Number) }]);
  });

  it('pickups never spawn inside a wormhole', () => {
    const s = playing();
    const w = hole(s, 1000, 700, 2400, 1400, 100000);
    const busy = { ...cfg, firstPickupDelay: 0, pickupInterval: 0.05, maxPickups: 200, pickupLifetime: 1000 };
    s.pickupTimer = 1;
    for (let t = 0; t < 30 * TICK_RATE; t++) step(s, [circle, circle], busy);
    expect(s.round).toBe(1);
    expect(s.pickups.length).toBeGreaterThan(50);
    const clear = busy.pickupClearance + busy.wormholeRadius;
    for (const p of s.pickups) {
      expect(Math.hypot(p.x - w.x, p.y - w.y)).toBeGreaterThanOrEqual(clear);
      expect(Math.hypot(p.x - w.exitX, p.y - w.exitY)).toBeGreaterThanOrEqual(clear);
    }
  });
});
