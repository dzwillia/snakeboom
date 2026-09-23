import { updateBombs } from './bombs';
import { detectHit } from './collision';
import { TICK_RATE, type Config } from './config';
import { tickItemTimers, useItem } from './items';
import { MAPS } from './maps';
import { collectPickups, updatePickups } from './pickups';
import { createRng } from './rng';
import { advanceSnake, growthRate } from './snake';
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

  tickItemTimers(state, events);
  state.snakes.forEach((s, i) => {
    if (s.alive && (inputs[i] ?? NO_INPUT).use) useItem(state, i, cfg, events);
  });

  const growth = growthRate(cfg, state.overtime);
  state.snakes.forEach((s, i) => {
    if (s.alive && advanceSnake(s, i, inputs[i] ?? NO_INPUT, cfg, growth, state.grid)) {
      events.push({ type: 'boostStarted', player: i });
    }
  });

  collectPickups(state, cfg, events);
  const blasted = updateBombs(state, cfg, events);

  // Everyone alive at the start of the tick is judged before anyone is removed, so simultaneous deaths are fair.
  const deaths: DeathRecord[] = [];
  state.snakes.forEach((s, i) => {
    if (!s.alive) return;
    const bomber = blasted.get(i);
    if (bomber !== undefined) {
      deaths.push({ player: i, cause: 'blast', killer: bomber, x: s.x, y: s.y });
      return;
    }
    const hit = detectHit(state, i, cfg);
    if (hit) deaths.push({ player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y });
  });
  for (const d of deaths) {
    state.snakes[d.player].alive = false;
    state.deaths.push(d);
    events.push({ type: 'death', ...d });
  }

  const alive = state.snakes.filter((s) => s.alive);
  const timeUp = state.roundTicks >= Math.round(cfg.roundMaxSeconds * TICK_RATE);
  if (alive.length === 1) return endRound(state, cfg, events, alive[0].id);
  if (alive.length === 0 || timeUp) return endRound(state, cfg, events, null);
  updatePickups(state, cfg, events);
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
