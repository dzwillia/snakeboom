/**
 * Messages between the client and the relay. Control messages are JSON text frames; per-tick
 * inputs are binary frames (see codec.ts). Times are milliseconds on the relay's clock.
 */

/** Bumped on every incompatible change; the relay refuses other values. */
export const PROTOCOL = 8;

/** Netcode counters for one round, as the client measured them (deltas since the previous round). */
export interface NetStats {
  ticks: number;
  stalledTicks: number;
  rollbacks: number;
  maxRollbackDepth: number;
  rollbackTicks: number;
  receivedLate: number;
}

export interface RoundResult {
  round: number;
  winner: number | null;
  scores: number[];
  matchWinner: number | null;
  net?: NetStats;
}

export type ClientMessage =
  | { type: 'hello'; protocol: number; version: string; name: string; session?: string; fromTick?: number }
  /** `name`: a room name the host chose (see names.ts), or omitted for a random code. `size`: seats, 2–8 (2 by default). */
  | { type: 'create'; winsToWin: number; size?: number; name?: string }
  | { type: 'join'; room: string }
  /** Quick-match: join the oldest open room of that size, or open my own and wait. */
  | { type: 'queue'; winsToWin: number; size?: number }
  | { type: 'leaveQueue' }
  | { type: 'ready'; ready: boolean }
  | { type: 'pong'; t: number }
  | { type: 'hash'; tick: number; hash: number; result?: RoundResult }
  | { type: 'away' }
  | { type: 'back' }
  | { type: 'leave' };

export interface LobbyPlayer {
  name: string;
  ready: boolean;
  connected: boolean;
}

export type CloseReason = 'idle' | 'restart' | 'full' | 'unknownRoom';
/** `roomName`: the chosen room name was refused (invalid, reserved or taken); `message` says why. */
export type ErrorCode = 'version' | 'badMessage' | 'busy' | 'notInRoom' | 'roomName';

export type ServerMessage =
  | { type: 'welcome'; player: number; room: string; session: string; name: string }
  /** One entry per seat (`size` of them); null is an empty seat. */
  | { type: 'lobby'; players: (LobbyPlayer | null)[]; winsToWin: number; size: number; pingMs: number | null }
  /** Sent to every waiting quick-match player whenever the queue or the player count changes. */
  | { type: 'queued'; waiting: number; online: number }
  /**
   * `players` seats play; `seats[roomSeat]` is that seat's sim player index, or −1 for an empty
   * seat. Relayed frames carry room seats. `rttMs` is per room seat.
   */
  | { type: 'start'; seed: number; winsToWin: number; players: number; seats: number[]; inputDelay: number; startAt: number; rttMs: number[] }
  /** A rejoin mid-match: the match's parameters, followed by one binary replay frame with `frames` entries. */
  | { type: 'resume'; seed: number; winsToWin: number; players: number; seats: number[]; inputDelay: number; rttMs: number[]; frames: number }
  /** Every second; `pingMs` is the relay's current estimate of the latency between the players (null until both have answered). */
  | { type: 'ping'; t: number; pingMs: number | null }
  | { type: 'desync'; tick: number }
  /** A seat's connection dropped mid-match. `deadline`: when it forfeits (two-player rooms); null when its snake just coasts on. */
  | { type: 'seatAway'; seat: number; deadline: number | null }
  | { type: 'seatBack'; seat: number }
  /** Two-player rooms: the other player left or timed out, so `winner` takes the match. */
  | { type: 'forfeit'; winner: number; reason: 'left' | 'timeout' }
  /** Larger rooms: everyone else is gone, so `winner` (you) takes the match. */
  | { type: 'ended'; winner: number; reason: 'left' | 'timeout' }
  /** A seat emptied (in the lobby, or by leaving mid-match in a larger room). */
  | { type: 'seatLeft'; seat: number }
  | { type: 'closed'; reason: CloseReason }
  | { type: 'error'; code: ErrorCode; message: string };

export const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'create',
  'join',
  'queue',
  'leaveQueue',
  'ready',
  'pong',
  'hash',
  'away',
  'back',
  'leave',
]);

/** Structural check for a parsed JSON value; field types are validated where they're used. */
export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    CLIENT_MESSAGE_TYPES.has((value as { type: string }).type)
  );
}
