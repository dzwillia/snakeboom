import type { DeathRecord, ItemState } from '../sim';
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
    case 'self':
      return `${victim} hit their own tail`;
    case 'body':
      return `${victim} hit ${killer}'s body`;
    case 'headOn':
      return 'Head-on collision';
    case 'blast':
      return d.killer === d.player ? `${victim} blew themselves up` : `${victim} got blasted by ${killer}`;
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
  return { title, detail: winner === null ? 'Time ran out' : `Time's up · ${names[winner]} had more hearts` };
}

/** HUD label for an item slot; empty string when the slot is empty. */
export function describeItem(item: ItemState | null): string {
  if (!item) return '';
  switch (item.kind) {
    case 'bomb':
      return `BOMB ×${item.charges}`;
    case 'ghost':
      return 'GHOST';
    case 'shield':
      return 'SHIELD';
    case 'turbo':
      return 'TURBO';
    case 'slow':
      return 'SLOW';
    case 'reverse':
      return 'REVERSE';
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
