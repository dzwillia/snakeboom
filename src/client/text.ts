import type { DeathRecord } from '../sim';

export const PLAYER_NAMES: readonly string[] = ['CYAN', 'PINK'];

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
  return { title, detail: lines.length > 0 ? lines.join(' · ') : 'Time ran out' };
}

export function formatClock(ticks: number, tickRate = 60): string {
  const seconds = Math.floor(ticks / tickRate);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
