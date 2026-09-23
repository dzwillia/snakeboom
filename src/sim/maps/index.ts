import { bunkers } from './bunkers';
import { cross } from './cross';
import { lanes } from './lanes';
import { open } from './open';
import { parseMap, type MapDef, type ParsedMap } from './parse';
import { pillars } from './pillars';

/** Round 1 is always Open (index 0); later rounds shuffle through all of them. */
export const MAP_DEFS: MapDef[] = [open, pillars, cross, bunkers, lanes];
export const MAPS: ParsedMap[] = MAP_DEFS.map(parseMap);
