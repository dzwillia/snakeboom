import { TICK_RATE, type Config, type PickupKind } from './config';
import type { ItemState, MatchState, SimEvent } from './types';

export function createItem(kind: PickupKind, cfg: Config): ItemState {
  return { kind, charges: kind === 'bomb' ? Math.max(1, Math.round(cfg.bombCharges)) : 1 };
}

/** Counts down per-snake item timers. Call once per playing tick. */
export function tickItemTimers(state: MatchState): void {
  for (const s of state.snakes) if (s.useCooldown > 0) s.useCooldown--;
}

/** Uses the held item. Bombs drop at the head, at most one per bombDropCooldown. */
export function useItem(state: MatchState, idx: number, cfg: Config, events: SimEvent[]): void {
  const s = state.snakes[idx];
  const item = s.item;
  if (!item || s.useCooldown > 0) return;
  switch (item.kind) {
    case 'bomb': {
      const fuse = Math.max(1, Math.round(cfg.bombFuse * TICK_RATE));
      const id = state.nextId++;
      state.bombs.push({ id, owner: idx, x: s.x, y: s.y, fuse, maxFuse: fuse, chainDepth: 0 });
      events.push({ type: 'bombDropped', id, player: idx, x: s.x, y: s.y });
      s.useCooldown = Math.round(cfg.bombDropCooldown * TICK_RATE);
      break;
    }
  }
  item.charges--;
  if (item.charges <= 0) s.item = null;
}
