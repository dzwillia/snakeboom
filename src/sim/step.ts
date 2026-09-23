import { detectHit, type Hit } from './collision';
import { TICK_RATE, type Config } from './config';
import { MAPS } from './maps';
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

  const growth = growthRate(cfg, state.overtime);
  state.snakes.forEach((s, i) => {
    if (s.alive && advanceSnake(s, i, inputs[i] ?? NO_INPUT, cfg, growth, state.grid)) {
      events.push({ type: 'boostStarted', player: i });
    }
  });

  // Evaluate every head before applying any death, so simultaneous deaths are fair.
  const hits: Array<Hit | null> = state.snakes.map((s, i) => (s.alive ? detectHit(state, i, cfg) : null));
  hits.forEach((hit, i) => {
    if (!hit) return;
    const s = state.snakes[i];
    s.alive = false;
    const record: DeathRecord = { player: i, cause: hit.cause, killer: hit.killer, x: s.x, y: s.y };
    state.deaths.push(record);
    events.push({ type: 'death', ...record });
  });

  const alive = state.snakes.filter((s) => s.alive);
  const timeUp = state.roundTicks >= Math.round(cfg.roundMaxSeconds * TICK_RATE);
  if (alive.length === 1) endRound(state, cfg, events, alive[0].id);
  else if (alive.length === 0 || timeUp) endRound(state, cfg, events, null);
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
