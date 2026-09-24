import type { MatchState } from './types';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over a string's UTF-16 code units. Integer math only, so every engine agrees. */
export function fnv1a(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * Hash of the gameplay state: everything in MatchState except the grid cache. Property order is
 * creation order and both peers build state through createMatch, so identical states serialize
 * identically. JSON number formatting is fully specified, so doubles round-trip the same everywhere.
 */
export function hashState(state: MatchState): number {
  const { grid: _grid, ...rest } = state;
  return fnv1a(JSON.stringify(rest));
}
