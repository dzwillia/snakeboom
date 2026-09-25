import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { DEFAULT_CONFIG, DT, TICK_RATE, type Config } from './config';
import { checkInvariants } from './invariants';
import { cutBySaws, moveSaws, sawHeads, updateSaws } from './saws';
import { createMatch } from './state';
import { step } from './step';
import { trailLength } from './trail';
import type { MatchState, PlayerInput, SawState, SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, borderCloseSeconds: 0, hearts: 1, wormholeInterval: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
const circle: PlayerInput = { turn: 1, boost: false, use: false };

function playing(seed = 5): MatchState {
  const s = createMatch(cfg, seed);
  s.phase = 'playing';
  s.phaseTicks = 0;
  return s;
}

function saw(s: MatchState, x: number, y: number, vx: number, vy: number, ttl = 600): SawState {
  const w = { id: s.nextId++, x, y, vx, vy, ttl };
  s.saws.push(w);
  return w;
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = [straight, straight]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, cfg));
  return out;
}

describe('saws', () => {
  it('appears every sawInterval, far from every head, one at a time, and goes after sawLifetime', () => {
    const s = playing();
    const events: SimEvent[] = [];
    const interval = Math.round(cfg.sawInterval * TICK_RATE);
    for (let t = 0; t < interval - 1; t++) updateSaws(s, cfg, events);
    expect(s.saws).toEqual([]);
    updateSaws(s, cfg, events);
    expect(s.saws).toHaveLength(1);
    const w = s.saws[0];
    expect(Math.hypot(w.vx, w.vy)).toBeCloseTo(cfg.sawSpeed, 6);
    for (const sn of s.snakes) expect(Math.hypot(sn.x - w.x, sn.y - w.y)).toBeGreaterThanOrEqual(cfg.sawMinHeadDistance);
    expect(events).toEqual([{ type: 'sawSpawned', id: w.id, x: w.x, y: w.y, vx: w.vx, vy: w.vy }]);
    expect(checkInvariants(s, cfg)).toEqual([]);

    s.sawTimer = 1;
    updateSaws(s, cfg, events);
    expect(s.saws).toHaveLength(1);
    let ticks = 1;
    while (s.saws.length > 0) {
      updateSaws(s, cfg, events);
      ticks++;
    }
    expect(ticks).toBe(Math.round(cfg.sawLifetime * TICK_RATE));
    expect(events.at(-1)).toEqual({ type: 'sawGone', id: w.id });
  });

  it('never appears with sawInterval 0', () => {
    const s = playing();
    for (let t = 0; t < 60 * TICK_RATE; t++) updateSaws(s, { ...cfg, sawInterval: 0 }, []);
    expect(s.saws).toEqual([]);
  });

  it('moves at sawSpeed and bounces off the border and off blocks', () => {
    const s = playing();
    const w = saw(s, 3150, 1000, cfg.sawSpeed, 0);
    moveSaws(s, cfg);
    expect(w.x).toBeCloseTo(3150 + cfg.sawSpeed * DT, 6);
    // It reaches the east wall in a few ticks and comes back.
    for (let t = 0; t < 20; t++) moveSaws(s, cfg);
    expect(w.vx).toBe(-cfg.sawSpeed);
    expect(w.x + cfg.sawRadius).toBeLessThanOrEqual(3200);
    // A block ahead flips it the same way; the other axis is untouched.
    const b = saw(s, 1000, 1000, 0, cfg.sawSpeed);
    setTile(s.tiles, 50, 53, true); // x 1000..1020, y 1060..1080
    for (let t = 0; t < 30; t++) moveSaws(s, cfg);
    expect(b.vy).toBe(-cfg.sawSpeed);
    expect(b.x).toBe(1000);
    // The moving border bounces it too, and swallowing it removes it.
    const c = saw(s, 60, 500, -cfg.sawSpeed, 0);
    s.inset = 20;
    for (let t = 0; t < 5; t++) moveSaws(s, cfg);
    expect(c.vx).toBe(cfg.sawSpeed);
    s.inset = 200;
    const events: SimEvent[] = [];
    updateSaws(s, cfg, events);
    expect(s.saws.map((x) => x.id)).not.toContain(c.id);
    expect(events).toContainEqual({ type: 'sawGone', id: c.id });
  });

  it('kills a head it touches, unless a Shield takes it and pushes the head clear', () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    saw(s, 760, 500, 0, 0);
    const events = run(s, 40, [straight, circle]);
    const death = events.find((e) => e.type === 'death');
    expect(death).toMatchObject({ type: 'death', player: 0, cause: 'saw', killer: null });
    expect(me.alive).toBe(false);

    const t = playing();
    const you = t.snakes[0];
    Object.assign(you, { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0, shield: true });
    const w = saw(t, 760, 500, 0, 0);
    const saved = run(t, 40, [straight, circle]);
    expect(saved.find((e) => e.type === 'shieldBlocked')).toMatchObject({ player: 0, cause: 'saw' });
    expect(saved.some((e) => e.type === 'death')).toBe(false);
    expect(you.alive).toBe(true);
    expect(Math.hypot(you.x - w.x, you.y - w.y)).toBeGreaterThan(cfg.sawRadius + cfg.snakeRadius);
    expect(checkInvariants(t, cfg)).toEqual([]);
  });

  it('cuts a body it touches exactly as scissors would, with by -1', () => {
    // PINK lays a long body along y = 500; a saw drifts down through it at x = 600.
    const s = playing();
    const pink = s.snakes[1];
    Object.assign(pink, { x: 300, y: 500, prevX: 300, prevY: 500, heading: 0, targetLength: 5000 });
    Object.assign(s.snakes[0], { x: 1500, y: 1500, prevX: 1500, prevY: 1500, heading: 0 });
    run(s, 130, [circle, straight]);
    const before = trailLength(pink.trail);
    expect(before).toBeGreaterThan(500);
    saw(s, 600, 400, 0, cfg.sawSpeed);
    const events = run(s, 60, [circle, straight]);
    const cut = events.find((e) => e.type === 'cut');
    expect(cut).toMatchObject({ type: 'cut', player: 1, by: -1 });
    expect(pink.alive).toBe(true);
    // Everything behind x = 600 fell off: the tail now starts near the saw, the head kept going.
    const t = pink.trail;
    expect(t.xs[t.start]).toBeGreaterThan(600 - cfg.sawRadius - cfg.snakeRadius - 4);
    expect(cut && cut.type === 'cut' && cut.dropped).toBeGreaterThan(250);
    expect(pink.targetLength).toBeLessThan(before);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('touch checks agree: a head on the rim is hit, a head just outside is not', () => {
    const s = playing();
    const me = s.snakes[0];
    const w = saw(s, 1000, 1000, 0, 0);
    const reach = cfg.sawRadius + cfg.snakeRadius + 2;
    Object.assign(me, { x: w.x + reach - 0.5, y: w.y });
    expect(sawHeads(s, cfg).has(0)).toBe(true);
    Object.assign(me, { x: w.x + reach + 0.5, y: w.y });
    expect(sawHeads(s, cfg).has(0)).toBe(false);
    const events: SimEvent[] = [];
    cutBySaws(s, cfg, events);
    expect(events).toEqual([]);
  });
});
