import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type PickupKind } from './config';
import { clampSelection, createItem, selectNextItem, useItem } from './items';
import { collectPickups } from './pickups';
import { checkInvariants } from './invariants';
import { createMatch } from './state';
import { step } from './step';
import { createTrail, trailPush } from './trail';
import { NO_INPUT, type MatchState, type SimEvent, type SnakeState } from './types';

const cfg = DEFAULT_CONFIG;

/** Lays `units` of straight body behind the head (length is storage: three slots need 450 units). */
function layBody(s: SnakeState, units: number): void {
  s.trail = createTrail();
  for (let k = 10; k >= 1; k--) trailPush(s.trail, s.x - (units * k) / 10, s.y);
  trailPush(s.trail, s.x, s.y);
}

function playing(): MatchState {
  const s = createMatch(cfg, 2);
  s.phase = 'playing';
  layBody(s.snakes[0], 3 * cfg.slotLength);
  // Keep the body that long through steps: the target is what trailTrim keeps.
  s.snakes[0].targetLength = 3 * cfg.slotLength + 20;
  return s;
}

/** Drops a pickup of `kind` on CYAN's head and lets it collect. */
function grab(s: MatchState, kind: PickupKind, id: number): SimEvent[] {
  const cyan = s.snakes[0];
  s.pickups.push({ id, kind, x: cyan.x, y: cyan.y, ttl: 100, dropped: false });
  const events: SimEvent[] = [];
  collectPickups(s, cfg, events);
  return events;
}

describe('item queue', () => {
  it('holds as many items as the body has slots for, in the order they were grabbed', () => {
    const s = playing();
    grab(s, 'ghost', 1);
    grab(s, 'missile', 2);
    grab(s, 'dozer', 3);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['ghost', 'missile', 'dozer']);
    expect(grab(s, 'ghost', 4)).toEqual([]);
    expect(s.pickups.map((p) => p.id)).toEqual([4]);
  });

  it('fires the front item by default; missiles stay selected until all are fired', () => {
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
    expect(grab(s, 'shield', 9)).toEqual([{ type: 'pickupCollected', id: 9, kind: 'shield', player: 0, x: s.snakes[0].x, y: s.snakes[0].y }]);
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

describe('item selection', () => {
  const kinds = (s: MatchState) => s.snakes[0].items.map((i) => i.kind);
  const carry = (s: MatchState, ...items: PickupKind[]) => {
    s.snakes[0].items = items.map((k) => createItem(k, cfg));
  };

  it('starts on the first item and cycles by one per Select press, wrapping around', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors', 'dozer');
    expect(s.snakes[0].selected).toBe(0);
    selectNextItem(s.snakes[0]);
    expect(s.snakes[0].selected).toBe(1);
    selectNextItem(s.snakes[0]);
    expect(s.snakes[0].selected).toBe(2);
    selectNextItem(s.snakes[0]);
    expect(s.snakes[0].selected).toBe(0);
  });

  it('fires the selected item, not the oldest', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors', 'dozer');
    s.snakes[0].selected = 1;
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(events).toContainEqual({ type: 'itemUsed', player: 0, kind: 'scissors' });
    expect(kinds(s)).toEqual(['ghost', 'dozer']);
    expect(s.snakes[0].effects.scissors).toBeGreaterThan(0);
    expect(s.snakes[0].effects.ghost).toBe(0);
  });

  it('moves the selection to the next item when the selected one is used up, wrapping to the first', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors', 'dozer');
    s.snakes[0].selected = 1;
    useItem(s, 0, cfg, []);
    expect(s.snakes[0].selected).toBe(1); // the Dozer slid into the slot
    expect(kinds(s)[s.snakes[0].selected]).toBe('dozer');
    useItem(s, 0, cfg, []);
    expect(s.snakes[0].selected).toBe(0); // nothing after the Dozer: back to the Ghost
    expect(kinds(s)).toEqual(['ghost']);
    useItem(s, 0, cfg, []);
    expect(s.snakes[0].items).toEqual([]);
    expect(s.snakes[0].selected).toBe(0);
  });

  it('sticks to the item, not the slot: a missile stays selected through its charges', () => {
    const s = playing();
    carry(s, 'ghost', 'missile');
    s.snakes[0].selected = 1;
    for (let shot = cfg.missileCharges; shot > 1; shot--) {
      s.snakes[0].useCooldown = 0;
      useItem(s, 0, cfg, []);
      expect(kinds(s)[s.snakes[0].selected]).toBe('missile');
    }
    s.snakes[0].useCooldown = 0;
    useItem(s, 0, cfg, []);
    expect(kinds(s)).toEqual(['ghost']);
    expect(s.snakes[0].selected).toBe(0);
  });

  it('keeps the selection when a new item is collected', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors');
    s.snakes[0].selected = 1;
    grab(s, 'dozer', 7);
    expect(kinds(s)).toEqual(['ghost', 'scissors', 'dozer']);
    expect(s.snakes[0].selected).toBe(1);
  });

  it('clamps the selection when items vanish for any other reason', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors', 'dozer');
    s.snakes[0].selected = 2;
    s.snakes[0].items.length = 1;
    expect(checkInvariants(s, cfg)).toContain('snake 0: selected item 2 of 1');
    clampSelection(s.snakes[0]);
    expect(s.snakes[0].selected).toBe(0);
    expect(checkInvariants(s, cfg)).toEqual([]);
    s.snakes[0].selected = 2;
    step(s, [NO_INPUT, NO_INPUT], cfg); // a tick fixes it on its own
    expect(s.snakes[0].selected).toBe(0);
    s.snakes[0].items = [];
    s.snakes[0].selected = 1;
    step(s, [NO_INPUT, NO_INPUT], cfg);
    expect(s.snakes[0].selected).toBe(0);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('through step: Select cycles, Fire uses what was selected when the key went down', () => {
    const s = playing();
    carry(s, 'ghost', 'scissors', 'dozer');
    const select = { ...NO_INPUT, select: true };
    step(s, [select, NO_INPUT], cfg);
    expect(s.snakes[0].selected).toBe(1);
    // Both in one tick: Fire hits the item the HUD showed (Scissors), then Select moves on.
    const events = step(s, [{ ...NO_INPUT, use: true, select: true }, NO_INPUT], cfg);
    expect(events).toContainEqual({ type: 'itemUsed', player: 0, kind: 'scissors' });
    expect(kinds(s)).toEqual(['ghost', 'dozer']);
    expect(s.snakes[0].selected).toBe(0);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });
});
