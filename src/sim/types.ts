import type { RngState } from './rng';

export type Phase = 'countdown' | 'playing' | 'roundOver' | 'matchOver';

/** Listed in reporting priority order (spec 3.3). */
export type DeathCause = 'blast' | 'headOn' | 'body' | 'self' | 'obstacle' | 'wall';

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
  /** 0..1 */
  boostMeter: number;
  boosting: boolean;
  trail: Trail;
}

export interface DeathRecord {
  player: number;
  cause: DeathCause;
  /** Owner of the body or bomb that killed; the victim for self-kills; null for walls and blocks. */
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
  scores: number[];
  matchWinner: number | null;
  lastRoundWinner: number | null;
  mapIndex: number;
  /** Remaining shuffled map indices; popped from the end. */
  mapBag: number[];
  rng: RngState;
  /** TILE_COLS * TILE_ROWS entries, 1 = solid. Replaced (new array) at each round start. */
  tiles: number[];
  snakes: SnakeState[];
  grid: Grid;
  /** Deaths so far this round. */
  deaths: DeathRecord[];
}

export type SimEvent =
  | { type: 'countdown'; n: number }
  | { type: 'go' }
  | { type: 'overtime' }
  | { type: 'boostStarted'; player: number }
  | ({ type: 'death' } & DeathRecord)
  | { type: 'roundOver'; winner: number | null; deaths: DeathRecord[] }
  | { type: 'matchOver'; winner: number };
