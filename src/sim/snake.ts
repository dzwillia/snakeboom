import { DT, type Config } from './config';
import { detCos, detSin, wrapAngle } from './detmath';
import { gridInsert } from './grid';
import { createTrail, trailPush, trailTrim } from './trail';
import type { EffectTimers, Grid, PlayerInput, SnakeState } from './types';

export function noEffects(): EffectTimers {
  return { ghost: 0, scissors: 0, dozer: 0, flame: 0, grace: 0 };
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
    boosting: false,
    trail,
    items: [],
    selected: 0,
    shield: false,
    hearts: Math.max(1, Math.round(cfg.hearts)),
    useCooldown: 0,
    holeVersion: 0,
    effects: noEffects(),
    nearMissCooldown: 0,
    crossing: false,
    portalCooldown: 0,
  };
}

/** Growth in units per second. */
export function growthRate(cfg: Config, overtime: boolean): number {
  return cfg.growthPerSecond * (overtime ? cfg.overtimeGrowthMultiplier : 1);
}

/** Current speed in units per second: base speed, multiplied while boosting. */
export function snakeSpeed(s: SnakeState, cfg: Config): number {
  return cfg.baseSpeed * (s.boosting ? cfg.boostMultiplier : 1);
}

/**
 * Advances a live snake by one tick: boost (which burns body length), steering, movement, a new
 * trail point (indexed in the grid), growth and tail trimming. Returns true on the tick boosting starts.
 */
export function advanceSnake(
  s: SnakeState,
  idx: number,
  input: PlayerInput,
  cfg: Config,
  growth: number,
  grid: Grid,
): boolean {
  // Boost costs body: hold it as long as there is length to spend above minLength.
  const wasBoosting = s.boosting;
  s.boosting = input.boost && s.targetLength > cfg.minLength;
  if (s.boosting) s.targetLength = Math.max(cfg.minLength, s.targetLength - cfg.boostBurnPerSecond * DT);

  s.prevX = s.x;
  s.prevY = s.y;
  s.heading = wrapAngle(s.heading + input.turn * cfg.turnRate * DT);
  const dist = snakeSpeed(s, cfg) * DT;
  s.x += detCos(s.heading) * dist;
  s.y += detSin(s.heading) * dist;

  const seq = trailPush(s.trail, s.x, s.y);
  gridInsert(grid, s.x, s.y, idx, seq);
  s.targetLength += growth * DT;
  trailTrim(s.trail, s.targetLength);
  return s.boosting && !wasBoosting;
}
