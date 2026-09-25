import { describe, expect, it } from 'vitest';
import type { DeathCause, DeathRecord } from '../sim';
import { DEFAULT_CONFIG } from '../sim';
import {
  describeDeath,
  describeItem,
  describeOpponent,
  describePower,
  describeRound,
  formatClock,
  nextOpponent,
  nextWins,
  POWER_ORDER,
  spawnShare,
} from './text';

const d = (player: number, cause: DeathCause, killer: number | null): DeathRecord => ({ player, cause, killer, x: 0, y: 0 });

describe('text', () => {
  it('describes every cause of death', () => {
    expect(describeDeath(d(1, 'body', 0))).toBe("PINK hit CYAN's body");
    expect(describeDeath(d(0, 'wall', null))).toBe('CYAN hit the wall');
    expect(describeDeath(d(1, 'obstacle', null))).toBe('PINK crashed into a block');
    expect(describeDeath(d(0, 'missile', 1))).toBe('CYAN was shot down by PINK');
    expect(describeDeath(d(0, 'headOn', 1))).toBe('Head-on collision');
    expect(describeDeath(d(1, 'saw', null))).toBe('PINK ran into the saw');
    expect(describeDeath(d(1, 'flame', 0))).toBe('PINK was torched by CYAN');
  });

  it('titles the round and merges duplicate lines', () => {
    expect(describeRound(0, [d(1, 'wall', null)])).toEqual({ title: 'CYAN SCORES', detail: 'PINK hit the wall' });
    expect(describeRound(null, [d(0, 'headOn', 1), d(1, 'headOn', 0)])).toEqual({ title: 'DRAW', detail: 'Head-on collision' });
    expect(describeRound(null, [d(0, 'wall', null), d(1, 'wall', null)]).detail).toBe('CYAN hit the wall · PINK hit the wall');
    expect(describeRound(null, [])).toEqual({ title: 'DRAW', detail: 'Nobody survived' });
    expect(describeRound(0, [])).toEqual({ title: 'CYAN SCORES', detail: 'CYAN outlasted the border' });
  });

  it('labels held items for the HUD', () => {
    expect(describeItem(null)).toBe('');
    expect(describeItem({ kind: 'missile', charges: 3 })).toBe('MISSILE ×3');
    expect(describeItem({ kind: 'ghost', charges: 1 })).toBe('GHOST');
    expect(describeItem({ kind: 'shield', charges: 1 })).toBe('SHIELD');
    expect(describeItem({ kind: 'dozer', charges: 1 })).toBe('DOZER');
  });

  // Review Focus 4: the title selector clamps to 1–10.
  it('steps the first-to-N target and clamps it to 1–10', () => {
    expect(nextWins(5, 1)).toBe(6);
    expect(nextWins(5, -1)).toBe(4);
    expect(nextWins(10, 1)).toBe(10);
    expect(nextWins(1, -1)).toBe(1);
    expect(nextWins(3.4, 1)).toBe(4);
  });

  it('cycles the opponent selector through human and every AI level', () => {
    expect(nextOpponent('human', 1)).toBe('easy');
    expect(nextOpponent('easy', 1)).toBe('normal');
    expect(nextOpponent('hard', 1)).toBe('human');
    expect(nextOpponent('human', -1)).toBe('hard');
    expect(describeOpponent('human')).toBe('HUMAN');
    expect(describeOpponent('normal')).toBe('AI · NORMAL');
  });

  it('describes every power with the live tuning numbers', () => {
    const missile = describePower('missile', DEFAULT_CONFIG);
    expect(missile.name).toBe('MISSILE');
    expect(missile.stats).toContain(`×${DEFAULT_CONFIG.missileCharges} per pickup`);
    expect(missile.stats).toContain(`${DEFAULT_CONFIG.missileLife} s of flight`);
    expect(missile.detail).toContain('homes on your opponent');

    const tuned = { ...DEFAULT_CONFIG, ghostDuration: 7.5, dozerDuration: 2.5 };
    expect(describePower('ghost', tuned).stats).toContain('7.5 s');
    expect(describePower('dozer', tuned).stats).toContain('2.5 s');

    for (const kind of POWER_ORDER) {
      const info = describePower(kind, DEFAULT_CONFIG);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.detail.length).toBeGreaterThan(20);
      expect(info.stats).toContain('% of spawns');
    }
  });

  it('turns pickup weights into spawn percentages', () => {
    const cfg = { ...DEFAULT_CONFIG, pickupWeights: { missile: 50, scissors: 0, flame: 0, ghost: 25, shield: 25, dozer: 0 } };
    expect(spawnShare('missile', cfg)).toBe(50);
    expect(spawnShare('dozer', cfg)).toBe(0);
    const none = { ...cfg, pickupWeights: { ...cfg.pickupWeights, missile: 0, ghost: 0, shield: 0 } };
    expect(spawnShare('missile', none)).toBe(0);
  });

  it('formats the round clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(61 * 60)).toBe('1:01');
    expect(formatClock(150 * 60 + 59)).toBe('2:30');
  });
});
