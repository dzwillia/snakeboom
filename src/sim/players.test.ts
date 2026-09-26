import { describe, expect, it } from 'vitest';
import { setTile, tileSolid } from './arena';
import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, TICK_RATE, TILE_COLS, type Config } from './config';
import { checkInvariants } from './invariants';
import { botInput, createBot } from './bots/simple-bot';
import { ringSpawns } from './maps/spawns';
import { clampPlayers, matchTarget, maxPickupsFor, pickupIntervalFor, placePoints, placesFor, roundCapSeconds } from './players';
import { createMatch } from './state';
import { rematch, step } from './step';
import { NO_INPUT, type MatchState, type PlayerInput, type SimEvent } from './types';

const cfg: Config = { ...DEFAULT_CONFIG, countdownSeconds: 1, roundOverSeconds: 1 };

function playing(players: number, seed = 5, c: Config = cfg): MatchState {
  const s = createMatch(c, seed, players);
  s.phase = 'playing';
  s.phaseTicks = 0;
  return s;
}

/** Kills `player` on the current tick by a wall hit (its record is what matters here). */
function kill(s: MatchState, player: number, tick: number): void {
  const sn = s.snakes[player];
  sn.alive = false;
  sn.hearts = 0;
  s.deaths.push({ player, cause: 'wall', killer: null, x: sn.x, y: sn.y, tick });
}

describe('players', () => {
  it('clamps the count to 2–8', () => {
    expect(clampPlayers(1)).toBe(2);
    expect(clampPlayers(8)).toBe(8);
    expect(clampPlayers(9)).toBe(8);
    expect(clampPlayers(NaN)).toBe(2);
  });

  it('scales the round cap, the pickups and the match target with the count', () => {
    expect(roundCapSeconds(cfg, 2)).toBe(45);
    expect(roundCapSeconds(cfg, 4)).toBe(65);
    expect(roundCapSeconds(cfg, 8)).toBe(90);
    expect(maxPickupsFor(cfg, 2)).toBe(cfg.maxPickups);
    expect(maxPickupsFor(cfg, 8)).toBe(Math.min(40, cfg.maxPickups * 4));
    expect(pickupIntervalFor(cfg, 2)).toBe(cfg.pickupInterval);
    expect(pickupIntervalFor(cfg, 4)).toBeCloseTo(cfg.pickupInterval / 2, 9);
    expect(matchTarget(cfg, 2)).toBe(cfg.winsToWin);
    expect(matchTarget(cfg, 8)).toBe(cfg.winsToWin * 7);
  });

  it('gives places by death order, shares a place on the same tick, and scores N−1 down to 0', () => {
    // Eight players: 3 and 5 die together first, then 0, then 7; 1 survives; 2, 4 and 6 are still alive too? No: only one survivor.
    const deaths = [
      { player: 3, tick: 100 },
      { player: 5, tick: 100 },
      { player: 0, tick: 200 },
      { player: 7, tick: 300 },
      { player: 2, tick: 400 },
      { player: 4, tick: 400 },
      { player: 6, tick: 500 },
    ];
    const alive = [false, true, false, false, false, false, false, false];
    const places = placesFor(8, deaths, alive);
    expect(places).toEqual([6, 1, 3, 7, 3, 7, 2, 5]);
    expect(places.map((p) => placePoints(8, p))).toEqual([2, 7, 5, 1, 5, 1, 6, 3]);
    // Two players, a draw: both died together, nobody takes place 1, both score as place 2 (nothing).
    expect(placesFor(2, [{ player: 0, tick: 9 }, { player: 1, tick: 9 }], [false, false])).toEqual([2, 2]);
    expect(placePoints(2, 2)).toBe(0);
    // A two-player round with a survivor is one point, as always.
    expect(placesFor(2, [{ player: 1, tick: 9 }], [true, false])).toEqual([1, 2]);
    expect(placePoints(2, 1)).toBe(1);
  });

  it('spawns more than two on a ring facing the centre, clear of blocks, and two on the map as before', () => {
    const ring = ringSpawns(8);
    expect(ring).toHaveLength(8);
    for (const sp of ring) {
      expect(sp.x).toBeGreaterThan(200);
      expect(sp.x).toBeLessThan(ARENA_WIDTH - 200);
      expect(sp.y).toBeGreaterThan(150);
      expect(sp.y).toBeLessThan(ARENA_HEIGHT - 150);
      // Heading points at the middle.
      const toCentre = Math.atan2(ARENA_HEIGHT / 2 - sp.y, ARENA_WIDTH / 2 - sp.x);
      expect(Math.abs(Math.atan2(Math.sin(sp.heading - toCentre), Math.cos(sp.heading - toCentre)))).toBeLessThan(1e-6);
    }
    // Neighbours are well apart.
    for (let i = 0; i < 8; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 8];
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(400);
    }
    const two = createMatch(cfg, 5, 2);
    expect(two.snakes.map((s) => [s.x, s.y])).toEqual(createMatch(cfg, 5).snakes.map((s) => [s.x, s.y]));

    // Pillars (map 1) has blocks; with eight players any block near a spawn is cleared for the round.
    const many = createMatch(cfg, 5, 8);
    many.mapIndex = 1;
    many.round = 2;
    const c = { ...cfg, maps: 'handmade' as const };
    // Force the round to load Pillars with a block dropped right on a spawn.
    const s = createMatch(c, 5, 8);
    const sp = s.snakes[0];
    setTile(s.tiles, Math.floor(sp.x / 20), Math.floor(sp.y / 20), true);
    expect(tileSolid(s.tiles, Math.floor(sp.x / 20), Math.floor(sp.y / 20))).toBe(true);
    rematch(s, c, 6);
    const again = s.snakes[0];
    expect(tileSolid(s.tiles, Math.floor(again.x / 20), Math.floor(again.y / 20))).toBe(false);
    expect(s.tiles.length).toBe(TILE_COLS * 100);
  });

  it('ends a round when one or none are left, awards placement points, and ends the match on a unique leader past the target', () => {
    const c: Config = { ...cfg, winsToWin: 1 };
    const s = playing(4, 5, c);
    s.roundTicks = 10;
    kill(s, 2, 10);
    let events: SimEvent[] = step(s, [NO_INPUT, NO_INPUT, NO_INPUT, NO_INPUT], c);
    expect(events.some((e) => e.type === 'roundOver')).toBe(false);
    kill(s, 0, s.roundTicks);
    kill(s, 3, s.roundTicks);
    events = step(s, [NO_INPUT, NO_INPUT, NO_INPUT, NO_INPUT], c);
    const over = events.find((e) => e.type === 'roundOver');
    expect(over).toMatchObject({ type: 'roundOver', winner: 1, places: [2, 1, 4, 2] });
    // 1 survived (3 points), 0 and 3 tied for second (2 each), 2 first out (0).
    expect(s.scores).toEqual([2, 3, 0, 2]);
    expect(s.lastPlaces).toEqual([2, 1, 4, 2]);
    // First to 1 with four players is 3 points: player 1 has them and leads alone.
    expect(s.matchWinner).toBe(1);
    expect(checkInvariants(s, c)).toEqual([]);
  });

  it('plays another round when the players past the target are tied', () => {
    const c: Config = { ...cfg, winsToWin: 1 };
    const s = playing(3, 5, c);
    s.scores = [2, 2, 0];
    // Everyone dies together: all score as place 2 → 1 point each; 0 and 1 stay tied at 3.
    s.roundTicks = 10;
    kill(s, 0, 10);
    kill(s, 1, 10);
    kill(s, 2, 10);
    const events = step(s, [NO_INPUT, NO_INPUT, NO_INPUT], c);
    expect(events.find((e) => e.type === 'roundOver')).toMatchObject({ winner: null, places: [2, 2, 2] });
    expect(s.scores).toEqual([3, 3, 1]);
    expect(s.matchWinner).toBeNull();
  });

  it('keeps two-player rounds exactly as before: a point to the survivor, none for a draw', () => {
    const s = playing(2);
    s.roundTicks = 10;
    kill(s, 1, 10);
    step(s, [NO_INPUT, NO_INPUT], cfg);
    expect(s.scores).toEqual([1, 0]);
    expect(s.lastRoundWinner).toBe(0);
  });

  it('runs eight simple bots for a few rounds without breaking an invariant', () => {
    const c: Config = { ...cfg, roundMaxSeconds: 30 };
    const s = createMatch(c, 11, 8);
    const bots = Array.from({ length: 8 }, (_, i) => createBot(100 + i));
    const problems: string[] = [];
    let rounds = 0;
    const limit = 3 * Math.round((roundCapSeconds(c, 8) + 12) * TICK_RATE);
    for (let t = 0; t < limit && rounds < 3; t++) {
      const inputs: PlayerInput[] = bots.map((b, i) => botInput(b, s, i, c));
      const events = step(s, inputs, c);
      if (events.some((e) => e.type === 'roundOver')) rounds++;
      if (events.length > 0 || t % 97 === 0) problems.push(...checkInvariants(s, c));
      if (s.phase === 'matchOver') rematch(s, c, 12 + t);
    }
    expect(problems).toEqual([]);
    expect(rounds).toBe(3);
    expect(s.scores).toHaveLength(8);
    expect(Math.max(...s.scores)).toBeGreaterThan(0);
  });
});
