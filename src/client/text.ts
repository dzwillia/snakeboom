import { PLOW_PUSH_LIMIT, type Config, type DeathRecord, type ItemState, type PickupKind } from '../sim';
import { OPPONENT_MODES, type OpponentMode } from './settings';

export const PLAYER_NAMES: readonly string[] = ['CYAN', 'PINK'];

/** The title screen's opponent selector: HUMAN, then the AI difficulties, wrapping around. */
export function nextOpponent(current: OpponentMode, delta: number): OpponentMode {
  const n = OPPONENT_MODES.length;
  const i = Math.max(0, OPPONENT_MODES.indexOf(current));
  return OPPONENT_MODES[(((i + delta) % n) + n) % n];
}

export function describeOpponent(mode: OpponentMode): string {
  return mode === 'human' ? 'HUMAN' : `AI · ${mode.toUpperCase()}`;
}

export function describeDeath(d: DeathRecord, names: readonly string[] = PLAYER_NAMES): string {
  const victim = names[d.player];
  const killer = d.killer === null ? '' : names[d.killer];
  switch (d.cause) {
    case 'wall':
      return `${victim} hit the wall`;
    case 'obstacle':
      return `${victim} crashed into a block`;
    case 'body':
      return `${victim} hit ${killer}'s body`;
    case 'headOn':
      return 'Head-on collision';
    case 'missile':
      return `${victim} was shot down by ${killer}`;
  }
}

export function describeRound(
  winner: number | null,
  deaths: readonly DeathRecord[],
  names: readonly string[] = PLAYER_NAMES,
): { title: string; detail: string } {
  const title = winner === null ? 'DRAW' : `${names[winner]} SCORES`;
  const lines: string[] = [];
  for (const d of deaths) {
    const line = describeDeath(d, names);
    if (!lines.includes(line)) lines.push(line);
  }
  if (lines.length > 0) return { title, detail: lines.join(' · ') };
  return { title, detail: winner === null ? 'Nobody survived' : `${names[winner]} outlasted the border` };
}

/** The order the Powers page lists pickups in: the same as the title screen's line. */
export const POWER_ORDER: readonly PickupKind[] = ['missile', 'ghost', 'shield', 'dozer'];

export interface PowerInfo {
  name: string;
  /** Live numbers from the config, like "×3 per pickup · 2.5 s of flight". */
  stats: string;
  /** What it does, in a sentence or two. */
  detail: string;
}

/** Trims trailing zeros: 1 → "1", 0.45 → "0.45". */
function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function secs(v: number): string {
  return `${num(v)} s`;
}

/** The spawn share of a kind, as a percentage of all pickup weights. */
export function spawnShare(kind: PickupKind, cfg: Config): number {
  const total = Object.values(cfg.pickupWeights).reduce((a, b) => a + b, 0);
  return total > 0 ? Math.round((100 * cfg.pickupWeights[kind]) / total) : 0;
}

/** Everything a player needs to know about one pickup, with the current tuning filled in. */
export function describePower(kind: PickupKind, cfg: Config): PowerInfo {
  const share = `${spawnShare(kind, cfg)}% of spawns`;
  switch (kind) {
    case 'missile':
      return {
        name: 'MISSILE',
        stats: `×${num(cfg.missileCharges)} per pickup · ${secs(cfg.missileLife)} of flight · ${share}`,
        detail:
          `Fires from your head and homes on your opponent for ${secs(cfg.missileLife)}. It turns, but not on a dime: ` +
          `a hard cut or a Ghost dodges it, a Shield eats it, and it never hits you. One shot every ${secs(cfg.missileCooldown)}.`,
      };
    case 'ghost':
      return {
        name: 'GHOST',
        stats: `${secs(cfg.ghostDuration)} · ${share}`,
        detail: `Your head slips through bodies, heads and blocks, and a closing loop can't catch you. Walls and missiles still hit you.`,
      };
    case 'shield':
      return {
        name: 'SHIELD',
        stats: `one hit · ${secs(cfg.shieldGrace)} grace · ${share}`,
        detail:
          `A bubble that takes your next hit so you keep the heart, then a moment of grace to get clear. ` +
          `It goes up the moment you collect it, stays until it takes a hit, never takes an item slot, and you can't carry two.`,
      };
    case 'dozer':
      return {
        name: 'BULLDOZER',
        stats: `${secs(cfg.dozerDuration)} · pushes rows up to ${PLOW_PUSH_LIMIT} blocks · ${share}`,
        detail:
          `A plow on your head shoves blocks ahead of you, straight into your opponent if you aim well. ` +
          `Rows too long to push, or pinned against the edge, get crushed instead. Blocks can't hurt you while it lasts.`,
      };
  }
}

/** HUD label for an item slot; empty string when the slot is empty. */
export function describeItem(item: ItemState | null): string {
  if (!item) return '';
  switch (item.kind) {
    case 'missile':
      return `MISSILE ×${item.charges}`;
    case 'ghost':
      return 'GHOST';
    case 'shield':
      return 'SHIELD';
    case 'dozer':
      return 'DOZER';
  }
}

/** The title screen's first-to-N selector: one step at a time, clamped to 1–10. */
export function nextWins(current: number, delta: number): number {
  return Math.min(10, Math.max(1, Math.round(current) + delta));
}

export function formatClock(ticks: number, tickRate = 60): string {
  const seconds = Math.floor(ticks / tickRate);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
