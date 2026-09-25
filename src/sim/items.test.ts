import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, TICK_RATE, type Config } from './config';
import { createItem, tickItemTimers, useItem } from './items';
import { createMatch } from './state';
import { step } from './step';
import { NO_INPUT, type MatchState, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, firstPickupDelay: 1000 };

function playing(): MatchState {
  const s = createMatch(cfg, 1);
  s.phase = 'playing';
  return s;
}

describe('items', () => {
  it('a timed special holds one charge and a missile pickup holds missileCharges shots', () => {
    expect(createItem('ghost', cfg)).toEqual({ kind: 'ghost', charges: 1 });
    expect(createItem('missile', cfg)).toEqual({ kind: 'missile', charges: cfg.missileCharges });
  });

  it('waits missileCooldown between shots', () => {
    const s = playing();
    s.snakes[0].items = [createItem('missile', cfg)];
    useItem(s, 0, cfg, []);
    useItem(s, 0, cfg, []);
    expect(s.missiles).toHaveLength(1);
    for (let t = 0; t < Math.round(cfg.missileCooldown * TICK_RATE); t++) tickItemTimers(s, []);
    useItem(s, 0, cfg, []);
    expect(s.missiles).toHaveLength(2);
  });

  it('empties the slot after the last shot', () => {
    const s = playing();
    s.snakes[0].items = [createItem('missile', cfg), createItem('ghost', cfg)];
    for (let k = 0; k < cfg.missileCharges; k++) {
      s.snakes[0].useCooldown = 0;
      useItem(s, 0, cfg, []);
    }
    expect(s.missiles).toHaveLength(cfg.missileCharges);
    expect(s.snakes[0].items.map((i) => i.kind)).toEqual(['ghost']);
  });

  it('does nothing without an item', () => {
    const s = playing();
    const events: SimEvent[] = [];
    useItem(s, 0, cfg, events);
    expect(events).toEqual([]);
    expect(s.missiles).toEqual([]);
  });

  it('starts every round with empty slots, no missiles and the first pickup scheduled', () => {
    const s = playing();
    s.snakes[0].items = [createItem('missile', cfg)];
    useItem(s, 0, cfg, []);
    s.snakes[1].alive = false;
    for (let t = 0; t < 1 + Math.round(cfg.roundOverSeconds * TICK_RATE); t++) step(s, [NO_INPUT, NO_INPUT], cfg);
    expect(s.round).toBe(2);
    expect(s.snakes[0].items).toEqual([]);
    expect(s.missiles).toEqual([]);
    expect(s.pickupTimer).toBe(Math.round(cfg.firstPickupDelay * TICK_RATE));
  });
});
