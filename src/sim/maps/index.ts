import type { MapMode } from '../config';
import { bunkers } from './bunkers';
import { cross } from './cross';
import { lanes } from './lanes';
import { open } from './open';
import { parseMap, type MapDef, type ParsedMap } from './parse';
import { pillars } from './pillars';

/** Round 1 is always Open (index 0); later rounds shuffle through all of them. */
export const MAP_DEFS: MapDef[] = [open, pillars, cross, bunkers, lanes];
export const MAPS: ParsedMap[] = MAP_DEFS.map(parseMap);

/** Random slots in a 'both' bag: each one generates a fresh layout when it comes up. */
export const RANDOM_SLOTS = 3;

/** What a map index in the bag stands for. */
export type MapEntry = { kind: 'handmade'; index: number } | { kind: 'random' };

/**
 * The maps the bag deals under a `maps` setting, in index order: the hand-made maps first (so
 * index 0 is Open for 'handmade' and 'both'), then the random slots. An unknown setting (from an
 * edited saved config) counts as 'both'.
 */
export function mapCatalogue(mode: MapMode): MapEntry[] {
  const handmade: MapEntry[] = MAPS.map((_, index) => ({ kind: 'handmade', index }));
  const random: MapEntry[] = Array.from({ length: RANDOM_SLOTS }, () => ({ kind: 'random' }));
  if (mode === 'handmade') return handmade;
  if (mode === 'random') return random;
  return [...handmade, ...random];
}

export { generateMap, type GeneratedMap, type GenerateOptions } from './generate';
export type { ParsedMap, Spawn } from './parse';
