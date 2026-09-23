import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { PI } from './detmath';
import { createItem } from './items';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

// Keep random pickups out of the way unless a test places them.
const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000 };
const idle: PlayerInput[] = [NO_INPUT, NO_INPUT];

function run(s: MatchState, ticks: number, inputs: PlayerInput[] = idle): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) all.push(...step(s, inputs, cfg));
  return all;
}

function toPlaying(): MatchState {
  const s = createMatch(cfg, 5);
  run(s, Math.round(cfg.countdownSeconds * TICK_RATE));
  return s;
}

const armed = (s: MatchState, owner: number, x: number, y: number) =>
  s.bombs.push({ id: 99, owner, x, y, fuse: 1, maxFuse: 1, chainDepth: 0, flight: 0, flightTotal: 0, fromX: x, fromY: y });

describe('step with bombs and pickups', () => {
  it("a bomb kills the opponent: cause 'blast', killer = the bomb's owner", () => {
    const s = toPlaying();
    const pink = s.snakes[1];
    armed(s, 0, pink.x, pink.y);
    const events = run(s, 1);
    expect(events.find((e) => e.type === 'death')).toMatchObject({ player: 1, cause: 'blast', killer: 0 });
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: 0 });
  });

  it('your own bomb can kill you', () => {
    const s = toPlaying();
    const cyan = s.snakes[0];
    armed(s, 0, cyan.x, cyan.y);
    expect(run(s, 1).find((e) => e.type === 'death')).toMatchObject({ player: 0, cause: 'blast', killer: 0 });
  });

  it('pressing Use with a bomb throws it ahead of the opponent', () => {
    const s = toPlaying();
    s.snakes[0].items = [createItem('bomb', cfg)];
    const { x, y } = s.snakes[0];
    const events = run(s, 1, [{ turn: 0, boost: false, use: true }, NO_INPUT]);
    expect(events).toContainEqual(expect.objectContaining({ type: 'bombThrown', player: 0, fromX: x, fromY: y }));
    expect(s.bombs).toHaveLength(1);
    expect(s.bombs[0].x).toBeLessThan(s.snakes[1].x);
    expect(s.snakes[0].items).toEqual([{ kind: 'bomb', charges: 2 }]);
  });

  it('a blast opens a gap you can drive through', () => {
    const s = toPlaying();
    const [cyan, pink] = s.snakes;
    pink.trail = createTrail();
    for (let y = 200; y <= 800; y += 3) trailPush(pink.trail, 800, y);
    Object.assign(pink, { x: 800, y: 800, prevX: 800, prevY: 800, heading: PI / 2, targetLength: 1e9 });
    cyan.trail = createTrail();
    trailPush(cyan.trail, 700, 500);
    Object.assign(cyan, { x: 700, y: 500, prevX: 700, prevY: 500, heading: 0 });
    rebuildGrid(s);
    armed(s, 0, 800, 500);
    const events = run(s, TICK_RATE);
    expect(events.filter((e) => e.type === 'death')).toEqual([]);
    expect(cyan.alive).toBe(true);
    expect(cyan.x).toBeGreaterThan(820);
  });

  it('a blast and a head-on in the same tick both count (draw)', () => {
    const s = toPlaying();
    const [a, b] = s.snakes;
    Object.assign(a, { x: 790, y: 500, heading: 0 });
    Object.assign(b, { x: 806, y: 500, heading: PI });
    // After one tick CYAN is at x≈792.8 and PINK at x≈803.2 (heads 10.3 apart: head-on).
    // A bomb at x=720 reaches CYAN (72.8 < R + r = 77) but not PINK (83.2).
    s.bombs.push({ id: 99, owner: 1, x: 720, y: 500, fuse: 1, maxFuse: 1, chainDepth: 0, flight: 0, flightTotal: 0, fromX: 720, fromY: 500 });
    const events = run(s, 1);
    const deaths = events.flatMap((e) => (e.type === 'death' ? [[e.player, e.cause]] : []));
    expect(deaths).toEqual([
      [0, 'blast'],
      [1, 'headOn'],
    ]);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: null });
  });

  // Review Focus 4: nothing carries into the next round.
  it('clears bombs and pickups when the next round starts', () => {
    const s = toPlaying();
    s.pickups = [{ id: 1, kind: 'bomb', x: 900, y: 600, ttl: 10_000 }];
    s.bombs.push({ id: 2, owner: 1, x: 900, y: 300, fuse: 500, maxFuse: 500, chainDepth: 0, flight: 0, flightTotal: 0, fromX: 900, fromY: 300 });
    s.snakes[0].items = [createItem('bomb', cfg)];
    Object.assign(s.snakes[0], { x: 20, y: 500, heading: PI });
    run(s, 10 + Math.round(cfg.roundOverSeconds * TICK_RATE));
    expect(s.round).toBe(2);
    expect(s.pickups).toEqual([]);
    expect(s.bombs).toEqual([]);
    expect(s.snakes.map((sn) => sn.items)).toEqual([[], []]);
  });

  it('spawns pickups during play', () => {
    const c: Config = { ...DEFAULT_CONFIG };
    const s = createMatch(c, 8);
    const events: SimEvent[] = [];
    for (let i = 0; i < Math.round((c.countdownSeconds + c.firstPickupDelay) * TICK_RATE) + 1; i++) events.push(...step(s, idle, c));
    expect(events.filter((e) => e.type === 'pickupSpawned')).toHaveLength(1);
  });
});
