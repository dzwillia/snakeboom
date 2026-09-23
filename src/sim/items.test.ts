import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE } from './config';
import { createItem, tickItemTimers, useItem } from './items';
import { createMatch } from './state';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;

function withBombs(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  s.snakes[0].item = createItem('bomb', cfg);
  return s;
}

describe('items', () => {
  it('a bomb pickup holds bombCharges bombs', () => {
    expect(createItem('bomb', cfg)).toEqual({ kind: 'bomb', charges: 3 });
  });

  it('drops a bomb at the head with a full fuse and reports it', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    const { x, y } = s.snakes[0];
    useItem(s, 0, cfg, events);
    const fuse = Math.round(cfg.bombFuse * TICK_RATE);
    expect(s.bombs).toEqual([{ id: 1, owner: 0, x, y, fuse, maxFuse: fuse, chainDepth: 0 }]);
    expect(events).toEqual([{ type: 'bombDropped', id: 1, player: 0, x, y }]);
    expect(s.snakes[0].item).toEqual({ kind: 'bomb', charges: 2 });
  });

  it('waits bombDropCooldown between drops', () => {
    const s = withBombs();
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    useItem(s, 0, cfg, events);
    expect(s.bombs).toHaveLength(1);
    for (let t = 0; t < Math.round(cfg.bombDropCooldown * TICK_RATE); t++) tickItemTimers(s, []);
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
    expect(s.snakes[0].item).toBeNull();
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
    expect(s.snakes.map((sn) => [sn.item, sn.useCooldown, sn.holeVersion])).toEqual([
      [null, 0, 0],
      [null, 0, 0],
    ]);
    expect(s.pickups).toEqual([]);
    expect(s.bombs).toEqual([]);
    expect(s.pickupTimer).toBe(Math.round(cfg.firstPickupDelay * TICK_RATE));
    expect(s.nextId).toBe(1);
  });
});
