import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, type Config } from '../config';
import { detAtan2, detCos, detSin, wrapAngle } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
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
const BOMB_RANGE = 220;

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

  const seek = seekTurn(state, me);
  let turn: -1 | 0 | 1;
  if (seek !== null && clear[seek + 1] === LOOK_STEPS) turn = seek;
  else if (bot.wanderTicks > 0 && clear[bot.wanderTurn + 1] === LOOK_STEPS) turn = bot.wanderTurn;
  else if (clear[1] === best) turn = 0;
  else {
    const options = TURNS.filter((_, k) => clear[k] === best);
    turn = options[rngInt(bot.rng, options.length)];
  }

  if (bot.boostTicks > 0) bot.boostTicks--;
  else if (best === LOOK_STEPS && rngNext(bot.rng) < 0.004) bot.boostTicks = 20 + rngInt(bot.rng, 40);

  const near = state.snakes.some((o, j) => j !== idx && o.alive && dist2(o, me.x, me.y) < BOMB_RANGE * BOMB_RANGE);
  let use = false;
  switch (me.item?.kind) {
    case 'bomb':
      use = rngNext(bot.rng) < (state.snakes.some((o, j) => j !== idx && o.alive) ? 0.03 : 0);
      break;
    case 'slow':
    case 'reverse':
      use = rngNext(bot.rng) < (near ? 0.08 : 0.005);
      break;
    case 'ghost':
      use = best < LOOK_STEPS / 3; // escape when boxed in
      break;
    case 'turbo':
      use = best === LOOK_STEPS && rngNext(bot.rng) < 0.01;
      break;
  }
  return { turn, boost: bot.boostTicks > 0, use };
}

function dist2(p: { x: number; y: number }, x: number, y: number): number {
  const dx = p.x - x;
  const dy = p.y - y;
  return dx * dx + dy * dy;
}

/** Turn toward the nearest pickup in range while the slot is empty; null when there's nothing to chase. */
function seekTurn(state: MatchState, me: SnakeState): -1 | 0 | 1 | null {
  if (me.item) return null;
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
    const danger = cfg.blastRadius + r;
    for (const b of state.bombs) if (dist2(b, x, y) < danger * danger && b.flight + b.fuse < 60) return k - 1;
    for (let j = 0; j < state.snakes.length; j++) {
      const other = state.snakes[j];
      if (j === idx || !other.alive) continue;
      if (dist2(other, x, y) < 16 * r * r) return k - 1;
    }
  }
  return LOOK_STEPS;
}
