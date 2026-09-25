import { circleHitsTiles, circleHitsWall } from '../arena';
import { insetAt } from '../border';
import { forEachSolidPointNear } from '../collision';
import { ARENA_HEIGHT, ARENA_WIDTH, DT, TICK_RATE, TILE_COLS, TILE_ROWS, TILE_SIZE, type Config, type PickupKind } from '../config';
import { detAtan2, detCos, detSin, wrapAngle } from '../detmath';
import { createRng, rngInt, rngNext, type RngState } from '../rng';
import { headCum } from '../trail';
import { NO_INPUT, type MatchState, type PlayerInput, type SnakeState } from '../types';

/**
 * A local AI opponent for solo play and tuning sessions.
 *
 * Every few ticks it plans a short manoeuvre (turn A for a beat, then turn B) for each of the nine
 * A/B combinations, rolls each one forward through walls, blocks, bodies, its own future path, the
 * opponent's predicted path and pending blasts, and scores it by how long it stays clear, how much
 * open floor it ends in, how much of that floor it can reach before the opponent can (territory,
 * the classic Tron heuristic: walling the opponent off scores, being walled off costs) and how far
 * it gets toward a goal: a pickup, or a point ahead of the opponent's head. Difficulty tunes how far
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
  },
  hard: {
    lookSteps: 48,
    decideEvery: 2,
    panicSteps: 12,
    aggression: 1,
    greed: 0.8,
    boostUse: 0.9,
    itemSkill: 1,
    mistakeRate: 0,
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
  /** Grace ticks seen last tick; a rise means a hit deflected us and the plan is stale. */
  lastGrace: number;
  /** Clear steps of the plan in force (diagnostics). */
  lastSteps: number;
  /** Index of the carried item it is cycling the selection toward before firing; -1 when none. */
  wanted: number;
}

export function createOpponent(difficulty: Difficulty, seed: number, profile?: Partial<OpponentProfile>): OpponentState {
  return {
    difficulty,
    profile: { ...PROFILES[difficulty], ...profile },
    rng: createRng(seed),
    cooldown: 0,
    turn: 0,
    boost: false,
    lastGrace: 0,
    lastSteps: 0,
    wanted: -1,
  };
}

type Turn = -1 | 0 | 1;

/** Ticks per look-ahead step. */
const STEP_TICKS = 3;
/** Basic plans: a first turn held this many steps, then a second one to the horizon. */
const HOLD_STEPS = 5;
/** Escape plans, tried when no basic plan stays clear: three turns, the first two held this long. */
const ESCAPE_HOLDS = [3, 4];
const TURNS: readonly Turn[] = [-1, 0, 1];
/** Path length behind the head that is sealed off in space estimates (a snake can't U-turn in a corridor). */
const SEAL_BEHIND = 120;
/** Clear steps below which a plan counts as a crash for the mistake picker. */
const NOT_FATAL_STEPS = 6;
/** Reachable-floor cap, in tiles: pockets smaller than this are penalised. */
const SPACE_CAP = 300;
/** Score weights. Survival dominates; space, territory and goal only rank plans that stay clear. */
const STEP_W = 10;
const SPACE_W = 250;
const TERRITORY_W = 200;
const CUT_W = 150;
const GOAL_W = 50;
const STICK_W = 4;
/**
 * A cut: crossing the opponent's predicted line between CUT_MIN and CUT_MAX steps before they
 * reach it. Close enough that a person can't react, far enough that a boost won't make it head-on.
 */
const CUT_MIN = 4;
const CUT_MAX = 12;
const SEEK_RANGE = 520;
/** Ticks ahead that a saw counts as a hazard in rollouts (0.8 s). */
const SAW_HORIZON = 48;
/** How close to the moving border a head can be before the middle becomes its only goal. */
const BORDER_BAND = 320;
const INTERCEPT_RANGE = 700;
/** Ticks before the Bulldozer runs out during which blocks count as solid again. */
const DOZER_MARGIN = 20;

interface Rollout {
  /** Turns in order; each is held for the matching entry of `holds`, the last to the horizon. */
  turns: readonly Turn[];
  holds: readonly number[];
  steps: number;
  x: number;
  y: number;
  pathLen: number;
  /** The path taken, head first, for territory scoring. */
  px: number[];
  py: number[];
  /** True when the path crosses the opponent's predicted line just before they get there. */
  cut: boolean;
}

interface Plan extends Rollout {
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
  /** Ticks during which bodies, blocks and heads can't hurt (Ghost or grace). */
  protectedTicks: number;
  dozerTicks: number;
  /** Ticks during which the opponent's body is a thing to cut, not to die on. */
  scissorTicks: number;
  /** Ticks during which missiles can't hurt (grace). */
  graceTicks: number;
  /** Live missiles that can hit me: where they are, where they point, how long they have. */
  missiles: { x: number; y: number; heading: number; ttl: number }[];
  /** Roving saws, taken to keep their velocity (bounces are not predicted). */
  saws: { x: number; y: number; vx: number; vy: number; ttl: number }[];
  /** Ticks the opponent's flamethrower keeps burning; its cone follows the opponent's predicted path. */
  oppFlameTicks: number;
  opp: SnakeState | null;
  /** The opponent's predicted head position at each step, holding course. */
  oppX: number[];
  oppY: number[];
  /** Built on first use: the tile map and BFS scratch space for space and territory scoring. */
  field: Field | null;
}

interface Field {
  /** 1 where a head can't go: blocks and every solid body point. */
  occ: Uint8Array;
  myDist: Int16Array;
  /** Steps from the opponent's predicted position to each tile, or null with no opponent. */
  oppDist: Int16Array | null;
  queue: Int32Array;
}

export function opponentInput(bot: OpponentState, state: MatchState, idx: number, cfg: Config): PlayerInput {
  const me = state.snakes[idx];
  if (state.phase !== 'playing' || !me.alive) {
    bot.cooldown = 0;
    bot.turn = 0;
    bot.boost = false;
    bot.lastGrace = 0;
    bot.lastSteps = 0;
    bot.wanted = -1;
    return NO_INPUT;
  }
  const p = bot.profile;
  const ctx = buildCtx(state, idx, cfg, p.lookSteps);
  const speed = cruiseSpeed(cfg, false);

  let use = false;
  let select = false;
  if (bot.cooldown > 0) bot.cooldown--;
  // A deflection (heart or Shield) moved and turned us: whatever we were doing no longer applies.
  if (me.effects.grace > bot.lastGrace) bot.cooldown = 0;
  bot.lastGrace = me.effects.grace;
  // A wormhole just moved us across the map: the same.
  if (me.portalCooldown === Math.max(1, Math.round(cfg.portalCooldown * TICK_RATE))) bot.cooldown = 0;
  if (bot.cooldown > 0 && p.panicSteps > 0) {
    const held = rollout(ctx, [bot.turn], [], speed, p.panicSteps);
    if (held.steps < p.panicSteps) bot.cooldown = 0;
  }
  if (bot.cooldown <= 0) {
    bot.cooldown = Math.max(1, Math.round(p.decideEvery));
    const goal = pickGoal(ctx, p);
    const plans = planAll(ctx, bot, goal, speed);
    const best = choosePlan(bot, plans);
    bot.turn = best.turns[0];
    bot.lastSteps = best.steps;
    bot.boost = wantBoost(ctx, bot, best, goal);
    const wanted = wantUse(ctx, bot, best);
    if (wanted !== null) bot.wanted = wanted;
  }
  // Fire only works on the selected item: cycle the selection toward the one it wants (one Select
  // per tick), then fire. Anything that shrank the queue in the meantime drops the plan.
  if (bot.wanted >= me.items.length) bot.wanted = -1;
  if (bot.wanted >= 0) {
    if (me.selected === bot.wanted) {
      use = true;
      bot.wanted = -1;
    } else select = true;
  }

  return { turn: bot.turn, boost: bot.boost, use, select };
}

function cruiseSpeed(cfg: Config, boosting: boolean): number {
  return cfg.baseSpeed * (boosting ? cfg.boostMultiplier : 1);
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
    const stepDist = cruiseSpeed(cfg, opp.boosting) * DT * STEP_TICKS;
    const cx = detCos(opp.heading) * stepDist;
    const cy = detSin(opp.heading) * stepDist;
    for (let k = 0; k <= look; k++) {
      oppX.push(opp.x + cx * k);
      oppY.push(opp.y + cy * k);
    }
  }
  return {
    state,
    idx,
    me,
    cfg,
    r,
    look,
    protectedTicks: Math.max(me.effects.ghost, me.effects.grace),
    // Blocks shoved along by the plow end up right in front of the head, so stop trusting the
    // Bulldozer a beat before it runs out.
    dozerTicks: Math.max(0, me.effects.dozer - DOZER_MARGIN),
    scissorTicks: Math.max(0, me.effects.scissors - DOZER_MARGIN),
    graceTicks: me.effects.grace,
    missiles: state.missiles.filter((m) => m.owner !== idx).map((m) => ({ x: m.x, y: m.y, heading: m.heading, ttl: m.ttl })),
    saws: state.saws.map((s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, ttl: s.ttl })),
    oppFlameTicks: opp ? opp.effects.flame : 0,
    opp,
    oppX,
    oppY,
    field: null,
  };
}

/**
 * Rolls a plan forward: each turn held for its `holds` entry, the last to the horizon. Returns how
 * many steps stayed clear (up to `limit`) and where the path ended.
 */
function rollout(ctx: Ctx, turns: readonly Turn[], holds: readonly number[], speed: number, limit: number): Rollout {
  const { state, idx, me, cfg, r } = ctx;
  const stepDist = speed * DT * STEP_TICKS;
  const turnPer = cfg.turnRate * DT * STEP_TICKS;
  const bodyReach = 2 * r + 4;
  const bodyReach2 = bodyReach * bodyReach;
  const headReach2 = (2 * r + 4) * (2 * r + 4);
  const px: number[] = [me.x];
  const py: number[] = [me.y];
  let x = me.x;
  let y = me.y;
  let h = me.heading;
  let cut = false;
  // Missiles chase the path being planned: pure pursuit at their real speed and turn rate.
  const mx = ctx.missiles.map((m) => m.x);
  const my = ctx.missiles.map((m) => m.y);
  const mh = ctx.missiles.map((m) => m.heading);
  const missileStep = cfg.missileSpeed * DT * STEP_TICKS;
  const missileTurn = cfg.missileTurnRate * DT * STEP_TICKS;
  const missileReach = cfg.missileRadius + r + 8;
  const missileReach2 = missileReach * missileReach;
  const sawReach = cfg.sawRadius + r + 8;
  const sawReach2 = sawReach * sawReach;
  let seg = 0;
  let segEnd = holds.length > 0 ? holds[0] : Infinity;
  const probe = { blocked: false };
  for (let k = 1; k <= limit; k++) {
    if (k > segEnd) {
      seg++;
      segEnd = seg < holds.length ? segEnd + holds[seg] : Infinity;
    }
    // Midpoint rule: the sim turns a little and moves a little each tick, so a step's travel is
    // along the average heading, not the heading at its end.
    const dh = turns[Math.min(seg, turns.length - 1)] * turnPer;
    x += detCos(h + dh / 2) * stepDist;
    y += detSin(h + dh / 2) * stepDist;
    h += dh;
    const tick = k * STEP_TICKS;
    const fail = () => ({ turns, holds, steps: k - 1, x: px[k - 1], y: py[k - 1], pathLen: (k - 1) * stepDist, px, py, cut });

    // Walls are exact, and a deflection leaves the head only half a pixel clear of one.
    if (circleHitsWall(x, y, r + 1, insetAt(state, cfg, tick))) return fail();
    for (let m = 0; m < mx.length; m++) {
      if (ctx.missiles[m].ttl < tick) continue;
      const want = detAtan2(y - my[m], x - mx[m]);
      const delta = wrapAngle(want - mh[m]);
      mh[m] = wrapAngle(mh[m] + Math.max(-missileTurn, Math.min(missileTurn, delta)));
      mx[m] += detCos(mh[m]) * missileStep;
      my[m] += detSin(mh[m]) * missileStep;
      if (tick > ctx.graceTicks && dist2(mx[m], my[m], x, y) < missileReach2) return fail();
    }
    // Saws: straight lines bouncing off the border, and only for the next SAW_HORIZON ticks; further
    // out the plan gets replaced long before the saw gets there, and a long sweep would wall off half the map.
    if (tick <= SAW_HORIZON && tick > ctx.graceTicks) {
      for (const saw of ctx.saws) {
        if (saw.ttl < tick) continue;
        const inset = insetAt(state, cfg, tick) + cfg.sawRadius;
        const sx = bounce(saw.x + saw.vx * DT * tick, inset, ARENA_WIDTH - inset);
        const sy = bounce(saw.y + saw.vy * DT * tick, inset, ARENA_HEIGHT - inset);
        if (dist2(sx, sy, x, y) < sawReach2) return fail();
      }
    }
    if (tick > ctx.protectedTicks) {
      if (tick > ctx.dozerTicks && circleHitsTiles(state.tiles, x, y, r + 2)) return fail();
      // Own body is safe (hunt rules): only the opponent's points block, and not while the scissors are out.
      if (tick > ctx.scissorTicks) {
        probe.blocked = false;
        forEachSolidPointNear(state, x, y, bodyReach, (snake) => {
          if (snake !== idx) probe.blocked = true;
        });
        if (probe.blocked) return fail();
      }
      // The opponent's head, and the trail it will have laid by the time we get there.
      const upto = Math.min(k + 2, ctx.oppX.length - 1);
      for (let j = 0; j <= upto; j++) if (dist2(ctx.oppX[j], ctx.oppY[j], x, y) < headReach2) return fail();
      // Their cone of fire, while it burns, from where they will be.
      if (ctx.opp && tick <= ctx.oppFlameTicks && tick > ctx.graceTicks) {
        const j = Math.min(k, ctx.oppX.length - 1);
        const fx = x - ctx.oppX[j];
        const fy = y - ctx.oppY[j];
        const reach = cfg.flameRange + r + 8;
        if (fx * fx + fy * fy < reach * reach && Math.abs(wrapAngle(detAtan2(fy, fx) - ctx.opp.heading)) < cfg.flameSpread + 0.15) return fail();
      }
      if (!cut) {
        const last = Math.min(k + CUT_MAX, ctx.oppX.length - 1);
        for (let j = k + CUT_MIN; j <= last; j++) {
          if (dist2(ctx.oppX[j], ctx.oppY[j], x, y) < bodyReach2) {
            cut = true;
            break;
          }
        }
      }
    }
    px.push(x);
    py.push(y);
  }
  return { turns, holds, steps: limit, x, y, pathLen: limit * stepDist, px, py, cut };
}

function pickGoal(ctx: Ctx, p: OpponentProfile): Goal | null {
  const { me, cfg, opp } = ctx;
  // While the border moves, nothing near it is worth having: a head in the outer band makes for
  // the middle before anything else, and pickups the border will have swallowed are skipped.
  const ahead = insetAt(ctx.state, cfg, ctx.look * STEP_TICKS);
  const closing = ahead > ctx.state.inset;
  if (closing && edgeMargin(me.x, me.y) - ahead < BORDER_BAND) return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2, weight: 1 };
  if (p.greed > 0 && me.items.length < cfg.itemSlots) {
    let target: { x: number; y: number } | null = null;
    let best = SEEK_RANGE * SEEK_RANGE;
    for (const pk of ctx.state.pickups) {
      // Skip pickups about to vanish before we could plausibly get there, or that the border will take.
      const d = dist2(pk.x, pk.y, me.x, me.y);
      if (closing && edgeMargin(pk.x, pk.y) < ahead + BORDER_BAND / 2) continue;
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
      // Pursuit: aim where the opponent will be by the time we could get there, holding course.
      const mySpeed = cruiseSpeed(cfg, false);
      const lead = Math.min(320, Math.max(60, cruiseSpeed(cfg, opp.boosting) * (d / mySpeed) * 0.8));
      return { x: opp.x + detCos(opp.heading) * lead, y: opp.y + detSin(opp.heading) * lead, weight: p.aggression };
    }
  }
  return null;
}

/** Folds a coordinate back inside [lo, hi] as if it had bounced off those edges. */
function bounce(v: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return lo;
  let t = (v - lo) % (2 * span);
  if (t < 0) t += 2 * span;
  return lo + (t <= span ? t : 2 * span - t);
}

/** Distance from a point to the nearest arena edge (before any border inset). */
function edgeMargin(x: number, y: number): number {
  return Math.min(x, y, ARENA_WIDTH - x, ARENA_HEIGHT - y);
}

/** Scores the basic plan set, and the escape set too when nothing basic stays clear to the horizon. */
function planAll(ctx: Ctx, bot: OpponentState, goal: Goal | null, speed: number): Plan[] {
  const plans: Plan[] = [];
  const before = goal ? Math.sqrt(dist2(goal.x, goal.y, ctx.me.x, ctx.me.y)) : 0;
  const consider = (turns: readonly Turn[], holds: readonly number[]) => {
    const r = rollout(ctx, turns, holds, speed, ctx.look);
    let score = r.steps * STEP_W;
    if (r.steps === ctx.look) {
      // Attacking rewards are scaled by the room left to do it in: a cut that ends in a pocket is bait.
      const { space, territory } = evaluateEnd(ctx, r);
      const attack = bot.profile.aggression * (TERRITORY_W * territory + (r.cut ? CUT_W : 0));
      score += space * (SPACE_W + Math.max(0, attack)) + Math.min(0, attack);
    }
    if (goal && r.pathLen > 0) {
      const after = Math.sqrt(dist2(goal.x, goal.y, r.x, r.y));
      score += GOAL_W * goal.weight * ((before - after) / r.pathLen);
    }
    if (turns[0] === bot.turn) score += STICK_W;
    plans.push({ ...r, score });
    return r.steps;
  };

  let clearest = 0;
  for (const t1 of TURNS) for (const t2 of TURNS) clearest = Math.max(clearest, consider([t1, t2], [HOLD_STEPS]));
  if (clearest < ctx.look) {
    for (const t1 of TURNS) for (const t2 of TURNS) for (const t3 of TURNS) consider([t1, t2, t3], ESCAPE_HOLDS);
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

/**
 * Scores where a clear plan ends. `space` is the open floor reachable from there as a 0..1
 * fraction of SPACE_CAP tiles. `territory` is -1..1: the share of floor this snake reaches
 * before the opponent, minus the share the opponent reaches first, with the path just rolled
 * out (and the opponent's predicted path) already counted as wall.
 */
function evaluateEnd(ctx: Ctx, r: Rollout): { space: number; territory: number } {
  const field = ctx.field ?? (ctx.field = buildField(ctx));
  const { occ, myDist, oppDist, queue } = field;
  const marked: number[] = [];
  // The path just rolled out, and the stretch of body behind the head, are stamped three tiles
  // wide: a corridor that narrow can't be turned around in, so what's behind is out of reach.
  for (let i = 1; i < r.px.length - 3; i++) stamp(occ, r.px[i], r.py[i], marked);
  const t = ctx.me.trail;
  const sealFrom = headCum(t) - SEAL_BEHIND;
  for (let i = t.xs.length - 1; i >= t.start && t.cum[i] > sealFrom; i--) stamp(occ, t.xs[i], t.ys[i], marked);
  const start = freeTileNear(occ, r.x, r.y);
  let space = 0;
  let territory = 0;
  if (start >= 0) {
    const reached = bfs(occ, start, myDist, queue);
    space = Math.min(reached, SPACE_CAP) / SPACE_CAP;
    if (oppDist) {
      let mine = 0;
      let theirs = 0;
      for (let i = 0; i < myDist.length; i++) {
        const a = myDist[i];
        const b = oppDist[i];
        if (a >= 0 && (b < 0 || a < b)) mine++;
        else if (b >= 0 && (a < 0 || b < a)) theirs++;
      }
      territory = (mine - theirs) / (mine + theirs + 1);
    }
  }
  for (const cell of marked) occ[cell] = 0;
  return { space, territory };
}

/** The territory field runs on 40-unit cells (80×50 on the big arena), the same cost as the old tile grid. */
const FIELD_CELL = 40;
const FIELD_COLS = ARENA_WIDTH / FIELD_CELL;
const FIELD_ROWS = ARENA_HEIGHT / FIELD_CELL;

/** The tile map plus the opponent's distance field, computed once per decision. */
function buildField(ctx: Ctx): Field {
  const occ = buildOccupancy(ctx.state, insetAt(ctx.state, ctx.cfg, ctx.look * STEP_TICKS));
  const size = FIELD_COLS * FIELD_ROWS;
  const queue = new Int32Array(size);
  const myDist = new Int16Array(size);
  let oppDist: Int16Array | null = null;
  if (ctx.opp) {
    // The opponent moves too: count the path they'd lay by the time the plan ends as wall.
    const upto = Math.min(HOLD_STEPS, ctx.oppX.length - 1);
    for (let k = 1; k < upto; k++) {
      const cell = tileAt(ctx.oppX[k], ctx.oppY[k]);
      if (cell >= 0) occ[cell] = 1;
    }
    const start = freeTileNear(occ, ctx.oppX[upto], ctx.oppY[upto]);
    if (start >= 0) {
      oppDist = new Int16Array(size);
      bfs(occ, start, oppDist, queue);
    }
  }
  return { occ, myDist, oppDist, queue };
}

/** Marks the tile under (x, y) and its eight neighbours, remembering which were free before. */
function stamp(occ: Uint8Array, x: number, y: number, marked: number[]): void {
  const cx = Math.floor(x / FIELD_CELL);
  const cy = Math.floor(y / FIELD_CELL);
  for (let dy = -1; dy <= 1; dy++) {
    const ty = cy + dy;
    if (ty < 0 || ty >= FIELD_ROWS) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const tx = cx + dx;
      if (tx < 0 || tx >= FIELD_COLS) continue;
      const cell = ty * FIELD_COLS + tx;
      if (!occ[cell]) {
        occ[cell] = 1;
        marked.push(cell);
      }
    }
  }
}

function tileAt(x: number, y: number): number {
  const cx = Math.floor(x / FIELD_CELL);
  const cy = Math.floor(y / FIELD_CELL);
  return cx >= 0 && cy >= 0 && cx < FIELD_COLS && cy < FIELD_ROWS ? cy * FIELD_COLS + cx : -1;
}

/** The tile under (x, y), or a free 4-neighbour of it when a body point shares that tile; -1 if none. */
function freeTileNear(occ: Uint8Array, x: number, y: number): number {
  const cell = tileAt(Math.min(Math.max(x, 0), FIELD_COLS * FIELD_CELL - 1), Math.min(Math.max(y, 0), FIELD_ROWS * FIELD_CELL - 1));
  if (cell < 0) return -1;
  if (!occ[cell]) return cell;
  const cx = cell % FIELD_COLS;
  const cy = (cell - cx) / FIELD_COLS;
  if (cx > 0 && !occ[cell - 1]) return cell - 1;
  if (cx < FIELD_COLS - 1 && !occ[cell + 1]) return cell + 1;
  if (cy > 0 && !occ[cell - FIELD_COLS]) return cell - FIELD_COLS;
  if (cy < FIELD_ROWS - 1 && !occ[cell + FIELD_COLS]) return cell + FIELD_COLS;
  return -1;
}

/** Breadth-first distances (in tiles) from `start` over free tiles; -1 where unreachable. Returns the tile count reached. */
function bfs(occ: Uint8Array, start: number, dist: Int16Array, queue: Int32Array): number {
  dist.fill(-1);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;
  while (head < tail) {
    const cell = queue[head++];
    const d = dist[cell] + 1;
    const cx = cell % FIELD_COLS;
    const cy = (cell - cx) / FIELD_COLS;
    if (cx > 0 && dist[cell - 1] < 0 && !occ[cell - 1]) {
      dist[cell - 1] = d;
      queue[tail++] = cell - 1;
    }
    if (cx < FIELD_COLS - 1 && dist[cell + 1] < 0 && !occ[cell + 1]) {
      dist[cell + 1] = d;
      queue[tail++] = cell + 1;
    }
    if (cy > 0 && dist[cell - FIELD_COLS] < 0 && !occ[cell - FIELD_COLS]) {
      dist[cell - FIELD_COLS] = d;
      queue[tail++] = cell - FIELD_COLS;
    }
    if (cy < FIELD_ROWS - 1 && dist[cell + FIELD_COLS] < 0 && !occ[cell + FIELD_COLS]) {
      dist[cell + FIELD_COLS] = d;
      queue[tail++] = cell + FIELD_COLS;
    }
  }
  return tail;
}

/**
 * Field-resolution map of what a head can't pass: blocks, every solid body point, and the floor
 * the border will have taken by `inset` (so territory near the edge counts for nothing).
 */
function buildOccupancy(state: MatchState, inset: number): Uint8Array {
  const occ = new Uint8Array(FIELD_COLS * FIELD_ROWS);
  const per = FIELD_CELL / TILE_SIZE;
  const dead = Math.floor(inset / FIELD_CELL);
  for (let cy = 0; cy < FIELD_ROWS; cy++) {
    for (let cx = 0; cx < FIELD_COLS; cx++) {
      const gone = cx < dead || cy < dead || cx >= FIELD_COLS - dead || cy >= FIELD_ROWS - dead;
      if (gone) occ[cy * FIELD_COLS + cx] = 1;
    }
  }
  for (let ty = 0; ty < TILE_ROWS; ty++) {
    for (let tx = 0; tx < TILE_COLS; tx++) {
      if (state.tiles[ty * TILE_COLS + tx] === 1) occ[Math.floor(ty / per) * FIELD_COLS + Math.floor(tx / per)] = 1;
    }
  }
  for (const s of state.snakes) {
    const t = s.trail;
    for (let i = t.start; i < t.xs.length; i++) {
      if (!t.solid[i]) continue;
      const cx = Math.floor(t.xs[i] / FIELD_CELL);
      const cy = Math.floor(t.ys[i] / FIELD_CELL);
      if (cx >= 0 && cy >= 0 && cx < FIELD_COLS && cy < FIELD_ROWS) occ[cy * FIELD_COLS + cx] = 1;
    }
  }
  return occ;
}

function wantBoost(ctx: Ctx, bot: OpponentState, best: Plan, goal: Goal | null): boolean {
  const { me, cfg } = ctx;
  const p = bot.profile;
  // Boost burns body; keep enough to draw a loop with.
  if (best.steps < ctx.look || me.targetLength < 200) return false;

  let reason = false;
  if (goal) {
    const far = dist2(goal.x, goal.y, me.x, me.y) > 200 * 200;
    const toward = Math.sqrt(dist2(goal.x, goal.y, me.x, me.y)) - Math.sqrt(dist2(goal.x, goal.y, best.x, best.y));
    reason = far && toward > best.pathLen * 0.5;
  }
  // A missile closing in: boosting is the one thing that outruns it, whatever the goal says.
  for (const m of ctx.missiles) {
    const d2 = dist2(m.x, m.y, me.x, me.y);
    const closing = (me.x - m.x) * detCos(m.heading) + (me.y - m.y) * detSin(m.heading) > 0;
    if (d2 < 260 * 260 && closing) {
      reason = true;
      break;
    }
  }
  if (!reason || rngNext(bot.rng) >= p.boostUse) return false;
  // Only if the same line is still clear at boost speed.
  return rollout(ctx, best.turns, best.holds, cruiseSpeed(cfg, true), ctx.look).steps === ctx.look;
}

/**
 * Which carried item it wants to fire now, as an index into me.items, or null. The selected item
 * gets first say, so a wanted item already under the cursor fires without a detour.
 */
function wantUse(ctx: Ctx, bot: OpponentState, best: Plan): number | null {
  const { me, cfg, opp } = ctx;
  const p = bot.profile;
  if (me.items.length === 0 || me.useCooldown > 0) return null;
  const boxed = best.steps < ctx.look * 0.4;
  const unclog = me.items.length >= cfg.itemSlots && rngNext(bot.rng) < 0.01;
  const oppDist = opp ? Math.sqrt(dist2(opp.x, opp.y, me.x, me.y)) : Infinity;
  const oppBoxed = opp !== null && p.itemSkill > 0.5 && straightClear(ctx, opp, 12) < 8;
  // How squarely the opponent sits ahead of us: 1 dead ahead, -1 behind.
  const ahead = opp ? ((opp.x - me.x) * detCos(me.heading) + (opp.y - me.y) * detSin(me.heading)) / Math.max(1, oppDist) : -1;

  const wants = (kind: PickupKind): boolean => {
    switch (kind) {
      case 'shield':
        return true;
      case 'missile': {
        // Fire when the opponent is roughly ahead and in range; a missile can turn, but not around.
        if (!opp) return unclog;
        if (oppDist > 320 || ahead < 0.3) return unclog;
        const chance = oppBoxed ? 0.5 : oppDist < 350 ? 0.12 : 0.03;
        return rngNext(bot.rng) < chance * (0.2 + 0.8 * p.itemSkill);
      }
      case 'ghost':
        return boxed || unclog;
      case 'scissors':
        // Cut through when boxed, or when the opponent's body is right ahead and worth shortening.
        return boxed || (opp !== null && oppDist < 260 && rngNext(bot.rng) < 0.04 * p.itemSkill) || unclog;
      case 'dozer':
        return boxed || unclog;
      case 'flame':
        // Light it when the opponent is ahead and within reach of the cone.
        if (!opp) return unclog;
        if (oppDist > cfg.flameRange * 1.3 || ahead < 0.6) return unclog;
        return rngNext(bot.rng) < 0.5 * (0.2 + 0.8 * p.itemSkill);
    }
  };

  for (let k = 0; k < me.items.length; k++) {
    const i = (me.selected + k) % me.items.length;
    if (wants(me.items[i].kind)) return i;
  }
  return null;
}

/** How many steps the other snake can hold course before hitting something static. */
function straightClear(ctx: Ctx, s: SnakeState, limit: number): number {
  const { state, cfg, r } = ctx;
  const stepDist = cruiseSpeed(cfg, false) * DT * STEP_TICKS;
  const cx = detCos(s.heading) * stepDist;
  const cy = detSin(s.heading) * stepDist;
  const probe = { blocked: false };
  for (let k = 1; k <= limit; k++) {
    const x = s.x + cx * k;
    const y = s.y + cy * k;
    if (circleHitsWall(x, y, r + 2, insetAt(state, cfg, k * STEP_TICKS)) || circleHitsTiles(state.tiles, x, y, r + 2)) return k - 1;
    probe.blocked = false;
    forEachSolidPointNear(state, x, y, 2 * r + 3, (snake) => {
      if (snake !== s.id) probe.blocked = true;
    });
    if (probe.blocked) return k - 1;
  }
  return limit;
}
