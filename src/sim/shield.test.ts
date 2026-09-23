import { describe, expect, it } from 'vitest';
import { setTile } from './arena';
import { ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE } from './config';
import { HALF_PI, PI } from './detmath';
import { createItem } from './items';
import { tryShield } from './shield';
import { createMatch, rebuildGrid } from './state';
import { createTrail, trailPush } from './trail';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const r = cfg.snakeRadius;

function shielded(x: number, y: number, heading: number): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  const me = s.snakes[0];
  me.trail = createTrail();
  trailPush(me.trail, x, y);
  Object.assign(me, { x, y, prevX: x, prevY: y, heading, item: createItem('shield', cfg) });
  rebuildGrid(s);
  return s;
}

function verticalBody(s: MatchState, x: number): void {
  const pink = s.snakes[1];
  pink.trail = createTrail();
  for (let y = 300; y <= 700; y += 3) trailPush(pink.trail, x, y);
  Object.assign(pink, { x, y: 699 });
  rebuildGrid(s);
}

describe('shield', () => {
  it('does nothing without a shield', () => {
    const s = shielded(3, 500, PI);
    s.snakes[0].item = null;
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'wall', cfg, events)).toBe(false);
    expect(events).toEqual([]);
    expect(s.snakes[0].x).toBe(3);
  });

  it('turns a wall crash into a slide along the wall, then grace', () => {
    const s = shielded(3, 500, PI - 0.3);
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'wall', cfg, events)).toBe(true);
    const me = s.snakes[0];
    expect(me.x).toBe(r + 0.5);
    expect(me.heading).toBe(HALF_PI);
    expect(me.item).toBeNull();
    expect(me.effects.grace).toBe(Math.round(cfg.shieldGrace * TICK_RATE));
    expect(events).toEqual([{ type: 'shieldBlocked', player: 0, x: r + 0.5, y: 500, cause: 'wall' }]);
  });

  // Review Focus 1: corners and edges never leave the head outside the arena.
  it('backs straight out of a corner', () => {
    const s = shielded(2, 3, (-3 * PI) / 4);
    tryShield(s, 0, 'wall', cfg, []);
    const me = s.snakes[0];
    expect([me.x, me.y]).toEqual([r + 0.5, r + 0.5]);
    expect(me.heading).toBeCloseTo(PI / 4, 12);
  });

  it('pushes clear of a body and slides along it', () => {
    const s = shielded(795, 501, 0.2);
    verticalBody(s, 800);
    tryShield(s, 0, 'body', cfg, []);
    const me = s.snakes[0];
    expect(me.x).toBeCloseTo(800 - 2 * r - 0.5, 9);
    expect(me.y).toBeCloseTo(501, 9);
    expect(me.heading).toBeCloseTo(HALF_PI, 9);
  });

  it('pushes clear of a block and slides along it', () => {
    const s = shielded(797, 510, 0.2);
    setTile(s.tiles, 40, 25, true); // x 800..820, y 500..520
    tryShield(s, 0, 'obstacle', cfg, []);
    const me = s.snakes[0];
    expect(me.x).toBeCloseTo(800 - r - 0.5, 9);
    expect(me.y).toBeCloseTo(510, 9);
    expect(me.heading).toBeCloseTo(HALF_PI, 9);
  });

  it('absorbs a blast without moving', () => {
    const s = shielded(600, 600, 1);
    const events: SimEvent[] = [];
    expect(tryShield(s, 0, 'blast', cfg, events)).toBe(true);
    const me = s.snakes[0];
    expect([me.x, me.y, me.heading]).toEqual([600, 600, 1]);
    expect(events[0]).toMatchObject({ type: 'shieldBlocked', cause: 'blast' });
  });

  it('never pushes the head out of the arena', () => {
    const s = shielded(ARENA_WIDTH - 9, 501, 0);
    verticalBody(s, ARENA_WIDTH - 20);
    tryShield(s, 0, 'body', cfg, []);
    expect(s.snakes[0].x).toBeLessThanOrEqual(ARENA_WIDTH - r - 0.5);
  });
});
