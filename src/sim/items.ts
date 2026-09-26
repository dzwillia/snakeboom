import { TICK_RATE, type Config, type PickupKind } from './config';
import type { EffectName, ItemState, MatchState, SimEvent, SnakeState } from './types';

const ANNOUNCED: EffectName[] = ['ghost', 'scissors', 'dozer', 'flame'];

export function createItem(kind: PickupKind, cfg: Config): ItemState {
  return { kind, charges: kind === 'missile' ? Math.max(1, Math.round(cfg.missileCharges)) : 1 };
}

/** Counts down Fire cooldowns and effect timers, reporting effects that run out. Call once per playing tick. */
export function tickItemTimers(state: MatchState, events: SimEvent[]): void {
  state.snakes.forEach((s, player) => {
    clampSelection(s); // whatever dropped items since last tick, the selection still points at one
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
  const r = cfg.snakeRadius + state.inset;
  const x = target.x + detCos(target.heading) * lead;
  const y = target.y + detSin(target.heading) * lead;
  return { x: Math.min(Math.max(x, r), ARENA_WIDTH - r), y: Math.min(Math.max(y, r), ARENA_HEIGHT - r) };
}

/** Keeps `selected` pointing at a carried item (0 when there are none), after anything drops items. */
export function clampSelection(s: SnakeState): void {
  if (s.items.length === 0) s.selected = 0;
  else if (s.selected < 0 || s.selected >= s.items.length || !Number.isInteger(s.selected)) s.selected = 0;
}

/** Select: moves the selection to the next carried item, wrapping around to the first. */
export function selectNextItem(s: SnakeState): void {
  clampSelection(s);
  if (s.items.length > 0) s.selected = (s.selected + 1) % s.items.length;
}

/**
 * Fires the selected item (items[selected]); a missile pickup stays selected until its last shot.
 * When the item is used up, the selection moves to the next one, wrapping to the first.
 */
export function useItem(state: MatchState, idx: number, cfg: Config, events: SimEvent[]): void {
  const s = state.snakes[idx];
  clampSelection(s);
  const item = s.items[s.selected];
  if (!item || s.useCooldown > 0) return;
  if (item.kind !== 'missile') events.push({ type: 'itemUsed', player: idx, kind: item.kind });
  switch (item.kind) {
    case 'missile': {
      const id = state.nextId++;
      state.missiles.push({ id, owner: idx, x: s.x, y: s.y, heading: s.heading, ttl: Math.max(1, Math.round(cfg.missileLife * TICK_RATE)) });
      events.push({ type: 'missileFired', id, player: idx, x: s.x, y: s.y, heading: s.heading });
      s.useCooldown = Math.round(cfg.missileCooldown * TICK_RATE);
      break;
    }
    case 'ghost':
      startEffect(state, idx, 'ghost', cfg.ghostDuration, events);
      break;
    case 'scissors':
      startEffect(state, idx, 'scissors', cfg.scissorsDuration, events);
      break;
    case 'dozer':
      startEffect(state, idx, 'dozer', cfg.dozerDuration, events);
      break;
    case 'flame':
      startEffect(state, idx, 'flame', cfg.flameDuration, events);
      break;
    case 'shield':
      s.shield = true; // Shields are bubbles, but never let one jam the queue
      break;
  }
  item.charges--;
  if (item.charges <= 0) {
    s.items.splice(s.selected, 1); // the next item slides into the selected index
    if (s.selected >= s.items.length) s.selected = 0;
  }
}
