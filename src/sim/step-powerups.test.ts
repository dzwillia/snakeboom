import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { HALF_PI, PI } from './detmath';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

// One heart: these tests exercise the one-hit death rules (hearts have their own tests).
const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1 };
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
    cyan.shield = true;
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    const first = run(s, 3);
    expect(first).toContainEqual(expect.objectContaining({ type: 'shieldBlocked', player: 0, cause: 'wall' }));
    expect(deaths(first)).toEqual([]);
    expect(cyan.alive).toBe(true);
    expect(cyan.shield).toBe(false);
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    expect(deaths(run(s, 3))).toEqual([[0, 'wall']]);
  });

  it('grace shrugs off a missile right after a Shield save', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    cyan.shield = true;
    Object.assign(cyan, { x: 12, y: 500, heading: PI });
    run(s, 3);
    s.missiles.push({ id: 99, owner: 1, x: cyan.x, y: cyan.y, heading: 0, ttl: 100 });
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
    a.shield = true;
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
    a.shield = true;
    b.shield = true;
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 806, y: 500, heading: PI });
    const events = run(s, 1);
    expect(deaths(events)).toEqual([]);
    expect(events.filter((e) => e.type === 'shieldBlocked')).toHaveLength(2);
  });
});
