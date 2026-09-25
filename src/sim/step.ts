import { updateMissiles } from './missiles';
import { detectHit } from './collision';
import { DT, TICK_RATE, type Config } from './config';
import { borderSpeedAt, maxInset } from './border';
import { tickItemTimers, useItem } from './items';
import { MAPS } from './maps';
import { plow } from './dozer';
import { detectNearMisses } from './nearMiss';
import { collectPickups, updatePickups } from './pickups';
import { createRng } from './rng';
import { advanceSnake, growthRate } from './snake';
import { tryHeart, tryShield } from './shield';
import { pickNextMap, startRound } from './state';
import { NO_INPUT, type DeathRecord, type MatchState, type PlayerInput, type SimEvent } from './types';

/** Advances the match by one tick, mutating `state`, and returns what happened. */
export function step(state: MatchState, inputs: readonly PlayerInput[], cfg: Config): SimEvent[] {
  const events: SimEvent[] = [];
  state.tick++;
  switch (state.phase) {
    case 'countdown':
      stepCountdown(state, events);
      break;
    case 'playing':
      stepPlaying(state, inputs, cfg, events);
      break;
    case 'roundOver':
      stepRoundOver(state, cfg, events);
      break;
    case 'matchOver':
      break;
  }
  return events;
}

/** Resets scores and starts a fresh match on the first map with a new seed. */
export function rematch(state: MatchState, cfg: Config, seed: number): void {
  state.scores = state.scores.map(() => 0);
  state.round = 1;
  state.matchWinner = null;
  state.lastRoundWinner = null;
  state.rng = createRng(seed);
  state.mapIndex = 0;
  state.mapBag = [];
  startRound(state, cfg);
}

function stepCountdown(state: MatchState, events: SimEvent[]): void {
  if (state.phaseTicks % TICK_RATE === 0) events.push({ type: 'countdown', n: state.phaseTicks / TICK_RATE });
  state.phaseTicks--;
  if (state.phaseTicks <= 0) {
    state.phase = 'playing';
    events.push({ type: 'go' });
  }
}

function stepPlaying(state: MatchState, inputs: readonly PlayerInput[], cfg: Config, events: SimEvent[]): void {
  state.roundTicks++;
  if (!state.overtime && state.roundTicks >= Math.round(cfg.overtimeAt * TICK_RATE)) {
    state.overtime = true;
    events.push({ type: 'overtime' });
  }

  closeBorder(state, cfg, events);
  tickItemTimers(state, events);
  state.snakes.forEach((s, i) => {
    if (s.alive && (inputs[i] ?? NO_INPUT).use) useItem(state, i, cfg, events);
  });

  const growth = growthRate(cfg, state.overtime);
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    if (advanceSnake(s, i, inputs[i] ?? NO_INPUT, cfg, growth, state.grid)) events.push({ type: 'boostStarted', player: i });
    if (s.effects.dozer > 0) {
      const { moved, crushed } = plow(state, i, cfg);
      if (moved > 0 || crushed.length > 0) events.push({ type: 'plowed', player: i, moved, crushed });
    }
  });

  collectPickups(state, cfg, events);
  const missiled = updateMissiles(state, cfg, events);

  // Everyone alive at the start of the tick is judged before anyone moves or dies, so
  // simultaneous deaths are fair. Grace ignores missiles; a Shield, then a spare heart, turns a hit into a save.
  const hits: DeathRecord[] = [];
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const shooter = missiled.get(i);
    if (shooter !== undefined && s.effects.grace <= 0) {
      hits.push({ player: i, cause: 'missile', killer: shooter, x: s.x, y: s.y });
      return;
    }
    const hit = detectHit(state, i, cfg);
    if (hit) hits.push({ player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y });
  });
  for (const d of hits) {
    if (tryShield(state, d.player, d.cause, cfg, events)) continue;
    if (tryHeart(state, d.player, d.cause, cfg, events)) continue;
    state.snakes[d.player].alive = false;
    state.snakes[d.player].hearts = 0;
    state.deaths.push(d);
    events.push({ type: 'death', ...d });
  }

  // Time never ends a round: past the cap the border closes fast until somebody dies.
  const alive = state.snakes.filter((s) => s.alive);
  if (alive.length === 1) return endRound(state, cfg, events, alive[0].id);
  if (alive.length === 0) return endRound(state, cfg, events, null);
  detectNearMisses(state, cfg, events);
  updatePickups(state, cfg, events);
}

/**
 * The closing border: still until borderCloseSeconds before the cap, then in at borderCloseSpeed,
 * then at borderCrushSpeed past the cap. Capped so the live area never drops below 4r on either axis.
 */
function closeBorder(state: MatchState, cfg: Config, events: SimEvent[]): void {
  const speed = borderSpeedAt(state.roundTicks, cfg);
  if (speed <= 0) return;
  if (state.inset === 0) events.push({ type: 'borderClosing' });
  state.inset = Math.min(maxInset(cfg), state.inset + speed * DT);
}

function endRound(state: MatchState, cfg: Config, events: SimEvent[], winner: number | null): void {
  if (winner !== null) state.scores[winner]++;
  state.lastRoundWinner = winner;
  if (winner !== null && state.scores[winner] >= cfg.winsToWin) state.matchWinner = winner;
  events.push({ type: 'roundOver', winner, deaths: state.deaths.map((d) => ({ ...d })) });
  state.phase = 'roundOver';
  state.phaseTicks = Math.max(1, Math.round(cfg.roundOverSeconds * TICK_RATE));
}

function stepRoundOver(state: MatchState, cfg: Config, events: SimEvent[]): void {
  state.phaseTicks--;
  if (state.phaseTicks > 0) return;
  if (state.matchWinner !== null) {
    state.phase = 'matchOver';
    events.push({ type: 'matchOver', winner: state.matchWinner });
    return;
  }
  state.round++;
  state.mapIndex = pickNextMap(state, MAPS.length);
  startRound(state, cfg);
}
