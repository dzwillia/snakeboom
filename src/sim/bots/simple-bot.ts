import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, type Config } from '../config';
import { detCos, detSin } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
import { NO_INPUT, type MatchState, type PlayerInput } from '../types';

/** A cheap look-ahead bot for soak tests (and the seed of a future AI opponent). */
export interface BotState {
  rng: RngState;
  boostTicks: number;
  wanderTicks: number;
  wanderTurn: -1 | 1;
}

export function createBot(seed: number): BotState {
  return { rng: createRng(seed), boostTicks: 0, wanderTicks: 0, wanderTurn: 1 };
}

const LOOK_STEPS = 30;
const STEP_TICKS = 3;
const TURNS = [-1, 0, 1] as const;

export function botInput(bot: BotState, state: MatchState, idx: number, cfg: Config): PlayerInput {
  const me = state.snakes[idx];
  if (state.phase !== 'playing' || !me.alive) return NO_INPUT;
  const clear = TURNS.map((turn) => clearSteps(state, idx, turn, cfg));
  const best = Math.max(...clear);

  if (bot.wanderTicks > 0) bot.wanderTicks--;
  else if (rngNext(bot.rng) < 0.02) {
    bot.wanderTicks = 15 + rngInt(bot.rng, 45);
    bot.wanderTurn = rngNext(bot.rng) < 0.5 ? -1 : 1;
  }

  let turn: -1 | 0 | 1;
  if (bot.wanderTicks > 0 && clear[bot.wanderTurn + 1] === LOOK_STEPS) turn = bot.wanderTurn;
  else if (clear[1] === best) turn = 0;
  else {
    const options = TURNS.filter((_, k) => clear[k] === best);
    turn = options[rngInt(bot.rng, options.length)];
  }

  if (bot.boostTicks > 0) bot.boostTicks--;
  else if (best === LOOK_STEPS && rngNext(bot.rng) < 0.004) bot.boostTicks = 20 + rngInt(bot.rng, 40);

  return { turn, boost: bot.boostTicks > 0, use: false };
}

/** How many look-ahead steps stay clear while holding `turn`. */
function clearSteps(state: MatchState, idx: number, turn: -1 | 0 | 1, cfg: Config): number {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const stepDist = cfg.baseSpeed * DT * STEP_TICKS;
  const stepTurn = turn * cfg.turnRate * DT * STEP_TICKS;
  const ignoreOwnFrom = headCum(me.trail) - cfg.neckLength - 2 * r;
  let x = me.x;
  let y = me.y;
  let h = me.heading;
  const probe = { blocked: false };
  for (let k = 1; k <= LOOK_STEPS; k++) {
    h += stepTurn;
    x += detCos(h) * stepDist;
    y += detSin(h) * stepDist;
    if (circleHitsWall(x, y, r + 2) || circleHitsTiles(state.tiles, x, y, r + 2)) return k - 1;
    probe.blocked = false;
    forEachSolidPointNear(state, x, y, 2 * r + 3, (snake, i) => {
      if (snake !== idx || me.trail.cum[i] < ignoreOwnFrom) probe.blocked = true;
    });
    if (probe.blocked) return k - 1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive) continue;
      const dx = other.x - x;
      const dy = other.y - y;
      if (dx * dx + dy * dy < 16 * r * r) return k - 1;
    }
  }
  return LOOK_STEPS;
}
