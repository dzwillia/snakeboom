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
export type PickupKind = 'bomb' | 'ghost' | 'shield' | 'turbo' | 'slow' | 'reverse' | 'dozer';

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
  /** Items a snake can carry at once, used oldest first (a Shield is a bubble and never takes a slot). */
  itemSlots: number;
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
  /** Timed specials (Ghost, Turbo, Slow, Reverse, Bulldozer) flash for this many seconds before they run out. */
  effectWarning: number;
  /** Invulnerability (except walls) after a Shield absorbs a hit. */
  shieldGrace: number;
  turboDuration: number;
  slowDuration: number;
  /** Speed multiplier while slowed. */
  slowFactor: number;
  reverseDuration: number;
  /** Seconds a Bulldozer plow lasts. */
  dozerDuration: number;
  /** Hits a snake can take per round; the last one kills. */
  hearts: number;
  /** Invulnerability (except walls) after losing a heart. */
  heartGrace: number;
  winsToWin: number;
  countdownSeconds: number;
  roundOverSeconds: number;
}

/** Defaults: the values from the 2026-09-23 playtest tuning session, plus hearts and effect warnings. */
export const DEFAULT_CONFIG: Config = {
  snakeRadius: 8,
  baseSpeed: 240,
  turnRate: 5.4,
  neckLength: 30,
  startLength: 60,
  growthPerSecond: 20,
  overtimeAt: 180,
  overtimeGrowthMultiplier: 3,
  roundMaxSeconds: 90,
  boostMultiplier: 2,
  boostMeterSeconds: 2,
  boostRefillSeconds: 6,
  maxPickups: 4,
  firstPickupDelay: 1,
  pickupInterval: 2.5,
  pickupLifetime: 12,
  pickupRadius: 14,
  pickupMinHeadDistance: 150,
  pickupClearance: 40,
  pickupWeights: { bomb: 25, ghost: 13, shield: 20, turbo: 20, slow: 20, reverse: 12.5, dozer: 35 },
  itemSlots: 3,
  bombCharges: 3,
  bombThrowCooldown: 0.5,
  bombFlightTime: 0.45,
  bombFuse: 1,
  bombLeadFactor: 1,
  blastRadius: 70,
  chainDelay: 0.12,
  ghostDuration: 3,
  effectWarning: 3,
  shieldGrace: 0.5,
  turboDuration: 4,
  slowDuration: 4,
  slowFactor: 0.6,
  reverseDuration: 4,
  dozerDuration: 5,
  hearts: 3,
  heartGrace: 1,
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
};
