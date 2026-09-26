import { forEachSolidPointNear } from './collision';
import type { Config } from './config';
import { detAtan2, wrapAngle } from './detmath';
import { cutTrail } from './scissors';
import type { MatchState, SimEvent, SnakeState } from './types';

/** True when (x, y) is inside `s`'s cone of fire: within flameRange (+ `pad`) and flameSpread of its heading. */
export function inCone(s: SnakeState, cfg: Config, x: number, y: number, pad = 0): boolean {
  const dx = x - s.x;
  const dy = y - s.y;
  const reach = cfg.flameRange + pad;
  if (dx * dx + dy * dy > reach * reach) return false;
  return Math.abs(wrapAngle(detAtan2(dy, dx) - s.heading)) <= cfg.flameSpread;
}

/**
 * Flamethrowers: every burning head cuts opponents' bodies in its cone (at the newest burning
 * point, exactly as Scissors cut), burns up opponents' missiles in it, and marks opponents'
 * heads in it, which the caller resolves as hits with cause `flame` (victim → flamer). Runs after
 * movement and before collisions. Fire never touches the flamer's own body or missiles.
 */
export function applyFlames(state: MatchState, cfg: Config, events: SimEvent[]): Map<number, number> {
  const torched = new Map<number, number>();
  const r = cfg.snakeRadius;
  state.snakes.forEach((me, i) => {
    if (!me.alive || me.effects.flame <= 0) return;
    state.snakes.forEach((victim, j) => {
      if (j === i || !victim.alive) return;
      if (!torched.has(j) && inCone(me, cfg, victim.x, victim.y, r)) torched.set(j, i);
      let newest = -1;
      forEachSolidPointNear(state, me.x, me.y, cfg.flameRange + r, (snake, index) => {
        if (snake !== j || index <= newest) return;
        const t = victim.trail;
        if (inCone(me, cfg, t.xs[index], t.ys[index], r)) newest = index;
      });
      if (newest >= 0) cutTrail(state, j, newest, i, me.x, me.y, cfg, events);
    });
    if (state.missiles.some((m) => m.owner !== i && inCone(me, cfg, m.x, m.y, cfg.missileRadius))) {
      state.missiles = state.missiles.filter((m) => {
        if (m.owner === i || !inCone(me, cfg, m.x, m.y, cfg.missileRadius)) return true;
        events.push({ type: 'missileFizzled', id: m.id, x: m.x, y: m.y });
        return false;
      });
    }
  });
  return torched;
}
