import { describe, expect, it } from 'vitest';
import { circleHitsTiles, circleHitsWall, setTile } from './arena';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { checkInvariants } from './invariants';
import { createItem } from './items';
import { createSnake } from './snake';
import { createMatch, rebuildGrid } from './state';
import { step } from './step';
import { dropIndex, slotsFor } from './storage';
import { createTrail, trailLength, trailPush } from './trail';
import { NO_INPUT, type MatchState, type PickupState, type PlayerInput, type SimEvent, type SnakeState } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000, hearts: 1, borderCloseSeconds: 0, sawInterval: 0, wormholeInterval: 0 };
const straight: PlayerInput = { turn: 0, boost: false, use: false, select: false };
const boosting: PlayerInput = { turn: 0, boost: true, use: false, select: false };

/** A snake with exactly `units` of straight body behind its head. */
function withBody(units: number, c: Config = cfg): SnakeState {
  const s = createSnake(0, 1000, 800, 0, c);
  s.trail = createTrail();
  if (units > 0) trailPush(s.trail, 1000 - units, 800);
  trailPush(s.trail, 1000, 800);
  s.targetLength = units;
  return s;
}

/** PINK has laid a long horizontal body along y = 500 from x = 300 to about 900 and is heading away east; CYAN comes down from above to cross it at x = 600. */
function crossing(c: Config = cfg): MatchState {
  const s = createMatch(c, 3);
  s.phase = 'playing';
  s.phaseTicks = 0;
  const pink = s.snakes[1];
  moveTo(pink, 300, 500, 0);
  rebuildGrid(s);
  pink.targetLength = 5000;
  for (let t = 0; t < 130; t++) step(s, [NO_INPUT, straight], c);
  Object.assign(s.snakes[0], { x: 600, y: 440, prevX: 600, prevY: 440, heading: Math.PI / 2 });
  s.snakes[0].effects.scissors = 10_000;
  return s;
}

/** Teleports a snake and starts its trail afresh there (no chord back to the spawn). */
function moveTo(s: SnakeState, x: number, y: number, heading: number): void {
  Object.assign(s, { x, y, prevX: x, prevY: y, heading });
  s.trail = createTrail();
  trailPush(s.trail, x, y);
}

function run(s: MatchState, ticks: number, inputs: PlayerInput[], c: Config = cfg): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) out.push(...step(s, inputs, c));
  return out;
}

const drops = (events: SimEvent[]) => events.filter((e) => e.type === 'pickupSpawned' && e.dropped) as Array<{ id: number; kind: string; x: number; y: number }>;

describe('slotsFor', () => {
  it('gives one slot per slotLength of body, never fewer than one', () => {
    expect(slotsFor(withBody(0), cfg)).toBe(1);
    expect(slotsFor(withBody(cfg.slotLength - 1), cfg)).toBe(1);
    expect(slotsFor(withBody(cfg.slotLength), cfg)).toBe(1);
    expect(slotsFor(withBody(2 * cfg.slotLength), cfg)).toBe(2);
    expect(slotsFor(withBody(3 * cfg.slotLength + 40), cfg)).toBe(3);
  });

  it('caps at itemSlots however long the body is', () => {
    expect(slotsFor(withBody(6 * cfg.slotLength), cfg)).toBe(6);
    expect(slotsFor(withBody(100 * cfg.slotLength), cfg)).toBe(cfg.itemSlots);
    expect(slotsFor(withBody(100 * cfg.slotLength), { ...cfg, itemSlots: 4 })).toBe(4);
  });

  it('counts the body as laid, not the target length', () => {
    const s = withBody(2 * cfg.slotLength);
    s.targetLength = 5000;
    expect(slotsFor(s, cfg)).toBe(2);
  });
});

describe('a cut drops the weapons that no longer fit', () => {
  it('drops exactly the overflow, furthest from the selected item first, as pickups along the dropped segment', () => {
    const s = crossing();
    const pink = s.snakes[1];
    // About 600 units laid: four slots, all full; the Dozer is selected.
    expect(slotsFor(pink, cfg)).toBe(4);
    pink.items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg), createItem('flame', cfg)];
    pink.selected = 2;
    const events = run(s, 30, [straight, straight]);
    const cut = events.find((e) => e.type === 'cut') as { x: number; segment: number[] } | undefined;
    expect(cut).toBeDefined();
    // Roughly 300 units are left: two slots. The Missile (two away) goes first, then the Ghost; the
    // selected Dozer and its neighbour stay, and the selection follows the Dozer to index 0.
    expect(slotsFor(pink, cfg)).toBe(2);
    expect(pink.items.map((i) => i.kind)).toEqual(['dozer', 'flame']);
    expect(pink.selected).toBe(0);
    const dropped = drops(events);
    expect(dropped.map((d) => d.kind)).toEqual(['missile', 'ghost']);
    // On the segment that fell off (y = 500, between the old tail and the cut), and not on top of each other.
    for (const d of dropped) {
      expect(d.y).toBeCloseTo(500, 3);
      expect(d.x).toBeGreaterThan(300);
      expect(d.x).toBeLessThan(cut!.x + 2 * cfg.snakeRadius);
    }
    expect(Math.abs(dropped[0].x - dropped[1].x)).toBeGreaterThan(2 * cfg.pickupRadius);
    // They are real pickups with the usual lifetime, flagged as drops, and the events match the state.
    const onField = s.pickups.filter((p) => p.dropped);
    expect(onField.map((p) => [p.id, p.kind, p.x, p.y])).toEqual(dropped.map((d) => [d.id, d.kind, d.x, d.y]));
    for (const p of onField) expect(p.ttl).toBeGreaterThan(cfg.pickupLifetime * TICK_RATE - 40);
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('picks what to lose by distance from the selection, older first on a tie', () => {
    const s = crossing();
    const pink = s.snakes[1];
    pink.items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg), createItem('flame', cfg)];
    pink.selected = 0;
    expect(dropIndex(pink)).toBe(3);
    pink.selected = 3;
    expect(dropIndex(pink)).toBe(0);
    pink.selected = 1;
    expect(dropIndex(pink)).toBe(3); // two away beats one away
    pink.selected = 2;
    expect(dropIndex(pink)).toBe(0); // missile and flame are both two away; the older one goes
    pink.items = [createItem('missile', cfg)];
    pink.selected = 0;
    expect(dropIndex(pink)).toBe(0); // the selected item itself is all there is
  });

  it('drops nothing when everything still fits', () => {
    const s = crossing();
    s.snakes[1].items = [createItem('missile', cfg), createItem('ghost', cfg)];
    const events = run(s, 30, [straight, straight]);
    expect(events.some((e) => e.type === 'cut')).toBe(true);
    expect(drops(events)).toEqual([]);
    expect(s.snakes[1].items).toHaveLength(2);
  });

  it('keeps the drops inside the live area and out of blocks', () => {
    const s = crossing();
    const pink = s.snakes[1];
    pink.items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg), createItem('flame', cfg)];
    // The border has eaten the west end of the segment, and a block sits on it around x = 500.
    s.inset = 400;
    for (let tx = 24; tx <= 26; tx++) for (let ty = 24; ty <= 26; ty++) setTile(s.tiles, tx, ty, true);
    const events = run(s, 30, [straight, straight]);
    const dropped = drops(events);
    expect(dropped).toHaveLength(2);
    for (const d of dropped) {
      expect(circleHitsWall(d.x, d.y, cfg.pickupRadius, s.inset)).toBe(false);
      expect(circleHitsTiles(s.tiles, d.x, d.y, cfg.pickupRadius)).toBe(false);
    }
    expect(checkInvariants(s, cfg)).toEqual([]);
  });

  it('loses the item when nowhere on the segment can hold a pickup', () => {
    const s = crossing();
    const pink = s.snakes[1];
    pink.items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg), createItem('flame', cfg)];
    // Blocks under the whole west half of the body; CYAN is a Ghost so it can reach the body through them.
    for (let tx = 14; tx <= 31; tx++) for (let ty = 23; ty <= 27; ty++) setTile(s.tiles, tx, ty, true);
    s.snakes[0].effects.ghost = 10_000;
    const events = run(s, 30, [straight, straight]);
    expect(events.some((e) => e.type === 'cut')).toBe(true);
    expect(pink.items).toHaveLength(2);
    expect(drops(events)).toEqual([]);
    expect(s.pickups.filter((p) => p.dropped)).toEqual([]);
  });

  it('may take the field past maxPickups, and the cutter can pick a drop up', () => {
    const c: Config = { ...cfg, maxPickups: 1 };
    const s = crossing(c);
    const pink = s.snakes[1];
    const filler: PickupState = { id: 900, kind: 'shield', x: 2000, y: 1500, ttl: 1000, dropped: false };
    s.pickups.push(filler);
    pink.items = [createItem('missile', c), createItem('ghost', c), createItem('dozer', c), createItem('flame', c)];
    const events = run(s, 30, [straight, straight], c);
    const dropped = drops(events);
    expect(dropped).toHaveLength(2);
    expect(s.pickups.length).toBe(3);
    expect(checkInvariants(s, c)).toEqual([]);
    // CYAN (the cutter, empty-handed) turns up on one of them.
    const cyan = s.snakes[0];
    Object.assign(cyan, { x: dropped[0].x, y: dropped[0].y - 20, prevX: dropped[0].x, prevY: dropped[0].y - 20, heading: Math.PI / 2 });
    const later = run(s, 3, [straight, straight], c);
    expect(later.find((e) => e.type === 'pickupCollected')).toMatchObject({ id: dropped[0].id, kind: dropped[0].kind, player: 0 });
    expect(cyan.items.map((i) => i.kind)).toEqual([dropped[0].kind]);
  });
});

describe('boost sheds storage', () => {
  it('drops the item furthest from the selection at the tail when the burn crosses a slot boundary', () => {
    const c: Config = { ...cfg, growthPerSecond: 0 };
    const s = createMatch(c, 5);
    s.phase = 'playing';
    s.phaseTicks = 0;
    const pink = s.snakes[1];
    // 606 units laid straight along y = 500: four slots.
    moveTo(pink, 300, 500, 0);
    rebuildGrid(s);
    pink.targetLength = 5000;
    for (let t = 0; t < 130; t++) step(s, [NO_INPUT, straight], c);
    pink.targetLength = trailLength(pink.trail);
    Object.assign(s.snakes[0], { x: 1600, y: 1500, prevX: 1600, prevY: 1500, heading: 0 });
    pink.items = [createItem('missile', c), createItem('ghost', c), createItem('dozer', c), createItem('flame', c)];
    pink.selected = 3; // the Flame is what PINK means to fire, so the Missile end of the queue goes first
    expect(slotsFor(pink, c)).toBe(4);
    const events = run(s, 20, [straight, boosting], c);
    const dropped = drops(events);
    expect(dropped.map((d) => d.kind)).toEqual(['missile']);
    expect(pink.items.map((i) => i.kind)).toEqual(['ghost', 'dozer', 'flame']);
    expect(pink.selected).toBe(2);
    expect(slotsFor(pink, c)).toBe(3);
    // At the tail: the boost had pulled it a few dozen units east of the old end by then, and it has moved on since.
    expect(dropped[0].y).toBeCloseTo(500, 3);
    expect(dropped[0].x).toBeGreaterThan(300);
    expect(dropped[0].x).toBeLessThan(400);
    expect(dropped[0].x).toBeLessThan(pink.trail.xs[pink.trail.start]);
    expect(checkInvariants(s, c)).toEqual([]);
    // Keep burning and the next one goes at the next boundary.
    const more = run(s, 160, [straight, boosting], c);
    expect(drops(more).map((d) => d.kind)).toEqual(['ghost']);
    expect(pink.items.map((i) => i.kind)).toEqual(['dozer', 'flame']);
    expect(checkInvariants(s, c)).toEqual([]);
  });

  it('never sheds without boost: growth only adds storage', () => {
    const s = crossing();
    const pink = s.snakes[1];
    pink.items = [createItem('missile', cfg), createItem('ghost', cfg), createItem('dozer', cfg), createItem('flame', cfg)];
    s.snakes[0].effects.scissors = 0;
    Object.assign(s.snakes[0], { x: 1600, y: 1500, prevX: 1600, prevY: 1500, heading: 0 });
    const events = run(s, 120, [straight, straight]);
    expect(drops(events)).toEqual([]);
    expect(pink.items).toHaveLength(4);
    expect(slotsFor(pink, cfg)).toBeGreaterThanOrEqual(4);
  });
});
