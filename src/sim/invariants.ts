import { circleHitsWall } from './arena';
import type { Config } from './config';
import { trailLength } from './trail';
import type { MatchState } from './types';

/** Describes anything impossible in `state`; an empty list means healthy. */
export function checkInvariants(state: MatchState, cfg: Config): string[] {
  const problems: string[] = [];
  state.snakes.forEach((s, i) => {
    const values: Array<[string, number]> = [
      ['x', s.x],
      ['y', s.y],
      ['heading', s.heading],
      ['targetLength', s.targetLength],
      ['boostMeter', s.boostMeter],
    ];
    for (const [name, v] of values) if (!Number.isFinite(v)) problems.push(`snake ${i}: ${name} is ${v}`);
    if (s.boostMeter < 0 || s.boostMeter > 1) problems.push(`snake ${i}: boostMeter ${s.boostMeter} outside 0..1`);
    if (s.alive && circleHitsWall(s.x, s.y, cfg.snakeRadius)) problems.push(`snake ${i}: alive outside the arena`);
    const t = s.trail;
    if (t.ys.length !== t.xs.length || t.cum.length !== t.xs.length || t.solid.length !== t.xs.length) {
      problems.push(`snake ${i}: trail arrays out of sync`);
    }
    if (t.start < 0 || t.start >= t.xs.length) problems.push(`snake ${i}: trail start ${t.start} out of range`);
    const len = trailLength(t);
    if (len > Math.max(0, s.targetLength) + 1e-6) problems.push(`snake ${i}: trail ${len} longer than ${s.targetLength}`);
  });
  const points = state.scores.reduce((a, b) => a + b, 0);
  if (points > state.round) problems.push(`${points} points after ${state.round} rounds`);
  return problems;
}
