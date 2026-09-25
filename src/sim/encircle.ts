import { forEachSolidPointNear } from './collision';
import type { Config } from './config';
import { decimatePolygon, LOOP_EVENT_POINTS, pointInPolygon } from './geometry';
import { collectInLoop } from './pickups';
import { headCum } from './trail';
import type { DeathRecord, MatchState, SimEvent } from './types';

/** A wormhole jump between `from` and the head: the "loop" would include a chord across the map. */
export function spansJump(solid: readonly boolean[], from: number): boolean {
  for (let k = from; k < solid.length; k++) if (!solid[k]) return true;
  return false;
}

/**
 * Encirclement (hunt rules): when a head crosses its own trail, the loop it just closed is tested
 * once. Every other live, non-Ghost head inside it is hit with cause `encircled`, and (with
 * collectByLoop) every pickup inside it is taken. `crossing` remembers that the head is touching
 * its trail, so skimming along your own body doesn't close a new loop every tick. Returns the hits
 * for the caller to resolve with the collision hits.
 */
export function detectEncirclements(state: MatchState, cfg: Config, events: SimEvent[]): DeathRecord[] {
  const hits: DeathRecord[] = [];
  const touch = 2 * cfg.snakeRadius;
  const caught = new Set<number>();
  state.snakes.forEach((me, i) => {
    if (!me.alive) return;
    const trail = me.trail;
    const newestAllowed = headCum(trail) - cfg.loopIgnore;
    let oldest = -1;
    forEachSolidPointNear(state, me.x, me.y, touch, (snake, index) => {
      if (snake !== i || trail.cum[index] >= newestAllowed) return;
      if (oldest < 0 || index < oldest) oldest = index;
    });
    const touching = oldest >= 0;
    if (touching && !me.crossing && !spansJump(trail.solid, oldest)) {
      const poly: number[] = [];
      for (let k = oldest; k < trail.xs.length; k++) poly.push(trail.xs[k], trail.ys[k]);
      poly.push(me.x, me.y);
      state.snakes.forEach((other, j) => {
        if (j === i || !other.alive || other.effects.ghost > 0 || caught.has(j)) return;
        if (!pointInPolygon(other.x, other.y, poly)) return;
        caught.add(j);
        hits.push({ player: j, cause: 'encircled', killer: i, x: other.x, y: other.y });
        events.push({ type: 'encircled', player: j, by: i, loop: decimatePolygon(poly, LOOP_EVENT_POINTS) });
      });
      if (cfg.collectByLoop) collectInLoop(state, cfg, i, poly, events);
    }
    me.crossing = touching;
  });
  return hits;
}
