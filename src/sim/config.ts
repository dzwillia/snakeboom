export const ARENA_WIDTH = 1600;
export const ARENA_HEIGHT = 1000;
export const TILE_SIZE = 20;
export const TILE_COLS = 80;
export const TILE_ROWS = 50;
export const MAP_CELL = 40;
export const MAP_COLS = 40;
export const MAP_ROWS = 25;
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** What a pickup can contain. */
export type PickupKind = 'bomb' | 'ghost' | 'shield' | 'turbo' | 'slow' | 'reverse';

/** Tunable gameplay values. Seconds and world units unless noted. */
export interface Config {
  snakeRadius: number;
  baseSpeed: number;
  /** Radians per second. */
  turnRate: number;
  /** Newest path length of your own trail that can't kill you. */
  neckLength: number;
  startLength: number;
  growthPerSecond: number;
  overtimeAt: number;
  overtimeGrowthMultiplier: number;
  roundMaxSeconds: number;
  boostMultiplier: number;
  /** Seconds of boosting that empty a full meter. */
  boostMeterSeconds: number;
  /** Seconds (key released) that refill an empty meter. */
  boostRefillSeconds: number;
  maxPickups: number;
  firstPickupDelay: number;
  pickupInterval: number;
  pickupLifetime: number;
  pickupRadius: number;
  /** Pickups never spawn closer than this to a head. */
  pickupMinHeadDistance: number;
  /** Pickups spawn at least this far from walls, blocks, bodies, bombs and other pickups. */
  pickupClearance: number;
  /** Relative spawn chance per kind. */
  pickupWeights: Record<PickupKind, number>;
  /** Bombs in one bomb pickup. */
  bombCharges: number;
  /** Seconds between throws. */
  bombThrowCooldown: number;
  /** Seconds a thrown bomb spends in the air before it lands. */
  bombFlightTime: number;
  /** Seconds from landing to the blast. */
  bombFuse: number;
  /**
   * Where a bomb lands: 1 aims at the spot the opponent will reach, holding course, by the time it
   * blasts; 0 lands it on their head; values in between lead them partway.
   */
  bombLeadFactor: number;
  blastRadius: number;
  /** Fuse given to a bomb caught in another bomb's blast. */
  chainDelay: number;
  ghostDuration: number;
  /** The final part of a Ghost during which the head flickers as a warning. */
  ghostWarning: number;
  /** Invulnerability (except walls) after a Shield absorbs a hit. */
  shieldGrace: number;
  turboDuration: number;
  slowDuration: number;
  /** Speed multiplier while slowed. */
  slowFactor: number;
  reverseDuration: number;
  winsToWin: number;
  countdownSeconds: number;
  roundOverSeconds: number;
}

export const DEFAULT_CONFIG: Config = {
  snakeRadius: 7,
  baseSpeed: 170,
  turnRate: 3.4,
  neckLength: 24,
  startLength: 120,
  growthPerSecond: 40,
  overtimeAt: 150,
  overtimeGrowthMultiplier: 3,
  roundMaxSeconds: 300,
  boostMultiplier: 1.6,
  boostMeterSeconds: 2,
  boostRefillSeconds: 6,
  maxPickups: 4,
  firstPickupDelay: 1,
  pickupInterval: 2.5,
  pickupLifetime: 12,
  pickupRadius: 14,
  pickupMinHeadDistance: 150,
  pickupClearance: 40,
  pickupWeights: { bomb: 25, ghost: 15, shield: 15, turbo: 15, slow: 15, reverse: 15 },
  bombCharges: 3,
  bombThrowCooldown: 0.5,
  bombFlightTime: 0.45,
  bombFuse: 1,
  bombLeadFactor: 1,
  blastRadius: 70,
  chainDelay: 0.12,
  ghostDuration: 3,
  ghostWarning: 0.75,
  shieldGrace: 0.5,
  turboDuration: 4,
  slowDuration: 4,
  slowFactor: 0.6,
  reverseDuration: 4,
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
};
