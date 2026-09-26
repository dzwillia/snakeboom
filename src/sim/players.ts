import type { Config } from './config';

/** The most seats a match can have. */
export const MAX_PLAYERS = 8;

export function clampPlayers(n: number): number {
  return Math.min(MAX_PLAYERS, Math.max(2, Math.round(Number.isFinite(n) ? n : 2)));
}

/** Seconds a round may run before the border crushes: longer with more players, up to the cap. */
export function roundCapSeconds(cfg: Config, players: number): number {
  const extra = Math.max(0, players - 2) * Math.max(0, cfg.roundSecondsPerExtraPlayer);
  return Math.min(Math.max(cfg.roundMaxSeconds, 1), Math.max(cfg.roundMaxSeconds, cfg.roundMaxSecondsCap)) === cfg.roundMaxSeconds
    ? Math.min(cfg.roundMaxSeconds + extra, Math.max(cfg.roundMaxSeconds, cfg.roundMaxSecondsCap))
    : cfg.roundMaxSeconds;
}

/** Pickups on the field scale with the players: the two-player number per pair, capped at 40. */
export function maxPickupsFor(cfg: Config, players: number): number {
  return Math.min(40, Math.round((Math.max(0, cfg.maxPickups) * Math.max(2, players)) / 2));
}

/** Pickups spawn faster with more players: the two-player interval shared out. */
export function pickupIntervalFor(cfg: Config, players: number): number {
  return (Math.max(0, cfg.pickupInterval) * 2) / Math.max(2, players);
}

/** Points that win the match: FIRST TO n means n round wins' worth, whatever the room size. */
export function matchTarget(cfg: Config, players: number): number {
  return Math.max(1, Math.round(cfg.winsToWin)) * Math.max(1, players - 1);
}

/** Points for finishing in `place` (1 = last standing) among `players`: N−1 down to 0. */
export function placePoints(players: number, place: number): number {
  return Math.max(0, players - place);
}

/**
 * Places from a round's deaths, in the order they happened (`tick` per death) and the survivors:
 * the survivor (at most one) is place 1; players who died on the same tick share a place; and when
 * the last players standing die together nobody takes place 1, they all score as place 2 (so a
 * two-player draw scores nothing). Returns one place per player.
 */
export function placesFor(players: number, deaths: readonly { player: number; tick: number }[], alive: readonly boolean[]): number[] {
  const places = new Array<number>(players).fill(0);
  const survivors: number[] = [];
  for (let i = 0; i < players; i++) if (alive[i]) survivors.push(i);
  // Group deaths by tick, latest group first: the later you die, the better your place.
  const byTick = new Map<number, number[]>();
  for (const d of deaths) {
    const group = byTick.get(d.tick);
    if (group) group.push(d.player);
    else byTick.set(d.tick, [d.player]);
  }
  const ticks = [...byTick.keys()].sort((a, b) => b - a);
  let place = 1;
  for (const s of survivors) places[s] = place;
  place += survivors.length;
  for (const t of ticks) {
    const group = byTick.get(t)!;
    const shared = place === 1 && group.length > 1 ? 2 : place;
    for (const p of group) places[p] = shared;
    place += group.length;
  }
  return places;
}
