import { cloneState, createMatch, NO_INPUT, step, type Config, type MatchState, type PlayerInput, type SimEvent } from '../sim';
import { smoothLead } from './timeSync';

export interface SessionOptions {
  seed: number;
  cfg: Config;
  /** 0 or 1: which seat this machine plays. */
  local: number;
  /** Ticks between pressing a key and it taking effect, at least 1. */
  inputDelay: number;
  /** Ticks the predicted state may run ahead of the confirmed state. */
  maxRollback?: number;
  /** Estimated one-way latency to the peer in ticks, for the lead estimate. Can be set later. */
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
  return a.turn === b.turn && a.boost === b.boost && a.use === b.use;
}

function copyInput(i: PlayerInput): PlayerInput {
  return { turn: i.turn, boost: i.boost, use: i.use };
}

/**
 * Rollback netcode for one seat. Two copies of the sim run: `confirmed` only advances through
 * ticks whose inputs from both seats are known, and `predicted` runs ahead of it using a guess
 * for the remote seat (its last known input, without Use). When a guess turns out wrong, the
 * predicted state is rebuilt from the confirmed one. The predicted state is the one to draw.
 */
export class NetSession {
  readonly local: number;
  readonly remote: number;
  readonly inputDelay: number;
  readonly maxRollback: number;
  readonly stats: SessionStats = emptyStats();

  private confirmed: MatchState;
  private predicted: MatchState;
  private readonly cfg: Config;
  private readonly send: SessionOptions['send'];
  private readonly onConfirmed: SessionOptions['onConfirmed'];
  private readonly localInputs = new Map<number, PlayerInput>();
  private readonly remoteInputs = new Map<number, PlayerInput>();
  /** The remote input each predicted tick above the confirmed tick was stepped with. */
  private readonly predictedRemote = new Map<number, PlayerInput>();
  private latestRemote: PlayerInput = NO_INPUT;
  private latestRemoteTick = -1;
  private needRollback = false;
  private stalledNow = false;
  private oneWayTicks: number;
  private leadEma: number | null = null;

  constructor(opts: SessionOptions) {
    if (opts.local !== 0 && opts.local !== 1) throw new RangeError(`local seat must be 0 or 1, got ${opts.local}`);
    if (!Number.isInteger(opts.inputDelay) || opts.inputDelay < 1) throw new RangeError('inputDelay must be at least 1');
    this.local = opts.local;
    this.remote = 1 - opts.local;
    this.inputDelay = opts.inputDelay;
    this.maxRollback = opts.maxRollback ?? DEFAULT_MAX_ROLLBACK;
    this.cfg = opts.cfg;
    this.oneWayTicks = opts.oneWayTicks ?? 2;
    this.send = opts.send;
    this.onConfirmed = opts.onConfirmed;
    this.confirmed = createMatch(opts.cfg, opts.seed);
    this.predicted = cloneState(this.confirmed);
    // Ticks before the first scheduled input are neutral on both sides by contract; nobody sends them.
    for (let t = 1; t < opts.inputDelay; t++) {
      this.localInputs.set(t, NO_INPUT);
      this.remoteInputs.set(t, NO_INPUT);
    }
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

  /** True when the last advance() refused to step because the remote is too far behind. */
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

  /** Highest remote tick received, or −1 before any. */
  get remoteTickSeen(): number {
    return this.latestRemoteTick;
  }

  /** A local input taken from the relay's log after a refresh. Stored without sending. */
  restoreLocal(tick: number, input: PlayerInput): void {
    if (!Number.isInteger(tick) || tick <= this.confirmed.tick || this.localInputs.has(tick)) return;
    this.localInputs.set(tick, copyInput(input));
  }

  /**
   * Rebuilds from a log: steps the confirmed state through up to `maxTicks` fully-known ticks and
   * mirrors it into the predicted state. Nothing is sent or predicted. Returns the ticks stepped.
   */
  catchUp(maxTicks: number): number {
    let stepped = 0;
    while (stepped < maxTicks) {
      const tick = this.confirmed.tick + 1;
      const remote = this.remoteInputs.get(tick);
      const local = this.localInputs.get(tick);
      if (!remote || !local) break;
      const events = step(this.confirmed, this.seatInputs(tick, remote), this.cfg);
      this.onConfirmed?.(tick, this.confirmed, events);
      stepped++;
    }
    if (stepped > 0) {
      this.predicted = cloneState(this.confirmed);
      this.predictedRemote.clear();
      this.needRollback = false;
    }
    return stepped;
  }

  /** True while the newest known remote tick is further ahead than the input delay explains. */
  get behind(): boolean {
    return this.latestRemoteTick - this.predicted.tick > this.inputDelay;
  }

  /** A remote input for a tick. Any order is fine; duplicates and already-confirmed ticks are ignored. */
  receive(tick: number, input: PlayerInput): void {
    if (!Number.isInteger(tick) || tick <= this.confirmed.tick || this.remoteInputs.has(tick)) return;
    const stored = copyInput(input);
    this.remoteInputs.set(tick, stored);
    if (tick > this.latestRemoteTick) {
      this.latestRemoteTick = tick;
      this.latestRemote = stored;
    }
    if (tick <= this.predicted.tick) {
      this.stats.receivedLate++;
      const guessed = this.predictedRemote.get(tick);
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
    const target = this.predicted.tick + this.inputDelay;
    for (let tick = this.predicted.tick + 1; tick <= target; tick++) {
      if (this.localInputs.has(tick)) continue;
      const stored = copyInput(localInput);
      this.localInputs.set(tick, stored);
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
    if (this.latestRemoteTick >= 0) this.leadEma = smoothLead(this.leadEma, this.lead(this.oneWayTicks));
    if (this.predicted.tick % PRUNE_EVERY === 0) this.prune();
    return events;
  }

  /**
   * Ticks this machine is ahead of the peer. The peer sends its input for tick R + inputDelay
   * while at tick R, and that input took about `oneWayTicks` to get here.
   */
  lead(oneWayTicks: number): number {
    if (this.latestRemoteTick < 0) return 0;
    const peerNow = this.latestRemoteTick - this.inputDelay + oneWayTicks;
    return this.predicted.tick - peerNow;
  }

  private seatInputs(tick: number, remote: PlayerInput): PlayerInput[] {
    const inputs: PlayerInput[] = [NO_INPUT, NO_INPUT];
    inputs[this.local] = this.localInputs.get(tick) ?? NO_INPUT;
    inputs[this.remote] = remote;
    return inputs;
  }

  private guessRemote(): PlayerInput {
    return { turn: this.latestRemote.turn, boost: this.latestRemote.boost, use: false };
  }

  private stepPredicted(): TaggedEvent[] {
    const tick = this.predicted.tick + 1;
    const remote = this.remoteInputs.get(tick) ?? this.guessRemote();
    this.predictedRemote.set(tick, remote);
    return step(this.predicted, this.seatInputs(tick, remote), this.cfg).map((event) => ({ tick, event, confirmed: false }));
  }

  private reconcile(): TaggedEvent[] {
    const out: TaggedEvent[] = [];
    const predictedTick = this.predicted.tick;
    for (;;) {
      const tick = this.confirmed.tick + 1;
      if (tick > predictedTick) break;
      const remote = this.remoteInputs.get(tick);
      const local = this.localInputs.get(tick);
      if (!remote || !local) break;
      const events = step(this.confirmed, this.seatInputs(tick, remote), this.cfg);
      for (const event of events) out.push({ tick, event, confirmed: true });
      this.predictedRemote.delete(tick);
      this.onConfirmed?.(tick, this.confirmed, events);
    }
    if (this.needRollback) {
      this.needRollback = false;
      const depth = predictedTick - this.confirmed.tick;
      this.stats.rollbacks++;
      this.stats.rollbackTicks += depth;
      if (depth > this.stats.maxRollbackDepth) this.stats.maxRollbackDepth = depth;
      this.predicted = cloneState(this.confirmed);
      this.predictedRemote.clear();
      while (this.predicted.tick < predictedTick) out.push(...this.stepPredicted());
    }
    return out;
  }

  private prune(): void {
    const cutoff = this.confirmed.tick - KEEP_TICKS;
    for (const map of [this.localInputs, this.remoteInputs]) {
      for (const tick of map.keys()) if (tick < cutoff) map.delete(tick);
    }
  }
}
