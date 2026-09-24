import type { MatchState, PlayerInput, SimEvent } from '../sim';
import { createRng, rngNext, type RngState } from '../sim/rng';
import { NetSession, type SessionOptions } from './session';

export interface FakeLinkOptions {
  latencyMs: number;
  jitterMs: number;
  seed: number;
}

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
  /** Every input ever sent through the link, in send order: the relay's log. */
  readonly sent: { from: number; tick: number; input: PlayerInput }[] = [];

  constructor(private readonly opts: FakeLinkOptions) {
    this.rng = createRng(opts.seed);
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
    packet.due = this.now + Math.max(0, this.opts.latencyMs + jitter);
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
