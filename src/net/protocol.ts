/**
 * Messages between the client and the relay. Control messages are JSON text frames; per-tick
 * inputs are binary frames (see codec.ts). Times are milliseconds on the relay's clock.
 */

/** Bumped on every incompatible change; the relay refuses other values. */
export const PROTOCOL = 1;

export interface RoundResult {
  round: number;
  winner: number | null;
  scores: number[];
  matchWinner: number | null;
}

export type ClientMessage =
  | { type: 'hello'; protocol: number; version: string; name: string; session?: string; fromTick?: number }
  | { type: 'create'; winsToWin: number }
  | { type: 'join'; room: string }
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
export type ErrorCode = 'version' | 'badMessage' | 'busy' | 'notInRoom';

export type ServerMessage =
  | { type: 'welcome'; player: number; room: string; session: string; name: string }
  | { type: 'lobby'; players: (LobbyPlayer | null)[]; winsToWin: number; pingMs: number | null }
  | { type: 'start'; seed: number; winsToWin: number; inputDelay: number; startAt: number; rttMs: number[] }
  | { type: 'ping'; t: number }
  | { type: 'desync'; tick: number }
  | { type: 'peerAway'; deadline: number }
  | { type: 'peerBack' }
  | { type: 'forfeit'; winner: number; reason: 'left' | 'timeout' }
  | { type: 'peerLeft' }
  | { type: 'closed'; reason: CloseReason }
  | { type: 'error'; code: ErrorCode; message: string };

export const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'create',
  'join',
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
