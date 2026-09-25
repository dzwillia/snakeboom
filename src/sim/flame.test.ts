import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { applyFlames, inCone } from './flame';
import { checkInvariants } from './invariants';
import { createItem, useItem } from './items';
import { createMatch } from './state';
import { step } from './step';
import { trailLength } from './trail';
import type { MatchState, PlayerInput, SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, borderCloseSeconds: 0, hearts: 1, wormholeInterval: 0, sawInterval: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
const circle: PlayerInput = { turn: 1, boost: false, use: false };

function playing(seed = 7): MatchState {
  const s = createMatch(cfg, seed);
  s.phase = 'playing';
  s.phaseTicks = 0;
  return s;
}

function light(s: MatchState, player: number): SimEvent[] {
  const events: SimEvent[] = [];
  s.snakes[player].items = [createItem('flame', cfg)];
  useItem(s, player, cfg, events);
  return events;
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = [straight, straight]): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, cfg));
  return out;
}

describe('flamethrower', () => {
  it('is a timed special that announces starting and ending', () => {
    const s = playing();
    const events = light(s, 0);
    expect(events).toEqual([
      { type: 'itemUsed', player: 0, kind: 'flame' },
      { type: 'effectStarted', player: 0, effect: 'flame' },
    ]);
    expect(s.snakes[0].effects.flame).toBe(Math.round(cfg.flameDuration * TICK_RATE));
    const later = run(s, Math.round(cfg.flameDuration * TICK_RATE), [circle, circle]);
    expect(later).toContainEqual({ type: 'effectEnded', player: 0, effect: 'flame' });
    expect(s.snakes[0].effects.flame).toBe(0);
  });

  it('the cone is flameRange long and flameSpread each side of the heading', () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 1000, y: 1000, heading: 0 });
    expect(inCone(me, cfg, 1000 + cfg.flameRange - 1, 1000)).toBe(true);
    expect(inCone(me, cfg, 1000 + cfg.flameRange + 1, 1000)).toBe(false);
    const edge = cfg.flameSpread - 0.02;
    expect(inCone(me, cfg, 1000 + Math.cos(edge) * 100, 1000 + Math.sin(edge) * 100)).toBe(true);
    const past = cfg.flameSpread + 0.02;
    expect(inCone(me, cfg, 1000 + Math.cos(past) * 100, 1000 - Math.sin(past) * 100)).toBe(false);
    expect(inCone(me, cfg, 950, 1000)).toBe(false); // behind
  });

  it('cuts an opponent body in the cone like scissors, from a distance', () => {
    // PINK lays a body along y = 500 from x = 300 east; CYAN sits below it at (600, 590) facing north, 90 away.
    const s = playing();
    const pink = s.snakes[1];
    Object.assign(pink, { x: 300, y: 500, prevX: 300, prevY: 500, heading: 0, targetLength: 5000 });
    Object.assign(s.snakes[0], { x: 1500, y: 1500, prevX: 1500, prevY: 1500, heading: 0 });
    run(s, 130, [circle, straight]);
    const before = trailLength(pink.trail);
    Object.assign(s.snakes[0], { x: 600, y: 590, prevX: 600, prevY: 590, heading: -Math.PI / 2 });
    light(s, 0);
    const events = run(s, 2, [straight, straight]);
    const cut = events.find((e) => e.type === 'cut');
    expect(cut).toMatchObject({ type: 'cut', player: 1, by: 0 });
    expect(cut && cut.type === 'cut' && cut.dropped).toBeGreaterThan(250);
    expect(pink.targetLength).toBeLessThan(before);
    expect(s.snakes[0].alive).toBe(true);
    expect(pink.alive).toBe(true);
    // The cut lands at the newest burning point: what's left starts within the cone's reach of the head.
    const t = pink.trail;
    expect(Math.hypot(t.xs[t.start] - 600, t.ys[t.start] - 590)).toBeLessThan(cfg.flameRange + 2 * cfg.snakeRadius + 10);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('torches an opponent head in the cone, and a Shield takes it without moving the head', () => {
    const s = playing();
    Object.assign(s.snakes[0], { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    Object.assign(s.snakes[1], { x: 700, y: 520, prevX: 700, prevY: 520, heading: Math.PI / 2 });
    light(s, 0);
    const events = run(s, 1, [straight, straight]);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'flame', killer: 0 });

    const t = playing();
    Object.assign(t.snakes[0], { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    Object.assign(t.snakes[1], { x: 700, y: 520, prevX: 700, prevY: 520, heading: Math.PI / 2, shield: true });
    light(t, 0);
    const saved = run(t, 1, [straight, straight]);
    expect(saved.find((e) => e.type === 'shieldBlocked')).toMatchObject({ player: 1, cause: 'flame' });
    expect(t.snakes[1].alive).toBe(true);
    expect(t.snakes[1].heading).toBeCloseTo(Math.PI / 2, 6);
  });

  it("burns up the opponent's missiles in the cone but not its own", () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 600, y: 500, heading: 0 });
    s.missiles.push({ id: 41, owner: 1, x: 700, y: 500, heading: Math.PI, ttl: 100 });
    s.missiles.push({ id: 42, owner: 0, x: 650, y: 500, heading: 0, ttl: 100 });
    s.missiles.push({ id: 43, owner: 1, x: 500, y: 500, heading: 0, ttl: 100 });
    me.effects.flame = 10;
    const events: SimEvent[] = [];
    applyFlames(s, cfg, events);
    expect(events).toEqual([{ type: 'missileFizzled', id: 41, x: 700, y: 500 }]);
    expect(s.missiles.map((m) => m.id)).toEqual([42, 43]);
  });

  it("never touches the flamer's own body, and grace ignores it", () => {
    const s = playing();
    const me = s.snakes[0];
    Object.assign(me, { x: 300, y: 500, prevX: 300, prevY: 500, heading: 0, targetLength: 5000 });
    Object.assign(s.snakes[1], { x: 1500, y: 1500, prevX: 1500, prevY: 1500, heading: 0 });
    run(s, 60, [straight, circle]);
    // Turn round so the head faces its own body, then light up.
    Object.assign(me, { heading: Math.PI });
    const before = trailLength(me.trail);
    light(s, 0);
    const events = run(s, 3, [straight, circle]);
    expect(events.some((e) => e.type === 'cut')).toBe(false);
    expect(trailLength(me.trail)).toBeGreaterThanOrEqual(before - 1);

    const t = playing();
    Object.assign(t.snakes[0], { x: 600, y: 500, prevX: 600, prevY: 500, heading: 0 });
    Object.assign(t.snakes[1], { x: 700, y: 520, prevX: 700, prevY: 520, heading: Math.PI / 2 });
    t.snakes[1].effects.grace = 30;
    light(t, 0);
    const graced = run(t, 1, [straight, straight]);
    expect(graced.some((e) => e.type === 'death')).toBe(false);
  });
});
