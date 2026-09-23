import { circleHitsTiles, circleHitsWall } from '../arena';
import { forEachSolidPointNear } from '../collision';
import { DT, TICK_RATE, TILE_COLS, TILE_ROWS, TILE_SIZE, type Config } from '../config';
import { detCos, detSin } from '../detmath';
import { throwTarget } from '../items';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SnakeState } from '../types';

/**
 * A local AI opponent for solo play and tuning sessions.
 *
 * Every few ticks it plans a short manoeuvre (turn A for a beat, then turn B) for each of the nine
 * A/B combinations, rolls each one forward through walls, blocks, bodies, its own future path, the
 * opponent's predicted path and pending blasts, and scores it by how long it stays clear, how much
 * open floor it ends in (a flood fill over a tile-sized occupancy map) and how far it gets toward a
 * goal: a pickup, or a point ahead of the opponent's head to cut them off. Difficulty tunes how far
 * it looks, how often it re-plans, how greedy and aggressive it is, and how often it slips up.
 *
 * Pure and deterministic: same seed, same state, same inputs.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** The knobs a difficulty level turns. */
export interface OpponentProfile {
  /** Look-ahead length in steps (STEP_TICKS ticks each). */
  lookSteps: number;
  /** Ticks between decisions; the last plan is held in between (reaction time). */
  decideEvery: number;
  /** Re-plan at once when the held plan's clear path drops below this many steps (0 = never). */
  panicSteps: number;
  /** 0..1: pull toward cutting across the opponent's path. */
  aggression: number;
  /** 0..1: pull toward pickups. */
  greed: number;
  /** 0..1: chance to boost when it's safe and useful. */
  boostUse: number;
  /** 0..1: how well items are timed. */
  itemSkill: number;
  /** 0..1: chance per decision of taking any merely-not-fatal line instead of the best one. */
  mistakeRate: number;
  /** Ticks of Reverse before steering compensates for it. */
  reverseLag: number;
}

export const PROFILES: Record<Difficulty, OpponentProfile> = {
  easy: {
    lookSteps: 16,
    decideEvery: 12,
    panicSteps: 0,
    aggression: 0,
    greed: 0.6,
    boostUse: 0.1,
    itemSkill: 0.3,
    mistakeRate: 0.15,
    reverseLag: 60,
  },
  normal: {
    lookSteps: 28,
    decideEvery: 6,
    panicSteps: 6,
    aggression: 0.5,
    greed: 0.8,
    boostUse: 0.4,
    itemSkill: 0.7,
    mistakeRate: 0.04,
    reverseLag: 20,
  },
  hard: {
    lookSteps: 40,
    decideEvery: 3,
    panicSteps: 10,
    aggression: 1,
    greed: 1,
    boostUse: 0.8,
    itemSkill: 1,
    mistakeRate: 0,
    reverseLag: 0,
  },
};

export interface OpponentState {
  difficulty: Difficulty;
  profile: OpponentProfile;
  rng: RngState;
  /** Ticks until the next decision. */
  cooldown: number;
  /** The held plan. */
  turn: -1 | 0 | 1;
  boost: boolean;
}

export function createOpponent(difficulty: Difficulty, seed: number, profile?: Partial<OpponentProfile>): OpponentState {
  return {
    difficulty,
    profile: { ...PROFILES[difficulty], ...profile },
    rng: createRng(seed),
    cooldown: 0,
    turn: 0,
    boost: false,
  };
}

/** Ticks per look-ahead step. */
const STEP_TICKS = 3;
/** Steps the first turn of a plan is held before the second takes over. */
const HOLD_STEPS = 5;
const TURNS = [-1, 0, 1] as const;
/** Clear steps below which a plan counts as a crash for the mistake picker. */
const NOT_FATAL_STEPS = 6;
/** Flood-fill cap, in tiles: pockets smaller than this are penalised. */
const SPACE_CAP = 300;
/** Score weights. Survival dominates; space and goal only rank plans that stay clear. */
const STEP_W = 10;
const SPACE_W = 120;
const GOAL_W = 50;
const STICK_W = 4;
/** A blast counts as a hazard from this long before it fires (ticks)... */
const BLAST_BEFORE = 6;
/** ...until this long after (the head may still be nearby). */
const BLAST_AFTER = 45;
const SEEK_RANGE = 520;
const INTERCEPT_RANGE = 700;

interface Plan {
  t1: -1 | 0 | 1;
  t2: -1 | 0 | 1;
  steps: number;
  x: number;
  y: number;
  pathLen: number;
  score: number;
}

interface Goal {
  x: number;
  y: number;
  /** 0..1 pull strength. */
  weight: number;
}

/** Everything a decision needs, computed once per tick. */
interface Ctx {
  state: MatchState;
  idx: number;
  me: SnakeState;
  cfg: Config;
  r: number;
  look: number;
  ignoreOwnFrom: number;
  /** Ticks during which bodies, blocks and heads can't hurt (Ghost or grace). */
  protectedTicks: number;
  /** Ticks during which blasts can't hurt (grace). */
  graceTicks: number;
  dozerTicks: number;
  opp: SnakeState | null;
  /** The opponent's predicted head position at each step, holding course. */
  oppX: number[];
  oppY: number[];
  /** Pending blasts: position and the tick they fire. */
  bombX: number[];
  bombY: number[];
  bombAt: number[];
  occupancy: Uint8Array | null;
  visited: Int32Array;
  stamp: number;
}

export function opponentInput(bot: OpponentState, state: MatchState, idx: number, cfg: Config): PlayerInput {
  const me = state.snakes[idx];
  if (state.phase !== 'playing' || !me.alive) {
    bot.cooldown = 0;
    bot.turn = 0;
    bot.boost = false;
    return NO_INPUT;
  }
  const p = bot.profile;
  const ctx = buildCtx(state, idx, cfg, p.lookSteps);
  const speed = cruiseSpeed(me, cfg, false);

  let use = false;
  if (bot.cooldown > 0) bot.cooldown--;
  if (bot.cooldown > 0 && p.panicSteps > 0) {
    const held = rollout(ctx, bot.turn, bot.turn, speed, p.panicSteps);
    if (held.steps < p.panicSteps) bot.cooldown = 0;
  }
  if (bot.cooldown <= 0) {
    bot.cooldown = Math.max(1, Math.round(p.decideEvery));
    const goal = pickGoal(ctx, p);
    const plans = planAll(ctx, bot, goal, speed);
    const best = choosePlan(bot, plans);
    bot.turn = best.t1;
    bot.boost = wantBoost(ctx, bot, best, goal);
    use = wantUse(ctx, bot, best, goal);
  }

  // The sim flips left and right while Reversed; a bot that has noticed steers the other way.
  let turn = bot.turn;
  if (me.effects.reverse > 0) {
    const activeFor = Math.round(cfg.reverseDuration * TICK_RATE) - me.effects.reverse;
    if (activeFor >= p.reverseLag) turn = -turn as -1 | 0 | 1;
  }
  return { turn, boost: bot.boost, use };
}

function cruiseSpeed(me: SnakeState, cfg: Config, boosting: boolean): number {
  return cfg.baseSpeed * (boosting ? cfg.boostMultiplier : 1) * (me.effects.slow > 0 ? cfg.slowFactor : 1);
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function buildCtx(state: MatchState, idx: number, cfg: Config, look: number): Ctx {
  const me = state.snakes[idx];
  const r = cfg.snakeRadius;
  let opp: SnakeState | null = null;
  let best = Infinity;
  for (let j = 0; j < state.snakes.length; j++) {
    const o = state.snakes[j];
    if (j === idx || !o.alive) continue;
    const d = dist2(o.x, o.y, me.x, me.y);
    if (d < best) {
      best = d;
      opp = o;
    }
  }
  const oppX: number[] = [];
  const oppY: number[] = [];
  if (opp) {
    const stepDist = cruiseSpeed(opp, cfg, opp.boosting) * DT * STEP_TICKS;
    const cx = detCos(opp.heading) * stepDist;
    const cy = detSin(opp.heading) * stepDist;
    for (let k = 0; k <= look; k++) {
      oppX.push(opp.x + cx * k);
      oppY.push(opp.y + cy * k);
    }
  }
  const bombX: number[] = [];
  const bombY: number[] = [];
  const bombAt: number[] = [];
  for (const b of state.bombs) {
    bombX.push(b.x);
    bombY.push(b.y);
    bombAt.push(b.flight + b.fuse);
  }
  return {
    state,
    idx,
    me,
    cfg,
    r,
    look,
    ignoreOwnFrom: headCum(me.trail) - cfg.neckLength - 2 * r,
    protectedTicks: Math.max(me.effects.ghost, me.effects.grace),
    graceTicks: me.effects.grace,
    dozerTicks: me.effects.dozer,
    opp,
    oppX,
    oppY,
    bombX,
    bombY,
    bombAt,
    occupancy: null,
    visited: EMPTY_VISITED,
    stamp: 0,
  };
}

const EMPTY_VISITED = new Int32Array(0);

/**
 * Rolls a plan forward: turn t1 for HOLD_STEPS steps, then t2. Returns how many steps stayed
 * clear (up to `limit`) and where the path ended.
 */
function rollout(ctx: Ctx, t1: -1 | 0 | 1, t2: -1 | 0 | 1, speed: number, limit: number): Omit<Plan, 'score'> {
  const { state, idx, me, cfg, r } = ctx;
  const stepDist = speed * DT * STEP_TICKS;
  const turnPer = cfg.turnRate * DT * STEP_TICKS;
  const bodyReach = 2 * r + 3;
  const bodyReach2 = bodyReach * bodyReach;
  const headReach2 = (2 * r + 4) * (2 * r + 4);
  const blastReach = cfg.blastRadius + r + 6;
  const blastReach2 = blastReach * blastReach;
  // Own future path: points at least this many steps back can be hit (past the neck).
  const selfGap = Math.ceil((cfg.neckLength + 2 * r) / Math.max(1, stepDist));
  const px: number[] = [me.x];
  const py: number[] = [me.y];
  let x = me.x;
  let y = me.y;
  let h = me.heading;
  const probe = { blocked: false };
  for (let k = 1; k <= limit; k++) {
    h += (k <= HOLD_STEPS ? t1 : t2) * turnPer;
    x += detCos(h) * stepDist;
    y += detSin(h) * stepDist;
    const tick = k * STEP_TICKS;
    const fail = () => ({ t1, t2, steps: k - 1, x: px[k - 1], y: py[k - 1], pathLen: (k - 1) * stepDist });

    if (circleHitsWall(x, y, r + 2)) return fail();
    if (tick > ctx.protectedTicks) {
      if (tick > ctx.dozerTicks && circleHitsTiles(state.tiles, x, y, r + 2)) return fail();
      probe.blocked = false;
      forEachSolidPointNear(state, x, y, bodyReach, (snake, i) => {
        if (snake !== idx || me.trail.cum[i] < ctx.ignoreOwnFrom) probe.blocked = true;
      });
      if (probe.blocked) return fail();
      for (let j = 0; j <= k - selfGap; j++) if (dist2(px[j], py[j], x, y) < bodyReach2) return fail();
      // The opponent's head, and the trail it will have laid by the time we get there.
      const upto = Math.min(k + 2, ctx.oppX.length - 1);
      for (let j = 0; j <= upto; j++) if (dist2(ctx.oppX[j], ctx.oppY[j], x, y) < headReach2) return fail();
    }
    if (tick > ctx.graceTicks) {
      for (let j = 0; j < ctx.bombX.length; j++) {
        const at = ctx.bombAt[j];
        if (at >= tick - BLAST_BEFORE && at <= tick + BLAST_AFTER && dist2(ctx.bombX[j], ctx.bombY[j], x, y) < blastReach2) return fail();
      }
    }
    px.push(x);
    py.push(y);
  }
  return { t1, t2, steps: limit, x, y, pathLen: limit * stepDist };
}

function pickGoal(ctx: Ctx, p: OpponentProfile): Goal | null {
  const { me, cfg, opp } = ctx;
  if (p.greed > 0 && me.items.length < cfg.itemSlots) {
    let target: { x: number; y: number } | null = null;
    let best = SEEK_RANGE * SEEK_RANGE;
    for (const pk of ctx.state.pickups) {
      // Skip pickups about to vanish before we could plausibly get there.
      const d = dist2(pk.x, pk.y, me.x, me.y);
      if (d < best && pk.ttl * cfg.baseSpeed * DT > Math.sqrt(d) * 0.8) {
        best = d;
        target = pk;
      }
    }
    if (target) return { x: target.x, y: target.y, weight: p.greed };
  }
  if (p.aggression > 0 && opp) {
    const d = Math.sqrt(dist2(opp.x, opp.y, me.x, me.y));
    if (d < INTERCEPT_RANGE) {
      const lead = Math.min(220, Math.max(60, d * 0.5));
      return { x: opp.x + detCos(opp.heading) * lead, y: opp.y + detSin(opp.heading) * lead, weight: p.aggression };
    }
  }
  return null;
}

function planAll(ctx: Ctx, bot: OpponentState, goal: Goal | null, speed: number): Plan[] {
  const plans: Plan[] = [];
  const before = goal ? Math.sqrt(dist2(goal.x, goal.y, ctx.me.x, ctx.me.y)) : 0;
  for (const t1 of TURNS) {
    for (const t2 of TURNS) {
      const r = rollout(ctx, t1, t2, speed, ctx.look);
      let score = r.steps * STEP_W;
      if (r.steps === ctx.look) score += SPACE_W * spaceAt(ctx, r.x, r.y);
      if (goal && r.pathLen > 0) {
        const after = Math.sqrt(dist2(goal.x, goal.y, r.x, r.y));
        score += GOAL_W * goal.weight * ((before - after) / r.pathLen);
      }
      if (t1 === bot.turn) score += STICK_W;
      plans.push({ ...r, score });
    }
  }
  return plans;
}

function choosePlan(bot: OpponentState, plans: Plan[]): Plan {
  let best = plans[0];
  for (const p of plans) if (p.score > best.score) best = p;
  if (bot.profile.mistakeRate > 0 && rngNext(bot.rng) < bot.profile.mistakeRate) {
    const survivable = plans.filter((p) => p.steps >= NOT_FATAL_STEPS);
    if (survivable.length > 0) return survivable[rngInt(bot.rng, survivable.length)];
  }
  return best;
}

/** Open floor reachable from (x, y), as a 0..1 fraction of SPACE_CAP tiles. */
function spaceAt(ctx: Ctx, x: number, y: number): number {
  if (!ctx.occupancy) {
    ctx.occupancy = buildOccupancy(ctx.state);
    ctx.visited = new Int32Array(TILE_COLS * TILE_ROWS);
  }
  const occ = ctx.occupancy;
  const visited = ctx.visited;
  const stamp = ++ctx.stamp;
  const sx = Math.min(TILE_COLS - 1, Math.max(0, Math.floor(x / TILE_SIZE)));
  const sy = Math.min(TILE_ROWS - 1, Math.max(0, Math.floor(y / TILE_SIZE)));
  const start = sy * TILE_COLS + sx;
  if (occ[start]) return 0;
  const queue = [start];
  visited[start] = stamp;
  let count = 0;
  let head = 0;
  while (head < queue.length && count < SPACE_CAP) {
    const cell = queue[head++];
    count++;
    const cx = cell % TILE_COLS;
    const cy = (cell - cx) / TILE_COLS;
    if (cx > 0) push(cell - 1);
    if (cx < TILE_COLS - 1) push(cell + 1);
    if (cy > 0) push(cell - TILE_COLS);
    if (cy < TILE_ROWS - 1) push(cell + TILE_COLS);
  }
  return count / SPACE_CAP;

  function push(next: number): void {
    if (visited[next] === stamp || occ[next]) return;
    visited[next] = stamp;
    queue.push(next);
  }
}

/** Tile-resolution map of what a head can't pass: blocks and every solid body point. */
function buildOccupancy(state: MatchState): Uint8Array {
  const occ = new Uint8Array(TILE_COLS * TILE_ROWS);
  for (let i = 0; i < occ.length; i++) if (state.tiles[i] === 1) occ[i] = 1;
  for (const s of state.snakes) {
    const t = s.trail;
    for (let i = t.start; i < t.xs.length; i++) {
      if (!t.solid[i]) continue;
      const cx = Math.floor(t.xs[i] / TILE_SIZE);
      const cy = Math.floor(t.ys[i] / TILE_SIZE);
      if (cx >= 0 && cy >= 0 && cx < TILE_COLS && cy < TILE_ROWS) occ[cy * TILE_COLS + cx] = 1;
    }
  }
  return occ;
}

function wantBoost(ctx: Ctx, bot: OpponentState, best: Plan, goal: Goal | null): boolean {
  const { me, cfg } = ctx;
  const p = bot.profile;
  if (best.steps < ctx.look) return false;
  const turbo = me.effects.turbo > 0;
  if (!turbo && me.boostMeter < 0.35) return false;

  let reason = false;
  if (goal) {
    const far = dist2(goal.x, goal.y, me.x, me.y) > 200 * 200;
    const toward = Math.sqrt(dist2(goal.x, goal.y, me.x, me.y)) - Math.sqrt(dist2(goal.x, goal.y, best.x, best.y));
    reason = far && toward > best.pathLen * 0.5;
  }
  // A blast about to go off nearby: get out of there.
  const flee = (cfg.blastRadius + 3 * cfg.snakeRadius) * (cfg.blastRadius + 3 * cfg.snakeRadius);
  for (let j = 0; j < ctx.bombX.length; j++) {
    if (ctx.bombAt[j] <= 40 && dist2(ctx.bombX[j], ctx.bombY[j], me.x, me.y) < flee) reason = true;
  }
  if (!reason) return turbo && rngNext(bot.rng) < p.boostUse;
  if (rngNext(bot.rng) >= p.boostUse) return false;
  // Only if the same line is still clear at boost speed.
  return rollout(ctx, best.t1, best.t2, cruiseSpeed(me, cfg, true), ctx.look).steps === ctx.look;
}

function wantUse(ctx: Ctx, bot: OpponentState, best: Plan, goal: Goal | null): boolean {
  const { me, cfg, opp, state, idx } = ctx;
  const p = bot.profile;
  const item = me.items[0];
  if (!item || me.useCooldown > 0) return false;
  const boxed = best.steps < ctx.look * 0.4;
  const unclog = me.items.length >= cfg.itemSlots && rngNext(bot.rng) < 0.01;
  const oppDist = opp ? Math.sqrt(dist2(opp.x, opp.y, me.x, me.y)) : Infinity;
  const oppBoxed = opp !== null && p.itemSkill > 0.5 && straightClear(ctx, opp, 12) < 8;

  switch (item.kind) {
    case 'shield':
      return true;
    case 'bomb': {
      if (!opp) return false;
      // Never blast ourselves: where will we be when it goes off, holding course?
      const at = throwTarget(state, idx, cfg);
      const ticks = Math.round((cfg.bombFlightTime + cfg.bombFuse) * TICK_RATE);
      const travel = cruiseSpeed(me, cfg, me.boosting) * DT * ticks;
      const mx = me.x + detCos(me.heading) * travel;
      const my = me.y + detSin(me.heading) * travel;
      const safe = cfg.blastRadius + 3 * cfg.snakeRadius + 20;
      if (dist2(at.x, at.y, mx, my) < safe * safe || dist2(at.x, at.y, me.x, me.y) < safe * safe) return false;
      const chance = oppBoxed ? 0.25 : oppDist < 500 ? 0.04 : 0.01;
      return rngNext(bot.rng) < chance * (0.3 + 0.7 * p.itemSkill);
    }
    case 'ghost':
      return boxed || unclog;
    case 'dozer':
      return boxed || unclog;
    case 'turbo':
      return (best.steps === ctx.look && goal !== null && rngNext(bot.rng) < 0.05 * p.itemSkill) || unclog;
    case 'slow':
    case 'reverse': {
      if (!opp) return unclog;
      const chance = oppBoxed ? 0.2 : oppDist < 350 ? 0.06 : 0.005;
      return rngNext(bot.rng) < chance * (0.3 + 0.7 * p.itemSkill) || unclog;
    }
  }
}

/** How many steps the other snake can hold course before hitting something static. */
function straightClear(ctx: Ctx, s: SnakeState, limit: number): number {
  const { state, cfg, r } = ctx;
  const stepDist = cruiseSpeed(s, cfg, false) * DT * STEP_TICKS;
  const cx = detCos(s.heading) * stepDist;
  const cy = detSin(s.heading) * stepDist;
  const ignoreFrom = headCum(s.trail) - cfg.neckLength - 2 * r;
  const probe = { blocked: false };
  for (let k = 1; k <= limit; k++) {
    const x = s.x + cx * k;
    const y = s.y + cy * k;
    if (circleHitsWall(x, y, r + 2) || circleHitsTiles(state.tiles, x, y, r + 2)) return k - 1;
    probe.blocked = false;
    forEachSolidPointNear(state, x, y, 2 * r + 3, (snake, i) => {
      if (snake !== s.id || s.trail.cum[i] < ignoreFrom) probe.blocked = true;
    });
    if (probe.blocked) return k - 1;
  }
  return limit;
}
