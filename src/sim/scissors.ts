import { forEachSolidPointNear } from './collision';
import type { Config } from './config';
import { decimatePolygon } from './geometry';
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
      const trail = victim.trail;
      let newest = -1;
      forEachSolidPointNear(state, me.x, me.y, touch, (snake, index) => {
        if (snake === j && index > newest) newest = index;
      });
      if (newest < 0) return;
      // Never cut the head off: the newest point is the head itself, and touching it is a head-on.
      const last = trail.xs.length - 1;
      if (newest >= last) return;
      const before = trailLength(trail);
      const dropped: number[] = [];
      for (let k = trail.start; k <= newest; k++) dropped.push(trail.xs[k], trail.ys[k]);
      trail.start = newest + 1;
      victim.targetLength = Math.max(0, trailLength(trail));
      victim.holeVersion++;
      events.push({ type: 'cut', player: j, by: i, x: me.x, y: me.y, dropped: before - victim.targetLength, segment: decimatePolygon(dropped, CUT_POINTS_FOR_EVENT) });
    });
  });
}
