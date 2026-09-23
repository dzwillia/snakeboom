// mulberry32: tiny, fast, and deterministic (32-bit integer math only).
// The state is a plain object so it can live inside MatchState and be cloned.

export interface RngState {
  s: number;
}

export function createRng(seed: number): RngState {
  return { s: seed | 0 };
}

/** Returns a float in [0, 1) and advances the state. */
export function rngNext(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) | 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Returns an integer in [0, n). */
export function rngInt(r: RngState, n: number): number {
  return Math.floor(rngNext(r) * n);
}

export function rngRange(r: RngState, min: number, max: number): number {
  return min + (max - min) * rngNext(r);
}

/** Fisher-Yates shuffle, in place. */
export function shuffleInPlace<T>(arr: T[], r: RngState): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rngInt(r, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
