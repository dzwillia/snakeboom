import { cloneState, createMatch, NO_INPUT, step, type Config, type MatchState, type PlayerInput, type SimEvent } from '../sim';
import { smoothLead } from './timeSync';

export interface SessionOptions {
  seed: number;
  cfg: Config;
  /** Seats in the match (2–8). */
  players?: number;
  /** Which seat this machine plays. */
  local: number;
  /** Ticks between pressing a key and it taking effect, at least 1. */
  inputDelay: number;
  /** Ticks the predicted state may run ahead of the confirmed state. */
  maxRollback?: number;
  /** Estimated one-way latency to the peers in ticks, for the lead estimate. Can be set later. */
  oneWayTicks?: number;
  /** Outgoing local inputs, to be sent to the relay. */
  send: (tick: number, input: PlayerInput) => void;
  /** Called after every confirmed tick with the confirmed state; the place to take hashes. */
  onConfirmed?: (tick: number, state: MatchState, events: readonly SimEvent[]) => void;
}

export interface TaggedEvent {
  tick: number;
  event: SimEvent;
  /** True when the event came from a tick whose inputs are all known. */
  confirmed: boolean;
}

/** A head that a rollback moved: old predicted position minus new, in world units. */
export interface Correction {
  player: number;
  dx: number;
  dy: number;
}

export interface SessionStats {
  /** Ticks the predicted state has advanced. */
  ticks: number;
  rollbacks: number;
  maxRollbackDepth: number;
  /** Sum of rollback depths: ticks re-simulated. */
  rollbackTicks: number;
  stalledTicks: number;
  /** Remote inputs that arrived after their tick had already been predicted. */
  receivedLate: number;
}

export function emptyStats(): SessionStats {
  return { ticks: 0, rollbacks: 0, maxRollbackDepth: 0, rollbackTicks: 0, stalledTicks: 0, receivedLate: 0 };
}

/** What happened between two snapshots of the stats (max depth is the later one's). */
export function statsDelta(later: SessionStats, earlier: SessionStats): SessionStats {
  return {
    ticks: later.ticks - earlier.ticks,
    rollbacks: later.rollbacks - earlier.rollbacks,
    maxRollbackDepth: later.maxRollbackDepth,
    rollbackTicks: later.rollbackTicks - earlier.rollbackTicks,
    stalledTicks: later.stalledTicks - earlier.stalledTicks,
    receivedLate: later.receivedLate - earlier.receivedLate,
  };
}

/**
 * Ticks the predicted state may run ahead of the confirmed one before the game waits. 30 ticks is
 * 500 ms: enough for a hotspot's jitter spikes on top of a 150 ms one-way latency, and a 30-tick
 * rollback costs under 10 ms (pnpm bench:rollback).
 */
export const DEFAULT_MAX_ROLLBACK = 30;
/** How far behind the confirmed tick input history is kept, for late duplicates and rejoins. */
const KEEP_TICKS = 600;
const PRUNE_EVERY = 60;

function sameInput(a: PlayerInput, b: PlayerInput): boolean {
  return a.turn === b.turn && a.boost === b.boost && a.use === b.use && a.select === b.select;
}

function copyInput(i: PlayerInput): PlayerInput {
  return { turn: i.turn, boost: i.boost, use: i.use, select: i.select };
}

/**
 * Rollback netcode for one seat among up to eight. Two copies of the sim run: `confirmed` only
 * advances through ticks whose inputs from every seat are known, and `predicted` runs ahead of it
 * using a guess for each remote seat (its last known input, without Fire or Select). When a guess
 * turns out wrong, the predicted state is rebuilt from the confirmed one. The predicted state is
 * the one to draw.
 */
export class NetSession {
  readonly players: number;
  readonly local: number;
  /** The seats other than the local one. */
  readonly remotes: readonly number[];
  readonly inputDelay: number;
  readonly maxRollback: number;
  readonly stats: SessionStats = emptyStats();

  private confirmed: MatchState;
  private predicted: MatchState;
  private readonly cfg: Config;
  private readonly send: SessionOptions['send'];
  private readonly onConfirmed: SessionOptions['onConfirmed'];
  /** Known inputs per seat, by tick (the local seat's are the ones it scheduled). */
  private readonly inputs: Map<number, PlayerInput>[];
  /** Per predicted tick above the confirmed tick: the inputs each seat was stepped with. */
  private readonly predictedWith = new Map<number, PlayerInput[]>();
  private readonly latest: PlayerInput[];
  private readonly latestTick: number[];
  private needRollback = false;
  private stalledNow = false;
  private oneWayTicks: number;
  private leadEma: number | null = null;
  private pendingCorrections: Correction[] = [];

  constructor(opts: SessionOptions) {
    const players = opts.players ?? 2;
    if (!Number.isInteger(players) || players < 2 || players > 8) throw new RangeError(`players must be 2–8, got ${players}`);
    if (!Number.isInteger(opts.local) || opts.local < 0 || opts.local >= players) throw new RangeError(`local seat must be 0–${players - 1}, got ${opts.local}`);
    if (!Number.isInteger(opts.inputDelay) || opts.inputDelay < 1) throw new RangeError('inputDelay must be at least 1');
    this.players = players;
    this.local = opts.local;
    this.remotes = Array.from({ length: players }, (_, i) => i).filter((i) => i !== opts.local);
    this.inputDelay = opts.inputDelay;
    this.maxRollback = opts.maxRollback ?? DEFAULT_MAX_ROLLBACK;
    this.cfg = opts.cfg;
    this.oneWayTicks = opts.oneWayTicks ?? 2;
    this.send = opts.send;
    this.onConfirmed = opts.onConfirmed;
    this.confirmed = createMatch(opts.cfg, opts.seed, players);
    this.predicted = cloneState(this.confirmed);
    this.inputs = Array.from({ length: players }, () => new Map<number, PlayerInput>());
    this.latest = Array.from({ length: players }, () => NO_INPUT);
    this.latestTick = new Array<number>(players).fill(-1);
    // Ticks before the first scheduled input are neutral on every side by contract; nobody sends them.
    for (let t = 1; t < opts.inputDelay; t++) for (const map of this.inputs) map.set(t, NO_INPUT);
  }

  /** The state to draw. Replaced by a rollback, so don't hold on to it across frames. */
  get state(): MatchState {
    return this.predicted;
  }

  /** The state every known input agrees on; what hashes are taken from. Read only. */
  get confirmedState(): MatchState {
    return this.confirmed;
  }

  get tick(): number {
    return this.predicted.tick;
  }

  get confirmedTick(): number {
    return this.confirmed.tick;
  }

  /** True when the last advance() refused to step because a remote seat is too far behind. */
  get stalled(): boolean {
    return this.stalledNow;
  }

  setOneWayTicks(ticks: number): void {
    this.oneWayTicks = ticks;
  }

  /** The lead estimate smoothed over recent ticks; what time sync acts on. 0 before any remote input. */
  get smoothedLead(): number {
    return this.leadEma ?? 0;
  }

  /** Head jumps caused by rollbacks since the last call, for visual smoothing. Clears them. */
  takeCorrections(): Correction[] {
    const out = this.pendingCorrections;
    this.pendingCorrections = [];
    return out;
  }

  /** Highest tick received from the slowest remote seat, or −1 before every seat has sent. */
  get remoteTickSeen(): number {
    let min = Number.POSITIVE_INFINITY;
    for (const r of this.remotes) min = Math.min(min, this.latestTick[r]);
    return min === Number.POSITIVE_INFINITY ? -1 : min;
  }

  /** Highest tick received from any remote seat, or −1 before any. */
  get remoteTickMax(): number {
    let max = -1;
    for (const r of this.remotes) max = Math.max(max, this.latestTick[r]);
    return max;
  }

  /** A local input taken from the relay's log after a refresh. Stored without sending. */
  restoreLocal(tick: number, input: PlayerInput): void {
    if (!Number.isInteger(tick) || tick <= this.confirmed.tick || this.inputs[this.local].has(tick)) return;
    this.inputs[this.local].set(tick, copyInput(input));
  }

  /**
   * Rebuilds from a log: steps the confirmed state through up to `maxTicks` fully-known ticks and
   * mirrors it into the predicted state. Nothing is sent or predicted. Returns the ticks stepped.
   */
  catchUp(maxTicks: number): number {
    let stepped = 0;
    while (stepped < maxTicks) {
      const tick = this.confirmed.tick + 1;
      const known = this.knownInputs(tick);
      if (!known) break;
      const events = step(this.confirmed, known, this.cfg);
      this.onConfirmed?.(tick, this.confirmed, events);
      stepped++;
    }
    if (stepped > 0) {
      this.predicted = cloneState(this.confirmed);
      this.predictedWith.clear();
      this.needRollback = false;
    }
    return stepped;
  }

  /** True while the newest tick known from every remote seat is further ahead than the input delay explains. */
  get behind(): boolean {
    return this.remoteTickSeen - this.predicted.tick > this.inputDelay;
  }

  /** A remote seat's input for a tick. Any order is fine; duplicates and already-confirmed ticks are ignored. */
  receive(seat: number, tick: number, input: PlayerInput): void {
    if (seat === this.local || seat < 0 || seat >= this.players) return;
    const map = this.inputs[seat];
    if (!Number.isInteger(tick) || tick <= this.confirmed.tick || map.has(tick)) return;
    const stored = copyInput(input);
    map.set(tick, stored);
    if (tick > this.latestTick[seat]) {
      this.latestTick[seat] = tick;
      this.latest[seat] = stored;
    }
    if (tick <= this.predicted.tick) {
      this.stats.receivedLate++;
      const guessed = this.predictedWith.get(tick)?.[seat];
      if (!guessed || !sameInput(guessed, stored)) this.needRollback = true;
    }
  }

  /**
   * One local tick. Schedules `localInput` for tick + inputDelay and sends it (once, even across
   * a stall), reconciles remote inputs, then steps the predicted state unless it is already
   * maxRollback ticks ahead of the confirmed one.
   */
  advance(localInput: PlayerInput): TaggedEvent[] {
    // Normally only the scheduled tick is new. After a rejoin the ticks between the log's last
    // local input and the schedule are missing too, and nothing else would ever fill them.
    const mine = this.inputs[this.local];
    const target = this.predicted.tick + this.inputDelay;
    for (let tick = this.predicted.tick + 1; tick <= target; tick++) {
      if (mine.has(tick)) continue;
      const stored = copyInput(localInput);
      mine.set(tick, stored);
      this.send(tick, stored);
    }
    const events = this.reconcile();
    if (this.predicted.tick - this.confirmed.tick >= this.maxRollback) {
      this.stalledNow = true;
      this.stats.stalledTicks++;
      return events;
    }
    this.stalledNow = false;
    this.stats.ticks++;
    events.push(...this.stepPredicted());
    if (this.remoteTickSeen >= 0) this.leadEma = smoothLead(this.leadEma, this.lead(this.oneWayTicks));
    if (this.predicted.tick % PRUNE_EVERY === 0) this.prune();
    return events;
  }

  /**
   * Ticks this machine is ahead of the slowest peer. A peer sends its input for tick R + inputDelay
   * while at tick R, and that input took about `oneWayTicks` to get here.
   */
  lead(oneWayTicks: number): number {
    const seen = this.remoteTickSeen;
    if (seen < 0) return 0;
    const peerNow = seen - this.inputDelay + oneWayTicks;
    return this.predicted.tick - peerNow;
  }

  /** Every seat's input for `tick`, or null while any is missing. */
  private knownInputs(tick: number): PlayerInput[] | null {
    const out: PlayerInput[] = [];
    for (let seat = 0; seat < this.players; seat++) {
      const input = this.inputs[seat].get(tick);
      if (!input) return null;
      out.push(input);
    }
    return out;
  }

  private guess(seat: number): PlayerInput {
    const last = this.latest[seat];
    return { turn: last.turn, boost: last.boost, use: false, select: false };
  }

  private stepPredicted(): TaggedEvent[] {
    const tick = this.predicted.tick + 1;
    const inputs: PlayerInput[] = [];
    for (let seat = 0; seat < this.players; seat++) {
      inputs.push(this.inputs[seat].get(tick) ?? (seat === this.local ? NO_INPUT : this.guess(seat)));
    }
    this.predictedWith.set(tick, inputs);
    return step(this.predicted, inputs, this.cfg).map((event) => ({ tick, event, confirmed: false }));
  }

  private reconcile(): TaggedEvent[] {
    const out: TaggedEvent[] = [];
    const predictedTick = this.predicted.tick;
    for (;;) {
      const tick = this.confirmed.tick + 1;
      if (tick > predictedTick) break;
      const known = this.knownInputs(tick);
      if (!known) break;
      const events = step(this.confirmed, known, this.cfg);
      for (const event of events) out.push({ tick, event, confirmed: true });
      this.predictedWith.delete(tick);
      this.onConfirmed?.(tick, this.confirmed, events);
    }
    if (this.needRollback) {
      this.needRollback = false;
      const depth = predictedTick - this.confirmed.tick;
      this.stats.rollbacks++;
      this.stats.rollbackTicks += depth;
      if (depth > this.stats.maxRollbackDepth) this.stats.maxRollbackDepth = depth;
      const before = this.predicted.snakes.map((sn) => ({ x: sn.x, y: sn.y, alive: sn.alive }));
      this.predicted = cloneState(this.confirmed);
      this.predictedWith.clear();
      while (this.predicted.tick < predictedTick) out.push(...this.stepPredicted());
      this.predicted.snakes.forEach((sn, player) => {
        const was = before[player];
        if (!was || !was.alive || !sn.alive) return;
        const dx = was.x - sn.x;
        const dy = was.y - sn.y;
        if (dx * dx + dy * dy > 0.25) this.pendingCorrections.push({ player, dx, dy });
      });
    }
    return out;
  }

  private prune(): void {
    const cutoff = this.confirmed.tick - KEEP_TICKS;
    for (const map of this.inputs) {
      for (const tick of map.keys()) if (tick < cutoff) map.delete(tick);
    }
  }
}
