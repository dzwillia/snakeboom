import { describe, expect, it } from 'vitest';
import type { DeathCause, DeathRecord } from '../sim';
import { describeDeath, describeItem, describeRound, formatClock } from './text';

const d = (player: number, cause: DeathCause, killer: number | null): DeathRecord => ({ player, cause, killer, x: 0, y: 0 });

describe('text', () => {
  it('describes every cause of death', () => {
    expect(describeDeath(d(1, 'body', 0))).toBe("PINK hit CYAN's body");
    expect(describeDeath(d(0, 'self', 0))).toBe('CYAN hit their own tail');
    expect(describeDeath(d(0, 'wall', null))).toBe('CYAN hit the wall');
    expect(describeDeath(d(1, 'obstacle', null))).toBe('PINK crashed into a block');
    expect(describeDeath(d(0, 'blast', 0))).toBe('CYAN blew themselves up');
    expect(describeDeath(d(0, 'blast', 1))).toBe('CYAN got blasted by PINK');
    expect(describeDeath(d(0, 'headOn', 1))).toBe('Head-on collision');
  });

  it('titles the round and merges duplicate lines', () => {
    expect(describeRound(0, [d(1, 'wall', null)])).toEqual({ title: 'CYAN SCORES', detail: 'PINK hit the wall' });
    expect(describeRound(null, [d(0, 'headOn', 1), d(1, 'headOn', 0)])).toEqual({ title: 'DRAW', detail: 'Head-on collision' });
    expect(describeRound(null, [d(0, 'wall', null), d(1, 'wall', null)]).detail).toBe('CYAN hit the wall · PINK hit the wall');
    expect(describeRound(null, [])).toEqual({ title: 'DRAW', detail: 'Time ran out' });
  });

  it('labels held items for the HUD', () => {
    expect(describeItem(null)).toBe('');
    expect(describeItem({ kind: 'bomb', charges: 3 })).toBe('BOMB ×3');
  });

  it('formats the round clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(61 * 60)).toBe('1:01');
    expect(formatClock(150 * 60 + 59)).toBe('2:30');
  });
});
