import type { MatchState, PlayerInput, SimEvent } from '../sim';
import { createRng, rngNext, type RngState } from '../sim/rng';
import { NetSession, type SessionOptions } from './session';

export interface FakeLinkOptions {
  /** One-way latency between the two players (through the relay). */
  latencyMs: number;
  jitterMs: number;
  seed: number;
  /** Extra delay on every packet sent during a 200 ms burst, every `spikeEveryMs` ± 50%. Off when 0. */
  spikeMs?: number;
  spikeEveryMs?: number;
  /** TCP-style head-of-line blocking: every `holdEveryMs` ± 50%, packets are held for `holdMs` and then delivered in order. */
  holdMs?: number;
  holdEveryMs?: number;
}

const SPIKE_WINDOW_MS = 200;

interface Packet {
  due: number;
  seq: number;
  to: number;
  tick: number;
  input: PlayerInput;
}

/**
 * Connects two sessions through a virtual clock. Inputs arrive latency ± jitter later, so they
 * can overtake each other, and either side's traffic can be held to simulate a dropped connection.
 */
export class FakeLink {
  now = 0;
  private sessions: [NetSession, NetSession] | null = null;
  private queue: Packet[] = [];
  private readonly held: [Packet[], Packet[]] = [[], []];
  private readonly paused = [false, false];
  private readonly rng: RngState;
  private seq = 0;
  private nextSpikeAt = Number.POSITIVE_INFINITY;
  private spikeUntil = 0;
  private nextHoldAt = Number.POSITIVE_INFINITY;
  private holdUntil = 0;
  /** Every input ever sent through the link, in send order: the relay's log. */
  readonly sent: { from: number; tick: number; input: PlayerInput }[] = [];

  constructor(private readonly opts: FakeLinkOptions) {
    this.rng = createRng(opts.seed);
    if (opts.spikeMs && opts.spikeEveryMs) this.nextSpikeAt = this.jittered(opts.spikeEveryMs);
    if (opts.holdMs && opts.holdEveryMs) this.nextHoldAt = this.jittered(opts.holdEveryMs);
  }

  /** `base` ± 50%. */
  private jittered(base: number): number {
    return base * (0.5 + rngNext(this.rng));
  }

  /** Starts a spike or a hold when its time has come; called as the clock moves. */
  private schedule(): void {
    if (this.now >= this.nextSpikeAt) {
      this.spikeUntil = this.now + SPIKE_WINDOW_MS;
      this.nextSpikeAt = this.now + this.jittered(this.opts.spikeEveryMs ?? 0);
    }
    if (this.now >= this.nextHoldAt) {
      this.holdUntil = this.now + (this.opts.holdMs ?? 0);
      this.nextHoldAt = this.now + this.jittered(this.opts.holdEveryMs ?? 0);
    }
  }

  attach(sessions: [NetSession, NetSession]): void {
    this.sessions = sessions;
  }

  /** Called by a session's `send`: side `from` sends its input for `tick`. */
  enqueue(from: number, tick: number, input: PlayerInput): void {
    const packet: Packet = { due: 0, seq: this.seq++, to: 1 - from, tick, input };
    this.sent.push({ from, tick, input });
    if (this.paused[from]) this.held[from].push(packet);
    else this.post(packet);
  }

  /** Holds (or releases) all traffic from one side. Released packets get fresh delivery times. */
  pause(side: number, paused: boolean): void {
    this.paused[side] = paused;
    if (!paused) {
      for (const packet of this.held[side]) this.post(packet);
      this.held[side].length = 0;
    }
  }

  /** Advances the clock and delivers everything that is due, in delivery order. */
  advance(ms: number): void {
    this.now += ms;
    this.schedule();
    if (!this.sessions) throw new Error('attach sessions first');
    const due = this.queue.filter((p) => p.due <= this.now).sort((a, b) => a.due - b.due || a.seq - b.seq);
    this.queue = this.queue.filter((p) => p.due > this.now);
    for (const p of due) this.sessions[p.to].receive(p.tick, p.input);
  }

  get pending(): number {
    return this.queue.length + this.held[0].length + this.held[1].length;
  }

  private post(packet: Packet): void {
    const jitter = (rngNext(this.rng) * 2 - 1) * this.opts.jitterMs;
    let due = this.now + Math.max(0, this.opts.latencyMs + jitter);
    if (this.now < this.spikeUntil) due += this.opts.spikeMs ?? 0;
    if (this.now < this.holdUntil) due = Math.max(due, this.holdUntil + (this.opts.latencyMs ?? 0));
    packet.due = due;
    this.queue.push(packet);
  }
}

/** Two sessions, one per seat, wired through a FakeLink. */
export function createLinkedSessions(
  linkOpts: FakeLinkOptions,
  sessionOpts: Omit<SessionOptions, 'local' | 'send' | 'onConfirmed'>,
  onConfirmed?: (side: number, tick: number, state: MatchState, events: readonly SimEvent[]) => void,
): { link: FakeLink; sessions: [NetSession, NetSession] } {
  const link = new FakeLink(linkOpts);
  const make = (side: number) =>
    new NetSession({
      ...sessionOpts,
      local: side,
      send: (tick, input) => link.enqueue(side, tick, input),
      onConfirmed: onConfirmed && ((tick, state, events) => onConfirmed(side, tick, state, events)),
    });
  const sessions: [NetSession, NetSession] = [make(0), make(1)];
  link.attach(sessions);
  return { link, sessions };
}
