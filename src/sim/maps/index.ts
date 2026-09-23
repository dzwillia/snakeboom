import { open } from './open';
import { parseMap, type MapDef, type ParsedMap } from './parse';

export const MAP_DEFS: MapDef[] = [open];
export const MAPS: ParsedMap[] = MAP_DEFS.map(parseMap);
