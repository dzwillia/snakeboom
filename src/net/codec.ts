import type { PlayerInput } from '../sim';

/** client → relay: [FRAME_INPUT, tick u32 LE, input u8] */
export const FRAME_INPUT = 1;
/** relay → client: [FRAME_RELAYED, player u8, tick u32 LE, input u8] */
export const FRAME_RELAYED = 2;
export const INPUT_FRAME_BYTES = 6;
export const RELAYED_FRAME_BYTES = 7;

const TURN_CODES: Record<-1 | 0 | 1, number> = { 0: 0, 1: 1, [-1]: 2 };
const MAX_TICK = 0xffffffff;

/** Bits 0–1: turn (0 straight, 1 right, 2 left). Bit 2: boost. Bit 3: use. */
export function packInput(input: PlayerInput): number {
  return TURN_CODES[input.turn] | (input.boost ? 4 : 0) | (input.use ? 8 : 0);
}

/** Inverse of packInput; a turn code of 3 gives null. */
export function unpackInput(byte: number): PlayerInput | null {
  const code = byte & 3;
  if (code === 3 || byte > 15 || byte < 0 || !Number.isInteger(byte)) return null;
  return { turn: code === 0 ? 0 : code === 1 ? 1 : -1, boost: (byte & 4) !== 0, use: (byte & 8) !== 0 };
}

function writeTick(out: Uint8Array, at: number, tick: number): void {
  out[at] = tick & 0xff;
  out[at + 1] = (tick >>> 8) & 0xff;
  out[at + 2] = (tick >>> 16) & 0xff;
  out[at + 3] = (tick >>> 24) & 0xff;
}

function readTick(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function validTick(tick: number): boolean {
  return Number.isInteger(tick) && tick >= 0 && tick <= MAX_TICK;
}

export function encodeInput(tick: number, input: PlayerInput): Uint8Array {
  if (!validTick(tick)) throw new RangeError(`tick out of range: ${tick}`);
  const out = new Uint8Array(INPUT_FRAME_BYTES);
  out[0] = FRAME_INPUT;
  writeTick(out, 1, tick);
  out[5] = packInput(input);
  return out;
}

export function decodeInput(bytes: Uint8Array): { tick: number; input: PlayerInput } | null {
  if (bytes.length !== INPUT_FRAME_BYTES || bytes[0] !== FRAME_INPUT) return null;
  const input = unpackInput(bytes[5]);
  return input ? { tick: readTick(bytes, 1), input } : null;
}

export function encodeRelayed(player: number, tick: number, input: PlayerInput): Uint8Array {
  if (!validTick(tick)) throw new RangeError(`tick out of range: ${tick}`);
  if (player !== 0 && player !== 1) throw new RangeError(`player out of range: ${player}`);
  const out = new Uint8Array(RELAYED_FRAME_BYTES);
  out[0] = FRAME_RELAYED;
  out[1] = player;
  writeTick(out, 2, tick);
  out[6] = packInput(input);
  return out;
}

export function decodeRelayed(bytes: Uint8Array): { player: number; tick: number; input: PlayerInput } | null {
  if (bytes.length !== RELAYED_FRAME_BYTES || bytes[0] !== FRAME_RELAYED || bytes[1] > 1) return null;
  const input = unpackInput(bytes[6]);
  return input ? { player: bytes[1], tick: readTick(bytes, 2), input } : null;
}
