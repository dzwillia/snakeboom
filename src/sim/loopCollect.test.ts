import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type Config, type PickupKind } from './config';
import { createMatch } from './state';
import { step } from './step';
import type { MatchState, PlayerInput, SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, wormholeInterval: 0, sawInterval: 0, borderCloseSeconds: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false };
const right: PlayerInput = { ...straight, turn: 1 };
const left: PlayerInput = { ...straight, turn: -1 };
/** A full-rate turning circle: radius baseSpeed / turnRate, about 44 at the defaults. */
const R = cfg.baseSpeed / cfg.turnRate;
/** Ticks for a whole circle, and a few more so the head crosses its own trail. */
const CIRCLE = Math.ceil((2 * Math.PI) / (cfg.turnRate / 60)) + 8;

/** CYAN at (1000, 1000) heading east with plenty of body; PINK parked far away, going nowhere. */
function scene(c: Config = cfg): MatchState {
  const s = createMatch(c, 9);
  s.phase = 'playing';
  s.phaseTicks = 0;
  Object.assign(s.snakes[0], { x: 1000, y: 1000, prevX: 1000, prevY: 1000, heading: 0, targetLength: 2000 });
  Object.assign(s.snakes[1], { x: 2800, y: 1800, prevX: 2800, prevY: 1800, heading: Math.PI });
  return s;
}

function drop(s: MatchState, id: number, kind: PickupKind, x: number, y: number): void {
  s.pickups.push({ id, kind, x, y, ttl: 10_000 });
}

function run(s: MatchState, ticks: number, cyan: PlayerInput, c: Config = cfg): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    out.push(...step(s, [cyan, right], c));
    if (s.phase !== 'playing') break;
  }
  return out;
}

const collected = (events: SimEvent[]) => events.filter((e) => e.type === 'pickupCollected');
const loops = (events: SimEvent[]) => events.filter((e) => e.type === 'loopCollected');

// Issue #27: a pickup is taken by drawing a loop around it, not by running over it.
describe('collecting by loop', () => {
  it('takes a pickup inside the loop on the tick it closes, and leaves one outside', () => {
    const s = scene();
    // Turning right from (1000, 1000) heading east circles the point R below the head.
    drop(s, 1, 'missile', 1000, 1000 + R);
    drop(s, 2, 'ghost', 1000, 1000 + 4 * R);
    const events = run(s, CIRCLE, right);
    expect(loops(events)).toEqual([{ type: 'loopCollected', player: 0, loop: expect.any(Array), ids: [1] }]);
    expect((loops(events)[0] as { loop: number[] }).loop.length).toBeGreaterThanOrEqual(8);
    expect(collected(events)).toEqual([{ type: 'pickupCollected', id: 1, kind: 'missile', player: 0, x: 1000, y: 1000 + R }]);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['missile']);
    expect(s.pickups.map((p) => p.id)).toEqual([2]);
    expect(s.snakes[0].crossing).toBe(true);
    // The loop closed once; circling on doesn't take the one outside.
    expect(collected(run(s, CIRCLE, right))).toEqual([]);
  });

  it('takes several in id order, as far as the free slots go; a Shield needs no slot', () => {
    const s = scene();
    const cx = 1000;
    const cy = 1000 + R;
    // Scrambled on the field: ids decide the order.
    drop(s, 9, 'missile', cx + 10, cy);
    drop(s, 5, 'ghost', cx - 10, cy);
    drop(s, 7, 'dozer', cx, cy + 10);
    drop(s, 6, 'scissors', cx, cy - 10);
    drop(s, 8, 'shield', cx + 5, cy + 5);
    drop(s, 10, 'shield', cx - 5, cy - 5);
    const events = run(s, CIRCLE, right);
    expect(loops(events)).toHaveLength(1);
    expect((loops(events)[0] as { ids: number[] }).ids).toEqual([5, 6, 7, 8]);
    expect(collected(events).map((e) => (e as { id: number }).id)).toEqual([5, 6, 7, 8]);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['ghost', 'scissors', 'dozer']);
    expect(s.snakes[0].shield).toBe(true);
    // No room for the missile, and a second Shield while the bubble is up: both stay.
    expect(s.pickups.map((p) => p.id).sort()).toEqual([10, 9]);
  });

  it('does nothing when a head runs over a pickup', () => {
    const s = scene();
    drop(s, 1, 'missile', 1100, 1000);
    const events = run(s, 60, straight);
    expect(collected(events)).toEqual([]);
    expect(s.snakes[0].x).toBeGreaterThan(1150);
    expect(s.pickups).toHaveLength(1);
    expect(s.snakes[0].items).toEqual([]);
  });

  it('collectByLoop off restores the run-over rule and turns the loop rule off', () => {
    const c: Config = { ...cfg, collectByLoop: false };
    const over = scene(c);
    drop(over, 1, 'missile', 1100, 1000);
    expect(collected(run(over, 60, straight, c))).toEqual([{ type: 'pickupCollected', id: 1, kind: 'missile', player: 0, x: 1100, y: 1000 }]);
    expect(over.pickups).toEqual([]);
    const around = scene(c);
    drop(around, 1, 'missile', 1000, 1000 + R);
    const events = run(around, CIRCLE, right, c);
    expect(collected(events)).toEqual([]);
    expect(loops(events)).toEqual([]);
    expect(around.pickups).toHaveLength(1);
  });

  it('takes nothing with a loop that spans a wormhole jump', () => {
    const s = scene();
    // East into a portal whose exit sits 2R below the start, then a left turn back up to the
    // pre-jump trail: the "loop" would need a chord across the jump, so it doesn't count.
    s.wormholes.push({ id: 99, x: 1200, y: 1000, exitX: 1000, exitY: 1000 + 2 * R, ttl: 10_000 });
    drop(s, 1, 'missile', 1070, 1030);
    const events = run(s, 40, straight);
    expect(events.some((e) => e.type === 'warped')).toBe(true);
    // Half a circle up brings the head onto the pre-jump trail (it is touching it by now).
    events.push(...run(s, 30, left));
    expect(s.snakes[0].crossing).toBe(true);
    expect(collected(events)).toEqual([]);
    expect(loops(events)).toEqual([]);
    expect(s.pickups).toHaveLength(1);
    expect(s.snakes[0].alive).toBe(true);
  });
});
