import { describe, expect, it } from 'vitest';
import { EventGate, isFlowEvent } from './events';
import type { TaggedEvent } from './session';

const roundOver = (tick: number, confirmed: boolean): TaggedEvent => ({
  tick,
  confirmed,
  event: { type: 'roundOver', winner: 0, places: [1, 2], deaths: [] },
});
const explosion = (tick: number, id: number, confirmed: boolean): TaggedEvent => ({
  tick,
  confirmed,
  event: { type: 'missileHit', id, player: 1, x: 1, y: 2 },
});

describe('EventGate', () => {
  it('holds flow events until their tick is confirmed, then plays them once', () => {
    const gate = new EventGate();
    expect(gate.filter([roundOver(5, false)])).toEqual([]);
    expect(gate.filter([roundOver(5, true)])).toHaveLength(1);
    expect(gate.filter([roundOver(5, true)])).toEqual([]);
  });

  it('plays cosmetic events the first time their tick is simulated and never again', () => {
    const gate = new EventGate();
    expect(gate.filter([explosion(9, 3, false)])).toHaveLength(1);
    expect(gate.filter([explosion(9, 3, false)])).toEqual([]);
    expect(gate.filter([explosion(9, 3, true)])).toEqual([]);
    expect(gate.filter([explosion(9, 4, false)])).toHaveLength(1);
    expect(gate.filter([explosion(10, 3, false)])).toHaveLength(1);
  });

  it('forgets old ticks after pruning, keeping recent ones', () => {
    const gate = new EventGate();
    gate.filter([explosion(1, 1, false), explosion(1000, 1, false)]);
    gate.prune(1200);
    expect(gate.filter([explosion(1, 1, false)])).toHaveLength(1);
    expect(gate.filter([explosion(1000, 1, false)])).toEqual([]);
  });

  it('classifies the flow events', () => {
    expect(isFlowEvent({ type: 'death', player: 0, cause: 'wall', killer: null, x: 0, y: 0, tick: 1 })).toBe(true);
    expect(isFlowEvent({ type: 'go' })).toBe(true);
    expect(isFlowEvent({ type: 'boostStarted', player: 0 })).toBe(false);
    expect(isFlowEvent({ type: 'heartLost', player: 0, heartsLeft: 2, cause: 'wall', x: 0, y: 0 })).toBe(false);
  });
});
