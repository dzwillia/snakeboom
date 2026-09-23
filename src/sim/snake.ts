import { DT, type Config } from './config';
import { detCos, detSin, wrapAngle } from './detmath';
import { gridInsert } from './grid';
import { createTrail, trailPush, trailTrim } from './trail';
import type { EffectTimers, Grid, PlayerInput, SnakeState } from './types';

export function noEffects(): EffectTimers {
  return { ghost: 0, turbo: 0, slow: 0, reverse: 0, dozer: 0, grace: 0 };
}

export function createSnake(id: number, x: number, y: number, heading: number, cfg: Config): SnakeState {
  const trail = createTrail();
  trailPush(trail, x, y);
  return {
    id,
    alive: true,
    x,
    y,
    prevX: x,
    prevY: y,
    heading,
    targetLength: cfg.startLength,
    boostMeter: 1,
    boosting: false,
    trail,
    items: [],
    shield: false,
    useCooldown: 0,
    holeVersion: 0,
    effects: noEffects(),
  };
}

/** Growth in units per second. */
export function growthRate(cfg: Config, overtime: boolean): number {
  return cfg.growthPerSecond * (overtime ? cfg.overtimeGrowthMultiplier : 1);
}

/** Current speed in units per second: boosting and Slow both multiply. */
export function snakeSpeed(s: SnakeState, cfg: Config): number {
  return cfg.baseSpeed * (s.boosting ? cfg.boostMultiplier : 1) * (s.effects.slow > 0 ? cfg.slowFactor : 1);
}

/**
 * Advances a live snake by one tick: boost meter (Turbo makes boosting free), steering
 * (Reverse swaps left and right), movement, a new trail point (indexed in the grid), growth
 * and tail trimming. Returns true on the tick boosting starts.
 */
export function advanceSnake(
  s: SnakeState,
  idx: number,
  input: PlayerInput,
  cfg: Config,
  growth: number,
  grid: Grid,
): boolean {
  const wasBoosting = s.boosting;
  const turbo = s.effects.turbo > 0;
  if (input.boost && (s.boostMeter > 0 || turbo)) {
    s.boosting = true;
    if (!turbo) s.boostMeter = Math.max(0, s.boostMeter - DT / cfg.boostMeterSeconds);
  } else {
    s.boosting = false;
    if (!input.boost) s.boostMeter = Math.min(1, s.boostMeter + DT / cfg.boostRefillSeconds);
  }

  s.prevX = s.x;
  s.prevY = s.y;
  const turn = s.effects.reverse > 0 ? -input.turn : input.turn;
  s.heading = wrapAngle(s.heading + turn * cfg.turnRate * DT);
  const dist = snakeSpeed(s, cfg) * DT;
  s.x += detCos(s.heading) * dist;
  s.y += detSin(s.heading) * dist;

  const seq = trailPush(s.trail, s.x, s.y);
  gridInsert(grid, s.x, s.y, idx, seq);
  s.targetLength += growth * DT;
  trailTrim(s.trail, s.targetLength);
  return s.boosting && !wasBoosting;
}
