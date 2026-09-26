export const ARENA_WIDTH = 3200;
export const ARENA_HEIGHT = 2000;
export const TILE_SIZE = 20;
export const TILE_COLS = 160;
export const TILE_ROWS = 100;
/** A hand-made map cell in units: the 40×25 source grids scale up to the whole arena (4×4 tiles per cell). */
export const MAP_CELL = 80;
export const MAP_COLS = 40;
export const MAP_ROWS = 25;
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** What a pickup can contain. */
export type PickupKind = 'missile' | 'scissors' | 'flame' | 'ghost' | 'shield' | 'dozer';

/** Which maps the bag deals: the five hand-made ones, freshly generated ones, or both. */
export type MapMode = 'handmade' | 'random' | 'both';
export const MAP_MODES: readonly MapMode[] = ['handmade', 'random', 'both'];

/** Tunable gameplay values. Seconds and world units unless noted. */
export interface Config {
  snakeRadius: number;
  baseSpeed: number;
  /** Radians per second. */
  turnRate: number;
  startLength: number;
  growthPerSecond: number;
  overtimeAt: number;
  overtimeGrowthMultiplier: number;
  /** The border starts closing this long before the cap; after the cap it closes fast until someone dies. */
  roundMaxSeconds: number;
  /** Added to the round cap for every player beyond two (see players.ts). */
  roundSecondsPerExtraPlayer: number;
  /** The round cap never exceeds this, however many play. */
  roundMaxSecondsCap: number;
  /** With more than two players, blocks within this of a spawn are cleared for the round. */
  spawnClearance: number;
  /** Seconds before roundMaxSeconds at which the border starts moving in. */
  borderCloseSeconds: number;
  /** Units per second, per side, while closing before the cap. */
  borderCloseSpeed: number;
  /** Units per second, per side, after the cap. */
  borderCrushSpeed: number;
  boostMultiplier: number;
  /** Body length burned per second while boosting (hunt rules: there is no meter). */
  boostBurnPerSecond: number;
  /** Boost stops once the body is this short. */
  minLength: number;
  maxPickups: number;
  firstPickupDelay: number;
  pickupInterval: number;
  pickupLifetime: number;
  pickupRadius: number;
  /** Pickups never spawn closer than this to a head. */
  pickupMinHeadDistance: number;
  /** Pickups spawn at least this far from walls, blocks, bodies and other pickups (room to draw a loop around one). */
  pickupClearance: number;
  /** True: a pickup is taken by closing a loop around it (the encirclement polygon). False: by running over it. */
  collectByLoop: boolean;
  /** Relative spawn chance per kind. */
  pickupWeights: Record<PickupKind, number>;
  /** Body length per item slot: you carry floor(length / slotLength) items, at least 1 and at most itemSlots (a Shield is a bubble and never takes a slot). */
  slotLength: number;
  /** The most items a snake can carry however long it is; Select picks one and Fire uses it. */
  itemSlots: number;
  /** Shots in one missile pickup. */
  missileCharges: number;
  /** Seconds between shots. */
  missileCooldown: number;
  /** Units per second. */
  missileSpeed: number;
  /** Radians per second it can turn toward its target. */
  missileTurnRate: number;
  /** Seconds before it fizzles. */
  missileLife: number;
  missileRadius: number;
  /** The newest path length of your own trail that doesn't count as crossing it (so the head's own neck can't close a loop). */
  loopIgnore: number;
  ghostDuration: number;
  /** Timed specials (Ghost, Scissors, Bulldozer) flash for this many seconds before they run out. */
  effectWarning: number;
  /** Invulnerability (except walls) after a Shield absorbs a hit. */
  shieldGrace: number;
  /** Seconds a Bulldozer plow lasts. */
  dozerDuration: number;
  /** Seconds the Scissors cut for. */
  scissorsDuration: number;
  /** Flamethrower: seconds the cone burns. */
  flameDuration: number;
  /** How far ahead of the head the fire reaches, in units. */
  flameRange: number;
  /** Half-angle of the cone, in radians. */
  flameSpread: number;
  /** Hits a snake can take per round; the last one kills. */
  hearts: number;
  /** Invulnerability (except walls) after losing a heart. */
  heartGrace: number;
  winsToWin: number;
  countdownSeconds: number;
  roundOverSeconds: number;
  /** Seconds between wormholes (one at a time); 0 or less means none. */
  wormholeInterval: number;
  /** Seconds a wormhole stays open. */
  wormholeLifetime: number;
  /** Portal radius: a head within this plus its own radius goes through. */
  wormholeRadius: number;
  /** The exit is at least this far from the portal. */
  wormholeMinJump: number;
  /** Seconds after a warp before a wormhole can take that head again. */
  portalCooldown: number;
  /** Seconds between saws (one at a time); 0 or less means none. */
  sawInterval: number;
  /** Seconds a saw roves for. */
  sawLifetime: number;
  sawRadius: number;
  /** Units per second; it bounces off the live border and blocks. */
  sawSpeed: number;
  /** A saw appears at least this far from every head. */
  sawMinHeadDistance: number;
  /** Which maps rotate between rounds. Round 1 is Open unless this is 'random'. */
  maps: MapMode;
  /** 0–1: how many blocks a generated map gets, as a share of the most the generator places (15% of cells). 0.3 matches the hand-made maps. */
  mapDensity: number;
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
  startLength: 120,
  growthPerSecond: 40,
  overtimeAt: 9999,
  overtimeGrowthMultiplier: 3,
  roundMaxSeconds: 45,
  roundSecondsPerExtraPlayer: 10,
  roundMaxSecondsCap: 90,
  spawnClearance: 140,
  borderCloseSeconds: 15,
  borderCloseSpeed: 24,
  borderCrushSpeed: 120,
  boostMultiplier: 2,
  boostBurnPerSecond: 60,
  minLength: 60,
  maxPickups: 12,
  firstPickupDelay: 0.5,
  pickupInterval: 1,
  pickupLifetime: 12,
  pickupRadius: 14,
  pickupMinHeadDistance: 300,
  pickupClearance: 60,
  collectByLoop: true,
  pickupWeights: { missile: 30, scissors: 15, flame: 15, ghost: 15, shield: 15, dozer: 10 },
  slotLength: 150,
  itemSlots: 6,
  missileCharges: 3,
  missileCooldown: 0.4,
  missileSpeed: 420,
  missileTurnRate: 3,
  missileLife: 2,
  missileRadius: 10,
  loopIgnore: 24,
  ghostDuration: 2,
  effectWarning: 1,
  shieldGrace: 0.5,
  dozerDuration: 3,
  scissorsDuration: 3,
  flameDuration: 2.5,
  flameRange: 150,
  flameSpread: 0.5,
  hearts: 1,
  heartGrace: 1,
  winsToWin: 5,
  countdownSeconds: 3,
  roundOverSeconds: 2.5,
  wormholeInterval: 12,
  wormholeLifetime: 10,
  wormholeRadius: 30,
  wormholeMinJump: 800,
  portalCooldown: 1,
  sawInterval: 15,
  sawLifetime: 12,
  sawRadius: 34,
  sawSpeed: 180,
  sawMinHeadDistance: 400,
  maps: 'both',
  mapDensity: 0.3,
};

/** The v0.7.0 feel (three hearts, slower and longer rounds), for side-by-side tuning sessions. Not a game mode. */
export const CLASSIC_CONFIG: Config = {
  ...DEFAULT_CONFIG,
  baseSpeed: 240,
  turnRate: 5.4,
  startLength: 60,
  growthPerSecond: 20,
  overtimeAt: 180,
  roundMaxSeconds: 90,
  borderCloseSeconds: 0,
  maxPickups: 8,
  firstPickupDelay: 1,
  pickupInterval: 1.5,
  pickupWeights: { missile: 30, scissors: 0, flame: 0, ghost: 15, shield: 20, dozer: 35 },
  itemSlots: 3,
  ghostDuration: 3,
  effectWarning: 3,
  dozerDuration: 5,
  hearts: 3,
  wormholeInterval: 0,
  sawInterval: 0,
  maps: 'handmade',
};
