import { forEachSolidPointNear } from './collision';
import type { Config } from './config';
import { decimatePolygon } from './geometry';
import { shedOverflow } from './storage';
import { trailLength } from './trail';
import type { MatchState, SimEvent } from './types';

const CUT_POINTS_FOR_EVENT = 48;

/**
 * Scissors: while the effect runs, a head crossing an opponent's body cuts it. Everything from
 * the newest touched point back to the tail is dropped (the trail's start moves past it and the
 * target length shrinks to what is left), so the victim loses length, boost fuel and any loop in
 * progress. Runs after movement and before collisions, so the cutter passes through instead of dying.
 */
export function applyScissors(state: MatchState, cfg: Config, events: SimEvent[]): void {
  const touch = 2 * cfg.snakeRadius;
  state.snakes.forEach((me, i) => {
    if (!me.alive || me.effects.scissors <= 0) return;
    state.snakes.forEach((victim, j) => {
      if (j === i || !victim.alive) return;
      let newest = -1;
      forEachSolidPointNear(state, me.x, me.y, touch, (snake, index) => {
        if (snake === j && index > newest) newest = index;
      });
      if (newest < 0) return;
      cutTrail(state, j, newest, i, me.x, me.y, cfg, events);
    });
  });
}

/**
 * Cuts `victim`'s body at trail index `newest`: everything from there back to the tail is dropped
 * and the target length shrinks to what is left. Never cuts the head off (the newest point is the
 * head itself, and touching it is a head hit). `by` is the cutter, or -1 for the saw.
 * Length is storage, so the items that no longer fit fall off too, as pickups along the dropped segment.
 */
export function cutTrail(
  state: MatchState,
  victim: number,
  newest: number,
  by: number,
  x: number,
  y: number,
  cfg: Config,
  events: SimEvent[],
): boolean {
  const s = state.snakes[victim];
  const trail = s.trail;
  const last = trail.xs.length - 1;
  if (newest >= last) return false;
  const before = trailLength(trail);
  const dropped: number[] = [];
  for (let k = trail.start; k <= newest; k++) dropped.push(trail.xs[k], trail.ys[k]);
  trail.start = newest + 1;
  s.targetLength = Math.max(0, trailLength(trail));
  s.holeVersion++;
  events.push({ type: 'cut', player: victim, by, x, y, dropped: before - s.targetLength, segment: decimatePolygon(dropped, CUT_POINTS_FOR_EVENT) });
  shedOverflow(state, victim, dropped, cfg, events, true);
  return true;
}
