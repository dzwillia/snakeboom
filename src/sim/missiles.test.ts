import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, TILE_COLS, TILE_SIZE, type Config } from './config';
import { hashState } from './hash';
import { createItem, useItem } from './items';
import { updateMissiles } from './missiles';
import { createMatch } from './state';
import { step } from './step';
import type { MatchState, PlayerInput, SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
const fire: PlayerInput = { ...straight, use: true };

/** CYAN at (300, 530) facing east with a missile; PINK `gap` ahead at y = 500, also facing east (off CYAN's line). */
function armed(gap = 150): MatchState {
  const s = createMatch(cfg, 5);
  s.phase = 'playing';
  s.phaseTicks = 0;
  Object.assign(s.snakes[0], { x: 300, y: 530, heading: 0 });
  Object.assign(s.snakes[1], { x: 300 + gap, y: 500, heading: 0 });
  s.snakes[0].items = [createItem('missile', cfg)];
  return s;
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[] | ((t: number) => PlayerInput[])): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, typeof inputs === 'function' ? inputs(t) : inputs, cfg));
  return out;
}

const missileDist = (s: MatchState) => (s.missiles[0] ? Math.hypot(s.missiles[0].x - s.snakes[1].x, s.missiles[0].y - s.snakes[1].y) : Infinity);

// M10 Review Focus 4: missiles are deterministic and dodgeable.
describe('missiles', () => {
  it('a missile pickup holds missileCharges shots', () => {
    expect(createItem('missile', cfg)).toEqual({ kind: 'missile', charges: cfg.missileCharges });
  });

  it('fires from the head along the heading and reports it', () => {
    const s = armed();
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(s.missiles).toHaveLength(1);
    expect(s.missiles[0]).toMatchObject({ owner: 0, x: 300, y: 530, heading: 0, ttl: Math.round(cfg.missileLife * TICK_RATE) });
    expect(events).toEqual([{ type: 'missileFired', id: 1, player: 0, x: 300, y: 530, heading: 0 }]);
    expect(s.snakes[0].items).toEqual([{ kind: 'missile', charges: cfg.missileCharges - 1 }]);
    expect(s.snakes[0].useCooldown).toBe(Math.round(cfg.missileCooldown * TICK_RATE));
  });

  it('chases a straight-flying head and kills it within 1.5 s', () => {
    const s = armed(150);
    run(s, 1, [fire, straight]);
    const events = run(s, Math.round(1.5 * TICK_RATE), [straight, straight]);
    expect(events.find((e) => e.type === 'missileHit')).toMatchObject({ player: 1 });
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'missile', killer: 0 });
    expect(s.missiles).toEqual([]);
  });

  it('is dodged by a hard cut at the right moment, and fizzles when its life runs out', () => {
    const s = armed(200);
    run(s, 1, [fire, straight]);
    // Cut away from the shooter's line (PINK sits above it), so the dodge doesn't end in a body hit.
    const cut: PlayerInput = { ...straight, turn: -1 };
    const cutWhenClose = (): PlayerInput[] => [straight, missileDist(s) < 90 ? cut : straight];
    const events = run(s, Math.round(cfg.missileLife * TICK_RATE) + 2, cutWhenClose);
    expect(events.some((e) => e.type === 'missileHit')).toBe(false);
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(events.filter((e) => e.type === 'missileFizzled')).toHaveLength(1);
    expect(s.missiles).toEqual([]);
  });

  it('is outrun by a boosting target', () => {
    const s = armed(200);
    // Start well west so the boosting target has room before the wall.
    s.snakes[0].x = 100;
    s.snakes[1].x = 300;
    run(s, 1, [fire, straight]);
    const events = run(s, Math.round(cfg.missileLife * TICK_RATE) + 2, [straight, { ...straight, boost: true }]);
    expect(events.some((e) => e.type === 'missileHit')).toBe(false);
    expect(events.filter((e) => e.type === 'missileFizzled')).toHaveLength(1);
  });

  it('is absorbed by a Shield, and the head keeps its course', () => {
    const s = armed(150);
    s.snakes[1].shield = true;
    run(s, 1, [fire, straight]);
    const events = run(s, Math.round(1.5 * TICK_RATE), [straight, straight]);
    expect(events.find((e) => e.type === 'shieldBlocked')).toMatchObject({ player: 1, cause: 'missile' });
    expect(events.some((e) => e.type === 'death')).toBe(false);
    expect(s.snakes[1].alive).toBe(true);
    expect(s.snakes[1].heading).toBe(0);
  });

  it('never hits its owner, even when spawned on the owner’s head', () => {
    const s = armed();
    const me = s.snakes[0];
    s.missiles.push({ id: 7, owner: 0, x: me.x, y: me.y, heading: Math.PI, ttl: 100 });
    const events: SimEvent[] = [];
    const hits = updateMissiles(s, cfg, events);
    expect(hits.size).toBe(0);
    expect(events).toEqual([]);
    expect(s.missiles).toHaveLength(1);
  });

  it('dies on the live border and on a block', () => {
    const s = armed();
    s.snakes[1].alive = false;
    s.missiles.push({ id: 7, owner: 0, x: 12, y: 500, heading: Math.PI, ttl: 100 });
    const events: SimEvent[] = [];
    updateMissiles(s, cfg, events);
    expect(events).toEqual([{ type: 'missileFizzled', id: 7, x: expect.any(Number), y: 500 }]);
    expect(s.missiles).toEqual([]);

    s.tiles[Math.floor(500 / TILE_SIZE) * TILE_COLS + Math.floor(400 / TILE_SIZE)] = 1;
    s.missiles.push({ id: 8, owner: 0, x: 380, y: 510, heading: 0, ttl: 100 });
    const more: SimEvent[] = [];
    for (let t = 0; t < 10 && s.missiles.length; t++) updateMissiles(s, cfg, more);
    expect(more.find((e) => e.type === 'missileFizzled')).toMatchObject({ id: 8 });
    expect(s.missiles).toEqual([]);
  });

  it('flies the same path for the same inputs', () => {
    const a = armed();
    const b = armed();
    run(a, 1, [fire, straight]);
    run(b, 1, [fire, straight]);
    const turn: PlayerInput = { ...straight, turn: -1 };
    run(a, 40, [straight, turn]);
    run(b, 40, [straight, turn]);
    expect(hashState(a)).toBe(hashState(b));
    expect(a.missiles[0]).toEqual(b.missiles[0]);
  });

  it('starts every round with no missiles in the air', () => {
    const s = armed();
    run(s, 1, [fire, straight]);
    expect(s.missiles).toHaveLength(1);
    s.snakes[1].alive = false;
    run(s, 1 + Math.round(cfg.roundOverSeconds * TICK_RATE), [straight, straight]);
    expect(s.round).toBe(2);
    expect(s.missiles).toEqual([]);
  });
});
