import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type PickupKind } from './config';
import { createItem, useItem } from './items';
import { collectPickups } from './pickups';
import { createMatch } from './state';
import type { MatchState, SimEvent } from './types';

const cfg = DEFAULT_CONFIG;

function playing(): MatchState {
  const s = createMatch(cfg, 2);
  s.phase = 'playing';
  return s;
}

/** Drops a pickup of `kind` on CYAN's head and lets it collect. */
function grab(s: MatchState, kind: PickupKind, id: number): SimEvent[] {
  const cyan = s.snakes[0];
  s.pickups.push({ id, kind, x: cyan.x, y: cyan.y, ttl: 100 });
  const events: SimEvent[] = [];
  collectPickups(s, cfg, events);
  return events;
}

describe('item queue', () => {
  it('holds up to itemSlots items in the order they were grabbed', () => {
    const s = playing();
    grab(s, 'ghost', 1);
    grab(s, 'missile', 2);
    grab(s, 'dozer', 3);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['ghost', 'missile', 'dozer']);
    expect(grab(s, 'ghost', 4)).toEqual([]);
    expect(s.pickups.map((p) => p.id)).toEqual([4]);
  });

  it('uses the oldest item first; missiles stay at the front until all are fired', () => {
    const s = playing();
    s.snakes[0].items = [createItem('missile', cfg), createItem('ghost', cfg)];
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(s.snakes[0].items.map((i) => [i.kind, i.charges])).toEqual([
      ['missile', 2],
      ['ghost', 1],
    ]);
    s.snakes[0].items[0].charges = 1;
    s.snakes[0].useCooldown = 0;
    useItem(s, 0, cfg, events);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['ghost']);
    s.snakes[0].useCooldown = 0; // the throw cooldown also holds the next item briefly
    useItem(s, 0, cfg, events);
    expect(s.snakes[0].items).toEqual([]);
    expect(s.snakes[0].effects.ghost).toBeGreaterThan(0);
  });

  it('turns a Shield pickup into a bubble that never takes a slot', () => {
    const s = playing();
    s.snakes[0].items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg)];
    expect(grab(s, 'shield', 9)).toEqual([{ type: 'pickupCollected', id: 9, kind: 'shield', player: 0 }]);
    expect(s.snakes[0].shield).toBe(true);
    expect(s.snakes[0].items).toHaveLength(3);
  });

  it('leaves a second Shield on the field while you already have a bubble', () => {
    const s = playing();
    s.snakes[0].shield = true;
    expect(grab(s, 'shield', 5)).toEqual([]);
    expect(s.pickups).toHaveLength(1);
  });
});
