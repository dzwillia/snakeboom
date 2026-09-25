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
export type PickupKind = 'bomb' | 'ghost' | 'shield' | 'reverse' | 'dozer';

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
  /** The border starts closing this long before the cap; after the cap it closes fast until someone dies. */
  roundMaxSeconds: number;
  /** Seconds before roundMaxSeconds at which the border starts moving in. */
  borderCloseSeconds: number;
  /** Units per second, per side, while closing before the cap. */
  borderCloseSpeed: number;
  /** Units per second, per side, after the cap. */
  borderCrushSpeed: number;
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
  /** Timed specials (Ghost, Reverse, Bulldozer) flash for this many seconds before they run out. */
  effectWarning: number;
  /** Invulnerability (except walls) after a Shield absorbs a hit. */
  shieldGrace: number;
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

/**
 * Defaults: the 2026-09-25 "pace" values (M9). Faster snakes with the same turning circle, double
 * growth, 2 hearts, 45 s rounds with the border closing over the last 15 s, short effects and a
 * steady stream of pickups. CLASSIC_CONFIG below keeps the v0.7.0 feel for comparison.
 */
export const DEFAULT_CONFIG: Config = {
  snakeRadius: 8,
  baseSpeed: 280,
  turnRate: 6.3,
  neckLength: 35,
  startLength: 120,
  growthPerSecond: 40,
  overtimeAt: 9999,
  overtimeGrowthMultiplier: 3,
  roundMaxSeconds: 45,
  borderCloseSeconds: 15,
  borderCloseSpeed: 12,
  borderCrushSpeed: 120,
  boostMultiplier: 2,
  boostMeterSeconds: 2,
  boostRefillSeconds: 6,
  maxPickups: 6,
  firstPickupDelay: 0.5,
  pickupInterval: 1.5,
  pickupLifetime: 12,
  pickupRadius: 14,
  pickupMinHeadDistance: 150,
  pickupClearance: 40,
  pickupWeights: { bomb: 40, ghost: 15, shield: 15, reverse: 10, dozer: 20 },
  itemSlots: 3,
  bombCharges: 3,
  bombThrowCooldown: 0.5,
  bombFlightTime: 0.45,
  bombFuse: 1,
  bombLeadFactor: 1,
  blastRadius: 70,
  chainDelay: 0.12,
  ghostDuration: 2,
  effectWarning: 1,
  shieldGrace: 0.5,
  reverseDuration: 2,
  dozerDuration: 3,
  hearts: 2,
  heartGrace: 1,
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
};

/** The v0.7.0 feel (three hearts, slower and longer rounds), for side-by-side tuning sessions. Not a game mode. */
export const CLASSIC_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  baseSpeed: 240,
  turnRate: 5.4,
  neckLength: 30,
  startLength: 60,
  growthPerSecond: 20,
  overtimeAt: 180,
  roundMaxSeconds: 90,
  borderCloseSeconds: 0,
  maxPickups: 4,
  firstPickupDelay: 1,
  pickupInterval: 2.5,
  pickupWeights: { bomb: 25, ghost: 13, shield: 20, reverse: 12.5, dozer: 35 },
  ghostDuration: 3,
  effectWarning: 3,
  reverseDuration: 4,
  dozerDuration: 5,
  hearts: 3,
};
