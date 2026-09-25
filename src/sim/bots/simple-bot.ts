import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, type Config } from '../config';
import { detAtan2, detCos, detSin, wrapAngle } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { NO_INPUT, type MatchState, type PlayerInput, type SnakeState } from '../types';

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
const SEEK_RANGE = 450;

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

  const seek = seekTurn(state, me, cfg);
  let turn: -1 | 0 | 1;
  // Chase a pickup when that way stays clear for at least half the look-ahead (like a player would).
  if (seek !== null && clear[seek + 1] >= LOOK_STEPS / 2) turn = seek;
  else if (bot.wanderTicks > 0 && clear[bot.wanderTurn + 1] === LOOK_STEPS) turn = bot.wanderTurn;
  else if (clear[1] === best) turn = 0;
  else {
    const options = TURNS.filter((_, k) => clear[k] === best);
    turn = options[rngInt(bot.rng, options.length)];
  }

  if (bot.boostTicks > 0) bot.boostTicks--;
  else if (best === LOOK_STEPS && me.targetLength > 200 && rngNext(bot.rng) < 0.004) bot.boostTicks = 20 + rngInt(bot.rng, 40);

  let use = false;
  switch (me.items[me.selected]?.kind) {
    case 'missile':
      use = rngNext(bot.rng) < (state.snakes.some((o, j) => j !== idx && o.alive) ? 0.03 : 0);
      break;
    case 'ghost':
      // Escape when boxed in; otherwise use it eventually so it doesn't block the queue.
      use = best < LOOK_STEPS / 3 || rngNext(bot.rng) < 0.005;
      break;
    case 'dozer':
      use = best < LOOK_STEPS / 2 || rngNext(bot.rng) < 0.005;
      break;
    case 'scissors':
      use = best < LOOK_STEPS / 2 || rngNext(bot.rng) < 0.01;
      break;
    case 'flame':
      use = rngNext(bot.rng) < 0.02;
      break;
  }
  return { turn, boost: bot.boostTicks > 0, use, select: false };
}

function dist2(p: { x: number; y: number }, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

/** Turn toward the nearest pickup in range while the slot is empty; null when there's nothing to chase. */
function seekTurn(state: MatchState, me: SnakeState, cfg: Config): -1 | 0 | 1 | null {
  if (me.items.length >= cfg.itemSlots) return null;
  let target: { x: number; y: number } | null = null;
  let best = SEEK_RANGE * SEEK_RANGE;
  for (const p of state.pickups) {
    const d = dist2(p, me.x, me.y);
    if (d < best) {
      best = d;
      target = p;
    }
  }
  if (!target) return null;
  const diff = wrapAngle(detAtan2(target.y - me.y, target.x - me.x) - me.heading);
  if (diff > 0.12) return 1;
  if (diff < -0.12) return -1;
  return 0;
}

/** How many look-ahead steps stay clear while holding `turn`. */
function clearSteps(state: MatchState, idx: number, turn: -1 | 0 | 1, cfg: Config): number {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  const stepDist = cfg.baseSpeed * DT * STEP_TICKS;
  const stepTurn = turn * cfg.turnRate * DT * STEP_TICKS;
  let x = me.x;
  let y = me.y;
  let h = me.heading;
  const probe = { blocked: false };
  for (let k = 1; k <= LOOK_STEPS; k++) {
    h += stepTurn;
    x += detCos(h) * stepDist;
    y += detSin(h) * stepDist;
    if (circleHitsWall(x, y, r + 2, state.inset) || circleHitsTiles(state.tiles, x, y, r + 2)) return k - 1;
    probe.blocked = false;
    forEachSolidPointNear(state, x, y, 2 * r + 3, (snake) => {
      if (snake !== idx) probe.blocked = true;
    });
    if (probe.blocked) return k - 1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive) continue;
      if (dist2(other, x, y) < 16 * r * r) return k - 1;
    }
  }
  return LOOK_STEPS;
}
