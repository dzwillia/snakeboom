import { DT, type Config } from './config';
import { detCos, detSin, wrapAngle } from './detmath';
import { gridInsert } from './grid';
import { createTrail, trailPush, trailTrim } from './trail';
import type { Grid, PlayerInput, SnakeState } from './types';

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
    item: null,
    useCooldown: 0,
    holeVersion: 0,
  };
}

/** Growth in units per second. */
export function growthRate(cfg: Config, overtime: boolean): number {
  return cfg.growthPerSecond * (overtime ? cfg.overtimeGrowthMultiplier : 1);
}

/**
 * Advances a live snake by one tick: boost meter, steering, movement, a new trail point
 * (indexed in the grid), growth and tail trimming. Returns true on the tick boosting starts.
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
  if (input.boost && s.boostMeter > 0) {
    s.boosting = true;
    s.boostMeter = Math.max(0, s.boostMeter - DT / cfg.boostMeterSeconds);
  } else {
    s.boosting = false;
    if (!input.boost) s.boostMeter = Math.min(1, s.boostMeter + DT / cfg.boostRefillSeconds);
  }

  s.prevX = s.x;
  s.prevY = s.y;
  s.heading = wrapAngle(s.heading + input.turn * cfg.turnRate * DT);
  const dist = cfg.baseSpeed * (s.boosting ? cfg.boostMultiplier : 1) * DT;
  s.x += detCos(s.heading) * dist;
  s.y += detSin(s.heading) * dist;

  const seq = trailPush(s.trail, s.x, s.y);
  gridInsert(grid, s.x, s.y, idx, seq);
  s.targetLength += growth * DT;
  trailTrim(s.trail, s.targetLength);
  return s.boosting && !wasBoosting;
}
