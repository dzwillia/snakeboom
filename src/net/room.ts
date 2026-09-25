import { decodeInput, encodeRelayed, encodeReplay, relayedTick } from './codec';
import { ROOM_ALPHABET } from './names';
import type { ClientMessage, CloseReason, LobbyPlayer, RoundResult, ServerMessage } from './protocol';

/** What a room needs from its runtime: sockets, timers and a clock. Node and Durable Objects can both provide it. */
export interface RoomHost {
  /** Milliseconds. */
  now(): number;
  send(player: number, message: ServerMessage | Uint8Array): void;
  close(player: number): void;
  /** Returns a cancel function. */
  setTimer(ms: number, fn: () => void): () => void;
  /** [0, 1) */
  random(): number;
  log(entry: Record<string, unknown>): void;
}

export interface RoomOptions {
  code: string;
  winsToWin: number;
  /** Seconds a disconnected player has to come back mid-match. */
  graceMs?: number;
  /** Silence before the room is closed. */
  idleMs?: number;
  /** Time with nobody connected before the room is closed. */
  emptyMs?: number;
}

/**
 * waiting: one seat filled · lobby: both seated, not playing · playing: a match is on · closed: gone.
 * After a match (result, forfeit or desync) the room goes back to lobby or waiting for a rematch.
 */
export type RoomStatus = 'waiting' | 'lobby' | 'playing' | 'closed';

export const DEFAULT_GRACE_MS = 15_000;
export const DEFAULT_IDLE_MS = 600_000;
export const DEFAULT_EMPTY_MS = 120_000;
export const PING_EVERY_MS = 1_000;
/** A seat may run at most this many ticks ahead of the other. */
export const MAX_TICK_LEAD = 600;
const UNKNOWN_RTT_MS = 100;
const START_LEAD_MS = 1_500;

interface Seat {
  name: string;
  session: string;
  ready: boolean;
  connected: boolean;
  /** A hidden tab: still connected, but counting down like a disconnect. */
  away: boolean;
  rttMs: number | null;
  lastTick: number;
  cancelGrace: (() => void) | null;
  result: RoundResult | null;
}

/**
 * Input delay in ticks from the players' round trips to the relay. Rollback absorbs the network,
 * so the local delay stays small: 1 tick on a LAN, 2 normally, 3 only when the one-way latency
 * between the players (about the mean of their round trips) is above 200 ms.
 */
export function inputDelayFor(rttA: number | null, rttB: number | null): number {
  const oneWayBetween = ((rttA ?? UNKNOWN_RTT_MS) + (rttB ?? UNKNOWN_RTT_MS)) / 2;
  if (oneWayBetween <= 20) return 1;
  if (oneWayBetween > 200) return 3;
  return 2;
}

/**
 * One match room: two seats, a lobby, the input relay, hash refereeing, the disconnect countdown
 * and cleanup. It never runs the sim. Everything time-related goes through the host.
 */
export class Room {
  readonly code: string;
  onClosed: (() => void) | null = null;
  /** Called after every status change (the registry uses it for the quick-match queue). */
  onStatus: ((status: RoomStatus) => void) | null = null;

  private readonly seats: (Seat | null)[] = [null, null];
  private statusNow: RoomStatus = 'waiting';
  private readonly winsToWin: number;
  private readonly graceMs: number;
  private readonly idleMs: number;
  private readonly emptyMs: number;
  private readonly timers = new Set<() => void>();
  private cancelIdle: (() => void) | null = null;
  private cancelEmpty: (() => void) | null = null;
  private cancelPing: (() => void) | null = null;
  private lastActivity: number;
  /** Relayed frames of the current match, in arrival order, for rejoins. */
  private inputLog: Uint8Array[] = [];
  private readonly hashes = new Map<number, (number | undefined)[]>();
  private lastPingShown: number | null = null;
  private loggedRound = 0;
  private seed = 0;
  /** The current match's parameters, for rejoins. */
  private match: { seed: number; winsToWin: number; inputDelay: number; rttMs: number[] } | null = null;
  /** Input frames are forwarded from start until a seat empties, including the round-over play-out after a result. */
  private relaying = false;

  constructor(
    private readonly host: RoomHost,
    opts: RoomOptions,
  ) {
    this.code = opts.code;
    this.winsToWin = opts.winsToWin;
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.emptyMs = opts.emptyMs ?? DEFAULT_EMPTY_MS;
    this.lastActivity = host.now();
    this.scheduleIdle();
    this.scheduleEmpty();
  }

  get status(): RoomStatus {
    return this.statusNow;
  }

  private setStatus(status: RoomStatus): void {
    if (status === this.statusNow) return;
    this.statusNow = status;
    this.onStatus?.(status);
  }

  get playerCount(): number {
    return this.seats.filter((s) => s?.connected).length;
  }

  /** Nobody holds a seat (an empty room lingers a while so its link still works). */
  get empty(): boolean {
    return this.seats.every((s) => s === null);
  }

  /** Frames relayed so far in the current match (M6 sends these to a rejoining client). */
  get log(): readonly Uint8Array[] {
    return this.inputLog;
  }

  join(name: string): { player: number; session: string } | 'full' {
    if (this.statusNow !== 'waiting') return 'full';
    const player = this.seats.findIndex((s) => s === null);
    if (player < 0) return 'full';
    const session = this.token();
    this.seats[player] = {
      name,
      session,
      ready: false,
      connected: true,
      away: false,
      rttMs: null,
      lastTick: -1,
      cancelGrace: null,
      result: null,
    };
    this.touch();
    this.clearEmpty();
    this.ensurePing();
    this.setStatus(this.seats.every((s) => s !== null) ? 'lobby' : 'waiting');
    this.host.send(player, { type: 'welcome', player, room: this.code, session, name });
    this.broadcastLobby();
    return { player, session };
  }

  /** Which seat a session token belongs to, so the host can attach the socket before rejoin(). */
  seatForSession(session: string): number | null {
    const player = this.seats.findIndex((s) => s !== null && s.session === session);
    return player < 0 || this.statusNow === 'closed' ? null : player;
  }

  /**
   * A returning socket with its session token. Mid-match it gets the match parameters and the
   * input log from `fromTick` on, so it can rebuild the match before it sends anything.
   */
  rejoin(session: string, fromTick = 0): number | null {
    const player = this.seats.findIndex((s) => s !== null && s.session === session);
    if (player < 0 || this.statusNow === 'closed') return null;
    const seat = this.seats[player]!;
    seat.connected = true;
    seat.away = false;
    this.touch();
    this.clearEmpty();
    this.ensurePing();
    this.host.send(player, { type: 'welcome', player, room: this.code, session, name: seat.name });
    if (this.match && this.statusNow === 'playing') {
      const frames = this.inputLog.filter((f) => relayedTick(f) >= fromTick);
      this.host.send(player, { type: 'resume', ...this.match, frames: frames.length });
      this.host.send(player, encodeReplay(frames));
    }
    if (seat.cancelGrace) {
      seat.cancelGrace();
      seat.cancelGrace = null;
      this.sendToOther(player, { type: 'peerBack' });
    }
    this.broadcastLobby();
    return player;
  }

  onMessage(player: number, message: ClientMessage): void {
    const seat = this.seats[player];
    if (!seat || this.statusNow === 'closed') return;
    this.touch();
    switch (message.type) {
      case 'ready':
        if (this.statusNow === 'playing') return;
        seat.ready = message.ready === true;
        this.broadcastLobby();
        this.maybeStart();
        return;
      case 'pong': {
        if (typeof message.t !== 'number') return;
        seat.rttMs = Math.max(0, this.host.now() - message.t);
        // Keep the lobby's ping readout fresh while people wait, without spamming during play.
        const ping = this.pingMs();
        if (this.statusNow !== 'playing' && ping !== this.lastPingShown) this.broadcastLobby();
        return;
      }
      case 'hash':
        this.onHash(player, seat, message.tick, message.hash, message.result);
        return;
      case 'away':
        if (this.statusNow === 'playing' && !seat.away) {
          seat.away = true;
          this.startGrace(player, seat);
        }
        return;
      case 'back':
        if (seat.away) {
          seat.away = false;
          if (seat.cancelGrace) {
            seat.cancelGrace();
            seat.cancelGrace = null;
            this.sendToOther(player, { type: 'peerBack' });
          }
        }
        return;
      case 'leave':
        this.freeSeat(player, 'left');
        this.host.close(player);
        return;
      default:
        return;
    }
  }

  onInput(player: number, frame: Uint8Array): void {
    const seat = this.seats[player];
    // Frames keep flowing after the result (the room is back in the lobby by then), so both
    // clients can play out the round-over banner and reach the match-over screen together.
    if (!seat || !this.relaying || !seat.connected) return;
    const decoded = decodeInput(frame);
    if (!decoded) return;
    const other = this.seats[1 - player];
    const otherTick = other ? Math.max(0, other.lastTick) : 0;
    if (decoded.tick <= seat.lastTick || decoded.tick > otherTick + MAX_TICK_LEAD) return;
    seat.lastTick = decoded.tick;
    this.lastActivity = this.host.now();
    const relayed = encodeRelayed(player, decoded.tick, decoded.input);
    this.inputLog.push(relayed);
    if (other?.connected) this.host.send(1 - player, relayed);
  }

  onDisconnect(player: number): void {
    const seat = this.seats[player];
    if (!seat || this.statusNow === 'closed') return;
    seat.connected = false;
    if (this.statusNow === 'playing') {
      this.startGrace(player, seat);
    } else {
      this.freeSeat(player, 'left');
    }
    if (this.playerCount === 0) this.scheduleEmpty();
  }

  /** Ends the room for everyone, for example when the server shuts down. */
  close(reason: CloseReason): void {
    if (this.statusNow === 'closed') return;
    this.setStatus('closed');
    for (const cancel of this.timers) cancel();
    this.timers.clear();
    this.seats.forEach((seat, player) => {
      if (!seat?.connected) return;
      this.host.send(player, { type: 'closed', reason });
      this.host.close(player);
    });
    this.host.log({ event: 'closed', reason });
    this.onClosed?.();
  }

  private maybeStart(): void {
    if (this.statusNow !== 'lobby') return;
    const [a, b] = this.seats;
    if (!a || !b || !a.ready || !b.ready || !a.connected || !b.connected) return;
    this.seed = Math.floor(this.host.random() * 2147483648);
    const inputDelay = inputDelayFor(a.rttMs, b.rttMs);
    const startAt = this.host.now() + START_LEAD_MS;
    const rttMs = [a.rttMs ?? UNKNOWN_RTT_MS, b.rttMs ?? UNKNOWN_RTT_MS];
    for (const seat of [a, b]) {
      seat.ready = false;
      seat.lastTick = -1;
      seat.result = null;
    }
    this.inputLog = [];
    this.hashes.clear();
    this.loggedRound = 0;
    this.relaying = true;
    this.setStatus('playing');
    this.match = { seed: this.seed, winsToWin: this.winsToWin, inputDelay, rttMs };
    const message: ServerMessage = { type: 'start', ...this.match, startAt };
    this.host.send(0, message);
    this.host.send(1, message);
    this.host.log({ event: 'start', seed: this.seed, inputDelay, rttMs, names: [a.name, b.name] });
  }

  private onHash(player: number, seat: Seat, tick: number, hash: number, result?: RoundResult): void {
    if (this.statusNow !== 'playing' || !Number.isInteger(tick) || typeof hash !== 'number') return;
    let pair = this.hashes.get(tick);
    if (!pair) {
      pair = [undefined, undefined];
      this.hashes.set(tick, pair);
      // A rejoining client re-sends hashes for ticks already settled; drop old half-pairs.
      for (const t of this.hashes.keys()) if (t < tick - 1200) this.hashes.delete(t);
    }
    pair[player] = hash;
    if (result) seat.result = result;
    this.logRoundIfComplete();
    const [a, b] = pair;
    if (a === undefined || b === undefined) return;
    this.hashes.delete(tick);
    if (a !== b) {
      this.host.log({ event: 'desync', tick, hashes: [a, b], seed: this.seed, frames: this.inputLog.length });
      this.broadcast({ type: 'desync', tick });
      this.backToLobby();
      return;
    }
    const other = this.seats[1 - player];
    const r0 = this.seats[0]?.result;
    const r1 = this.seats[1]?.result;
    if (result && other?.result && r0 && r1 && r0.round === r1.round && r0.matchWinner !== null && r0.matchWinner === r1.matchWinner) {
      this.host.log({ event: 'match', winner: r0.matchWinner, scores: r0.scores, rounds: r0.round, seed: this.seed });
      this.backToLobby();
    }
  }

  /** Once both seats have reported the same round, log its result with both sides' netcode stats. */
  private logRoundIfComplete(): void {
    const r0 = this.seats[0]?.result;
    const r1 = this.seats[1]?.result;
    if (!r0 || !r1 || r0.round !== r1.round || r0.round === this.loggedRound) return;
    this.loggedRound = r0.round;
    const [a, b] = this.seats;
    this.host.log({
      event: 'round',
      round: r0.round,
      winner: r0.winner,
      scores: r0.scores,
      rttMs: [a?.rttMs ?? null, b?.rttMs ?? null],
      net: [r0.net ?? null, r1.net ?? null],
    });
  }

  /** The match is finished: clear the ready flags so both must opt into a rematch. */
  private backToLobby(): void {
    this.match = null;
    for (const seat of this.seats) {
      if (!seat) continue;
      seat.ready = false;
      if (seat.cancelGrace) {
        seat.cancelGrace();
        seat.cancelGrace = null;
      }
    }
    this.setStatus(this.seats.every((s) => s !== null) ? 'lobby' : 'waiting');
    this.broadcastLobby();
  }

  private startGrace(player: number, seat: Seat): void {
    if (seat.cancelGrace) return;
    const deadline = this.host.now() + this.graceMs;
    this.sendToOther(player, { type: 'peerAway', deadline });
    seat.cancelGrace = this.after(this.graceMs, () => {
      seat.cancelGrace = null;
      if (this.statusNow !== 'playing') return;
      this.freeSeat(player, 'timeout');
    });
  }

  /** Empties a seat. While playing, the other player wins by forfeit. */
  private freeSeat(player: number, reason: 'left' | 'timeout'): void {
    const seat = this.seats[player];
    if (!seat) return;
    if (seat.cancelGrace) {
      seat.cancelGrace();
      seat.cancelGrace = null;
    }
    this.seats[player] = null;
    this.relaying = false;
    const other = this.seats[1 - player];
    if (this.statusNow === 'playing') {
      this.host.log({ event: 'forfeit', loser: player, reason, seed: this.seed });
      if (other?.connected) this.host.send(1 - player, { type: 'forfeit', winner: 1 - player, reason });
      this.match = null;
    } else if (other?.connected) {
      this.host.send(1 - player, { type: 'peerLeft' });
    }
    if (other) other.ready = false;
    this.setStatus('waiting');
    this.broadcastLobby();
    if (this.playerCount === 0) this.scheduleEmpty();
  }

  private broadcastLobby(): void {
    const players: (LobbyPlayer | null)[] = this.seats.map((s) =>
      s ? { name: s.name, ready: s.ready, connected: s.connected && !s.away } : null,
    );
    const pingMs = this.pingMs();
    this.lastPingShown = pingMs;
    this.broadcast({ type: 'lobby', players, winsToWin: this.winsToWin, pingMs });
  }

  /** The relay's estimate of the latency between the players: the mean of their round trips. */
  private pingMs(): number | null {
    const [a, b] = this.seats;
    return a?.rttMs != null && b?.rttMs != null ? Math.round((a.rttMs + b.rttMs) / 2) : null;
  }

  private broadcast(message: ServerMessage): void {
    this.seats.forEach((seat, player) => {
      if (seat?.connected) this.host.send(player, message);
    });
  }

  private sendToOther(player: number, message: ServerMessage): void {
    const other = this.seats[1 - player];
    if (other?.connected) this.host.send(1 - player, message);
  }

  private ensurePing(): void {
    if (this.cancelPing) return;
    const tick = () => {
      this.cancelPing = null;
      if (this.statusNow === 'closed' || this.playerCount === 0) return;
      const ping: ServerMessage = { type: 'ping', t: this.host.now(), pingMs: this.pingMs() };
      this.broadcast(ping);
      this.cancelPing = this.after(PING_EVERY_MS, tick);
    };
    this.cancelPing = this.after(PING_EVERY_MS, tick);
  }

  private touch(): void {
    this.lastActivity = this.host.now();
  }

  /** One timer, re-armed for the remaining time whenever it finds recent activity. */
  private scheduleIdle(ms = this.idleMs): void {
    this.cancelIdle?.();
    this.cancelIdle = this.after(ms, () => {
      this.cancelIdle = null;
      const quiet = this.host.now() - this.lastActivity;
      if (quiet >= this.idleMs) this.close('idle');
      else this.scheduleIdle(this.idleMs - quiet);
    });
  }

  private scheduleEmpty(): void {
    this.clearEmpty();
    this.cancelEmpty = this.after(this.emptyMs, () => {
      this.cancelEmpty = null;
      if (this.playerCount === 0) this.close('idle');
    });
  }

  private clearEmpty(): void {
    this.cancelEmpty?.();
    this.cancelEmpty = null;
  }

  /** A timer that is tracked, so closing the room cancels it, and that never fires after close. */
  private after(ms: number, fn: () => void): () => void {
    let cancel: () => void = () => {};
    const wrapped = () => {
      this.timers.delete(cancel);
      if (this.statusNow !== 'closed') fn();
    };
    const raw = this.host.setTimer(ms, wrapped);
    cancel = () => {
      this.timers.delete(cancel);
      raw();
    };
    this.timers.add(cancel);
    return cancel;
  }

  private token(): string {
    let out = '';
    for (let i = 0; i < 20; i++) out += ROOM_ALPHABET[Math.min(31, Math.floor(this.host.random() * 32))];
    return out;
  }
}
