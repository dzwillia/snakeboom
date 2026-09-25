import type { PickupKind } from './config';
import type { RngState } from './rng';

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

/** Listed in reporting priority order (spec 3.3). */
export type DeathCause = 'missile' | 'headOn' | 'body' | 'obstacle' | 'wall';

export interface PlayerInput {
  turn: -1 | 0 | 1;
  boost: boolean;
  /** Use was pressed at least once since the previous tick. */
  use: boolean;
}

export const NO_INPUT: PlayerInput = { turn: 0, boost: false, use: false };

/** Points the head has passed through, oldest first. Indices before `start` are trimmed. */
export interface Trail {
  xs: number[];
  ys: number[];
  /** Cumulative path length at each point; strictly non-decreasing. */
  cum: number[];
  /** false marks a hole: not solid and not drawn. */
  solid: boolean[];
  /** Array index of the tail (first live point). */
  start: number;
  /** Sequence number of array index 0, so seq = baseSeq + index survives compaction. */
  baseSeq: number;
}

/** Uniform spatial hash of trail points. Each entry packs seq * 8 + snakeIndex. */
export interface Grid {
  cols: number;
  rows: number;
  cellSize: number;
  cells: number[][];
}

/** What a snake holds in its single item slot. */
export interface ItemState {
  kind: PickupKind;
  /** Uses left; the slot empties at 0. */
  charges: number;
}

/** Timed effects on a snake, in ticks remaining (0 = off). */
export interface EffectTimers {
  ghost: number;
  /** Bulldozer: the plow shoves blocks and the head ignores them. */
  dozer: number;
  /** Shield grace: immune to everything except walls. */
  grace: number;
}

/** Effects announced by effectStarted/effectEnded events (grace is internal). */
export type EffectName = 'ghost' | 'dozer';

export interface PickupState {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  /** Ticks until it disappears. */
  ttl: number;
}

/** A homing missile in flight. */
export interface MissileState {
  id: number;
  owner: number;
  x: number;
  y: number;
  /** Radians, like a snake's heading. */
  heading: number;
  /** Ticks left before it fizzles. */
  ttl: number;
}

export interface SnakeState {
  id: number;
  alive: boolean;
  x: number;
  y: number;
  /** Head position one tick ago, for render interpolation. */
  prevX: number;
  prevY: number;
  /** Radians, 0 = east, clockwise positive (y points down). */
  heading: number;
  targetLength: number;
  boosting: boolean;
  trail: Trail;
  /** Carried items, oldest first; Use fires items[0]. */
  items: ItemState[];
  /** A Shield bubble: absorbs the next death. Never takes an item slot. */
  shield: boolean;
  /** Hits left this round; the snake dies on the hit that takes the last one. */
  hearts: number;
  /** Ticks until Use works again. */
  useCooldown: number;
  /** Bumped whenever holes change in this trail (nothing makes holes any more; kept for the renderer). */
  holeVersion: number;
  effects: EffectTimers;
  /** Ticks until another near miss can be reported for this snake. */
  nearMissCooldown: number;
}

export interface DeathRecord {
  player: number;
  cause: DeathCause;
  /** Owner of the body or missile that killed; null for walls and blocks. */
  killer: number | null;
  x: number;
  y: number;
}

export interface MatchState {
  tick: number;
  phase: Phase;
  /** Ticks left in countdown or roundOver. */
  phaseTicks: number;
  /** 1-based round number. */
  round: number;
  /** Ticks since GO in the current round. */
  roundTicks: number;
  overtime: boolean;
  /** How far the deadly border has moved in from every side this round, in units. */
  inset: number;
  scores: number[];
  matchWinner: number | null;
  lastRoundWinner: number | null;
  mapIndex: number;
  /** Remaining shuffled map indices; popped from the end. */
  mapBag: number[];
  rng: RngState;
  /** TILE_COLS * TILE_ROWS entries, 1 = solid. Replaced (new array) at each round start. */
  tiles: number[];
  /** Bumped whenever tiles change (round start or the plow). */
  tilesVersion: number;
  snakes: SnakeState[];
  grid: Grid;
  /** Deaths so far this round. */
  deaths: DeathRecord[];
  pickups: PickupState[];
  missiles: MissileState[];
  /** Ticks until the next pickup spawn attempt. */
  pickupTimer: number;
  /** Next id for pickups and missiles. */
  nextId: number;
}

export type SimEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'overtime' }
  /** Once per round, when the border starts moving in. */
  | { type: 'borderClosing' }
  | { type: 'boostStarted'; player: number }
  | ({ type: 'death' } & DeathRecord)
  | { type: 'roundOver'; winner: number | null; deaths: DeathRecord[] }
  | { type: 'matchOver'; winner: number }
  | { type: 'pickupSpawned'; id: number; kind: PickupKind; x: number; y: number }
  | { type: 'pickupCollected'; id: number; kind: PickupKind; player: number }
  | { type: 'pickupExpired'; id: number }
  | { type: 'missileFired'; id: number; player: number; x: number; y: number; heading: number }
  | { type: 'missileHit'; id: number; player: number; x: number; y: number }
  | { type: 'missileFizzled'; id: number; x: number; y: number }
  | { type: 'itemUsed'; player: number; kind: PickupKind }
  | { type: 'effectStarted'; player: number; effect: EffectName }
  | { type: 'effectEnded'; player: number; effect: EffectName }
  | { type: 'shieldBlocked'; player: number; x: number; y: number; cause: DeathCause }
  | { type: 'nearMiss'; player: number; x: number; y: number }
  | { type: 'plowed'; player: number; moved: number; crushed: number[] }
  | { type: 'heartLost'; player: number; heartsLeft: number; cause: DeathCause; x: number; y: number };
