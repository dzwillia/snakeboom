import { ARENA_HEIGHT, ARENA_WIDTH, TICK_RATE, type Config, type PickupKind } from './config';
import { detCos, detSin } from './detmath';
import { snakeSpeed } from './snake';
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

/**
 * Where a thrown bomb lands: ahead of the nearest living opponent, at the spot they'll reach by
 * the time it blasts if they hold course (scaled by bombLeadFactor), kept inside the arena.
 * With no opponent alive, the thrower's own path is the target.
 */
export function throwTarget(state: MatchState, idx: number, cfg: Config): { x: number; y: number } {
  const me = state.snakes[idx];
  let target = me;
  let best = Infinity;
  state.snakes.forEach((o, j) => {
    if (j === idx || !o.alive) return;
    const dx = o.x - me.x;
    const dy = o.y - me.y;
    if (dx * dx + dy * dy < best) {
      best = dx * dx + dy * dy;
      target = o;
    }
  });
  const lead = snakeSpeed(target, cfg) * (cfg.bombFlightTime + cfg.bombFuse) * cfg.bombLeadFactor;
  const r = cfg.snakeRadius;
  const x = target.x + detCos(target.heading) * lead;
  const y = target.y + detSin(target.heading) * lead;
  return { x: Math.min(Math.max(x, r), ARENA_WIDTH - r), y: Math.min(Math.max(y, r), ARENA_HEIGHT - r) };
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
      const flight = Math.max(1, Math.round(cfg.bombFlightTime * TICK_RATE));
      const { x, y } = throwTarget(state, idx, cfg);
      const id = state.nextId++;
      state.bombs.push({ id, owner: idx, x, y, fromX: s.x, fromY: s.y, flight, flightTotal: flight, fuse, maxFuse: fuse, chainDepth: 0 });
      events.push({ type: 'bombThrown', id, player: idx, fromX: s.x, fromY: s.y, x, y });
      s.useCooldown = Math.round(cfg.bombThrowCooldown * TICK_RATE);
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
