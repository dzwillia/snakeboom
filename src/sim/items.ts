import { TICK_RATE, type Config, type PickupKind } from './config';
import type { EffectName, ItemState, MatchState, SimEvent } from './types';

const ANNOUNCED: EffectName[] = ['ghost', 'turbo', 'slow', 'reverse'];

export function createItem(kind: PickupKind, cfg: Config): ItemState {
  return { kind, charges: kind === 'bomb' ? Math.max(1, Math.round(cfg.bombCharges)) : 1 };
}

/** Counts down Use cooldowns and effect timers, reporting effects that run out. Call once per playing tick. */
export function tickItemTimers(state: MatchState, events: SimEvent[]): void {
  state.snakes.forEach((s, player) => {
    if (s.useCooldown > 0) s.useCooldown--;
    if (s.effects.grace > 0) s.effects.grace--;
    for (const effect of ANNOUNCED) {
      if (s.effects[effect] <= 0) continue;
      s.effects[effect]--;
      if (s.effects[effect] === 0) events.push({ type: 'effectEnded', player, effect });
    }
  });
}

function startEffect(state: MatchState, player: number, effect: EffectName, seconds: number, events: SimEvent[]): void {
  state.snakes[player].effects[effect] = Math.max(1, Math.round(seconds * TICK_RATE));
  events.push({ type: 'effectStarted', player, effect });
}

/** Uses the held item. A Shield is passive (Use does nothing); everything else is spent. */
export function useItem(state: MatchState, idx: number, cfg: Config, events: SimEvent[]): void {
  const s = state.snakes[idx];
  const item = s.item;
  if (!item || s.useCooldown > 0 || item.kind === 'shield') return;
  const opponents = state.snakes.flatMap((o, j) => (j !== idx && o.alive ? [j] : []));
  if (item.kind !== 'bomb') events.push({ type: 'itemUsed', player: idx, kind: item.kind });
  switch (item.kind) {
    case 'bomb': {
      const fuse = Math.max(1, Math.round(cfg.bombFuse * TICK_RATE));
      const id = state.nextId++;
      state.bombs.push({ id, owner: idx, x: s.x, y: s.y, fuse, maxFuse: fuse, chainDepth: 0 });
      events.push({ type: 'bombDropped', id, player: idx, x: s.x, y: s.y });
      s.useCooldown = Math.round(cfg.bombDropCooldown * TICK_RATE);
      break;
    }
    case 'ghost':
      startEffect(state, idx, 'ghost', cfg.ghostDuration, events);
      break;
    case 'turbo':
      startEffect(state, idx, 'turbo', cfg.turboDuration, events);
      break;
    case 'slow':
      for (const j of opponents) startEffect(state, j, 'slow', cfg.slowDuration, events);
      break;
    case 'reverse':
      for (const j of opponents) startEffect(state, j, 'reverse', cfg.reverseDuration, events);
      break;
  }
  item.charges--;
  if (item.charges <= 0) s.item = null;
}
