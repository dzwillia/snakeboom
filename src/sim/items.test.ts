import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { PI } from './detmath';
import { createItem, tickItemTimers, useItem } from './items';
import { createMatch } from './state';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;
const FLIGHT = Math.round(cfg.bombFlightTime * TICK_RATE);
const FUSE = Math.round(cfg.bombFuse * TICK_RATE);

function withBombs(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  s.snakes[0].items = [createItem('bomb', cfg)];
  return s;
}

describe('items', () => {
  it('a bomb pickup holds bombCharges bombs', () => {
    expect(createItem('bomb', cfg)).toEqual({ kind: 'bomb', charges: 3 });
  });

  it('throws a bomb to where the opponent will be when it goes off, and reports it', () => {
    const s = withBombs();
    const [cyan, pink] = s.snakes;
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    const lead = cfg.baseSpeed * (cfg.bombFlightTime + cfg.bombFuse) * cfg.bombLeadFactor;
    const bomb = s.bombs[0];
    expect(bomb).toMatchObject({
      id: 1,
      owner: 0,
      fromX: cyan.x,
      fromY: cyan.y,
      flight: FLIGHT,
      flightTotal: FLIGHT,
      fuse: FUSE,
      maxFuse: FUSE,
      chainDepth: 0,
    });
    expect(bomb.x).toBeCloseTo(pink.x - lead, 6); // PINK is heading west
    expect(bomb.y).toBeCloseTo(pink.y, 6);
    expect(events).toEqual([{ type: 'bombThrown', id: 1, player: 0, fromX: cyan.x, fromY: cyan.y, x: bomb.x, y: bomb.y }]);
    expect(s.snakes[0].items).toEqual([{ kind: 'bomb', charges: 2 }]);
  });

  it('keeps the landing spot inside the arena', () => {
    const s = withBombs();
    Object.assign(s.snakes[1], { x: 60, y: 500, heading: PI });
    useItem(s, 0, cfg, []);
    expect(s.bombs[0].x).toBe(cfg.snakeRadius);
    expect(s.bombs[0].y).toBeCloseTo(500, 6);
  });

  it('waits bombThrowCooldown between throws', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(1);
    for (let t = 0; t < Math.round(cfg.bombThrowCooldown * TICK_RATE); t++) tickItemTimers(s, []);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(2);
  });

  it('empties the slot after the last bomb', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    for (let k = 0; k < 3; k++) {
      useItem(s, 0, cfg, events);
      s.snakes[0].useCooldown = 0;
    }
    expect(s.bombs).toHaveLength(3);
    expect(s.snakes[0].items).toEqual([]);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(3);
  });

  it('does nothing without an item', () => {
    const s = createMatch(cfg, 1);
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(s.bombs).toEqual([]);
    expect(events).toEqual([]);
  });

  it('starts every round with empty slots, no bombs and the first pickup scheduled', () => {
    const s = createMatch(cfg, 1);
    expect(s.snakes.map((sn) => [sn.items, sn.shield, sn.useCooldown, sn.holeVersion])).toEqual([
      [[], false, 0, 0],
      [[], false, 0, 0],
    ]);
    expect(s.pickups).toEqual([]);
    expect(s.bombs).toEqual([]);
    expect(s.pickupTimer).toBe(Math.round(cfg.firstPickupDelay * TICK_RATE));
    expect(s.nextId).toBe(1);
  });
});
