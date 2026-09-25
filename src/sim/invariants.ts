import { circleHitsWall } from './arena';
import type { Config } from './config';
import { slotsFor } from './storage';
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
    ];
    for (const [name, v] of values) if (!Number.isFinite(v)) problems.push(`snake ${i}: ${name} is ${v}`);
    // Grace covers the moving border, so a head may sit in the dead zone for a moment after a deflection.
    const excused = state.inset > 0 && s.effects.grace > 0;
    if (s.alive && !excused && circleHitsWall(s.x, s.y, cfg.snakeRadius, state.inset)) problems.push(`snake ${i}: alive outside the live area`);
    const t = s.trail;
    if (t.ys.length !== t.xs.length || t.cum.length !== t.xs.length || t.solid.length !== t.xs.length) {
      problems.push(`snake ${i}: trail arrays out of sync`);
    }
    if (t.start < 0 || t.start >= t.xs.length) problems.push(`snake ${i}: trail start ${t.start} out of range`);
    const len = trailLength(t);
    if (len > Math.max(0, s.targetLength) + 1e-6) problems.push(`snake ${i}: trail ${len} longer than ${s.targetLength}`);
    const slots = slotsFor(s, cfg);
    if (s.items.length > slots) problems.push(`snake ${i}: carries ${s.items.length} items in ${slots} slots (${len} units of body)`);
    for (const item of s.items) {
      if (item.charges < 1) problems.push(`snake ${i}: carries an empty ${item.kind}`);
      if (item.kind === 'shield') problems.push(`snake ${i}: a Shield is taking a slot`);
    }
    if (!Number.isInteger(s.selected) || s.selected < 0 || s.selected >= Math.max(1, s.items.length)) {
      problems.push(`snake ${i}: selected item ${s.selected} of ${s.items.length}`);
    }
    if (!Number.isInteger(s.hearts) || s.hearts < 0 || s.hearts > Math.max(1, Math.round(cfg.hearts))) {
      problems.push(`snake ${i}: ${s.hearts} hearts`);
    }
    if (s.alive && s.hearts < 1) problems.push(`snake ${i}: alive with no hearts`);
    for (const [name, v] of Object.entries(s.effects)) {
      if (!Number.isInteger(v) || v < 0) problems.push(`snake ${i}: effect ${name} is ${v}`);
    }
    if (!Number.isInteger(s.portalCooldown) || s.portalCooldown < 0) problems.push(`snake ${i}: portal cooldown ${s.portalCooldown}`);
  });
  const points = state.scores.reduce((a, b) => a + b, 0);
  if (points > state.round) problems.push(`${points} points after ${state.round} rounds`);
  // Drops (what a cut or boost shed) don't count: they may take the field past the cap and expire as usual.
  const spawned = state.pickups.filter((p) => !p.dropped).length;
  if (spawned > Math.max(0, cfg.maxPickups)) problems.push(`${spawned} spawned pickups on the field (max ${cfg.maxPickups})`);
  for (const p of state.pickups) {
    if (circleHitsWall(p.x, p.y, 0, state.inset)) problems.push(`pickup ${p.id} outside the live area`);
    if (p.ttl <= 0) problems.push(`pickup ${p.id} outlived its lifetime`);
  }
  for (const m of state.missiles) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.heading)) problems.push(`missile ${m.id} has a non-finite position`);
    if (m.ttl <= 0) problems.push(`missile ${m.id} should have fizzled`);
  }
  if (state.wormholes.length > 1) problems.push(`${state.wormholes.length} wormholes open at once`);
  for (const w of state.wormholes) {
    if (w.ttl <= 0) problems.push(`wormhole ${w.id} outlived its lifetime`);
    if (circleHitsWall(w.x, w.y, 0, state.inset) || circleHitsWall(w.exitX, w.exitY, 0, state.inset)) problems.push(`wormhole ${w.id} outside the live area`);
  }
  if (state.saws.length > 1) problems.push(`${state.saws.length} saws at once`);
  for (const saw of state.saws) {
    if (![saw.x, saw.y, saw.vx, saw.vy].every(Number.isFinite)) problems.push(`saw ${saw.id} has a non-finite position or velocity`);
    if (saw.ttl <= 0) problems.push(`saw ${saw.id} outlived its lifetime`);
    if (circleHitsWall(saw.x, saw.y, 0, state.inset)) problems.push(`saw ${saw.id} outside the live area`);
  }
  if (state.tiles.some((v) => v !== 0 && v !== 1)) problems.push('tiles hold values other than 0 and 1');
  if (!Number.isFinite(state.inset) || state.inset < 0) problems.push(`inset is ${state.inset}`);
  return problems;
}
