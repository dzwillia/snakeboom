import { NO_INPUT } from '../sim';
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
  /** Seats, 2–8 (2 by default). */
  size?: number;
  /** Seconds a disconnected player has to come back mid-match (two-player rooms only). */
  graceMs?: number;
  /** Silence before the room is closed. */
  idleMs?: number;
  /** Time with nobody connected before the room is closed. */
  emptyMs?: number;
}

/**
 * waiting: not full and not playing (joinable) · lobby: full, not playing · playing: a match is
 * on · closed: gone. After a match (result, forfeit, desync or everyone else leaving) the room goes
 * back to lobby or waiting for a rematch.
 */
export type RoomStatus = 'waiting' | 'lobby' | 'playing' | 'closed';

export const DEFAULT_GRACE_MS = 15_000;
export const DEFAULT_IDLE_MS = 600_000;
export const DEFAULT_EMPTY_MS = 120_000;
export const PING_EVERY_MS = 1_000;
/** A seat may run at most this many ticks ahead of the slowest live seat. */
export const MAX_TICK_LEAD = 600;
export const MIN_SIZE = 2;
export const MAX_SIZE = 8;
const UNKNOWN_RTT_MS = 100;
const START_LEAD_MS = 1_500;

export function clampSize(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : MIN_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n));
}

interface Seat {
  name: string;
  session: string;
  ready: boolean;
  connected: boolean;
  /** A hidden tab: still connected, but counting down (two-player) or ghosted (larger rooms). */
  away: boolean;
  /**
   * Absent mid-match in a room of three or more: the room synthesises neutral inputs for the seat
   * so nobody waits. Cleared by a rejoin; a seat that left on purpose stays a ghost until the match ends.
   */
  ghost: boolean;
  /** Left on purpose mid-match: the token is dead and the seat is freed when the match ends. */
  left: boolean;
  rttMs: number | null;
  lastTick: number;
  cancelGrace: (() => void) | null;
  result: RoundResult | null;
}

/**
 * Input delay in ticks from the players' round trips to the relay. Rollback absorbs the network,
 * so the local delay stays small: 1 tick on a LAN, 2 normally, 3 only when the one-way latency
 * between the two slowest players (about the mean of their round trips) is above 200 ms.
 */
export function inputDelayFor(...rtts: (number | null)[]): number {
  const known = rtts.map((r) => r ?? UNKNOWN_RTT_MS).sort((a, b) => b - a);
  const slowest = known.length === 0 ? UNKNOWN_RTT_MS : known[0];
  const next = known.length > 1 ? known[1] : slowest;
  const oneWayBetween = (slowest + next) / 2;
  if (oneWayBetween <= 20) return 1;
  if (oneWayBetween > 200) return 3;
  return 2;
}

/**
 * One match room: up to eight seats, a lobby, the input relay, hash refereeing, absent seats
 * (a countdown in two-player rooms, synthesised inputs in larger ones) and cleanup. It never
 * runs the sim. Everything time-related goes through the host.
 */
export class Room {
  readonly code: string;
  readonly size: number;
  onClosed: (() => void) | null = null;
  /** Called after every status change (the registry uses it for the quick-match queue). */
  onStatus: ((status: RoomStatus) => void) | null = null;

  private readonly seats: (Seat | null)[];
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
  /** The current match's parameters, for rejoins. `seats[roomSeat]` is the sim player index, or −1. */
  private match: { seed: number; winsToWin: number; players: number; seats: number[]; inputDelay: number; rttMs: number[] } | null = null;
  /** Input frames are forwarded from start until the match is over, including the round-over play-out after a result. */
  private relaying = false;

  constructor(
    private readonly host: RoomHost,
    opts: RoomOptions,
  ) {
    this.code = opts.code;
    this.size = clampSize(opts.size ?? MIN_SIZE);
    this.seats = Array.from({ length: this.size }, () => null);
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

  /** Connected players (a ghost whose socket is gone doesn't count). */
  get playerCount(): number {
    return this.seats.filter((s) => s?.connected).length;
  }

  /** Seated players, connected or not. */
  get seated(): number {
    return this.seats.filter((s) => s !== null).length;
  }

  /** The seat the next joiner gets, or null when the room is full or playing. */
  get nextFreeSeat(): number | null {
    if (this.statusNow !== 'waiting') return null;
    const i = this.seats.findIndex((s) => s === null);
    return i < 0 ? null : i;
  }

  /**
   * Nobody is connected and no match is waiting for a rejoin. Such a room lingers a while so its
   * link keeps working, but nothing in it is worth keeping.
   */
  get abandoned(): boolean {
    return this.playerCount === 0 && this.statusNow !== 'playing';
  }

  /** Frames relayed so far in the current match (sent to a rejoining client). */
  get log(): readonly Uint8Array[] {
    return this.inputLog;
  }

  join(name: string): { player: number; session: string } | 'full' {
    const player = this.nextFreeSeat;
    if (player === null) return 'full';
    const session = this.token();
    this.seats[player] = {
      name,
      session,
      ready: false,
      connected: true,
      away: false,
      ghost: false,
      left: false,
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
    if (!session) return null;
    const player = this.seats.findIndex((s) => s !== null && s.session === session);
    return player < 0 || this.statusNow === 'closed' ? null : player;
  }

  /**
   * A returning socket with its session token. Mid-match it gets the match parameters and the
   * input log from `fromTick` on, so it can rebuild the match before it sends anything.
   */
  rejoin(session: string, fromTick = 0): number | null {
    const player = this.seatForSession(session);
    if (player === null) return null;
    const seat = this.seats[player]!;
    seat.connected = true;
    seat.away = false;
    this.touch();
    this.clearEmpty();
    this.ensurePing();
    this.host.send(player, { type: 'welcome', player, room: this.code, session, name: seat.name });
    if (this.match && this.statusNow === 'playing') {
      // From here the seat sends its own frames again; the log already holds the synthesised ones.
      seat.ghost = false;
      const frames = this.inputLog.filter((f) => relayedTick(f) >= fromTick);
      this.host.send(player, { type: 'resume', ...this.match, frames: frames.length });
      this.host.send(player, encodeReplay(frames));
    }
    if (seat.cancelGrace) {
      seat.cancelGrace();
      seat.cancelGrace = null;
    }
    this.sendToOthers(player, { type: 'seatBack', seat: player });
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
          this.absent(player, seat);
        }
        return;
      case 'back':
        if (seat.away) {
          seat.away = false;
          if (seat.cancelGrace) {
            seat.cancelGrace();
            seat.cancelGrace = null;
          }
          if (seat.ghost && !seat.left) seat.ghost = false;
          this.sendToOthers(player, { type: 'seatBack', seat: player });
        }
        return;
      case 'leave':
        if (this.statusNow === 'playing' && this.size > 2) this.leaveMidMatch(player, seat);
        else this.freeSeat(player, 'left');
        this.host.close(player);
        return;
      default:
        return;
    }
  }

  onInput(player: number, frame: Uint8Array): void {
    const seat = this.seats[player];
    // Frames keep flowing after the result (the room is back in the lobby by then), so every
    // client can play out the round-over banner and reach the match-over screen together.
    if (!seat || !this.relaying || !seat.connected || seat.ghost) return;
    const decoded = decodeInput(frame);
    if (!decoded) return;
    const slowest = this.slowestLiveTick(player);
    if (decoded.tick <= seat.lastTick || decoded.tick > slowest + MAX_TICK_LEAD) return;
    seat.lastTick = decoded.tick;
    this.lastActivity = this.host.now();
    this.relay(player, decoded.tick, decoded.input);
    this.synthesise();
  }

  onDisconnect(player: number): void {
    const seat = this.seats[player];
    if (!seat || this.statusNow === 'closed') return;
    seat.connected = false;
    if (this.statusNow === 'playing') {
      this.absent(player, seat);
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

  /** At least two seated, and everyone seated connected and ready. */
  private maybeStart(): void {
    if (this.statusNow === 'playing' || this.statusNow === 'closed') return;
    const present = this.seats.filter((s): s is Seat => s !== null);
    if (present.length < 2 || !present.every((s) => s.ready && s.connected)) return;
    this.seed = Math.floor(this.host.random() * 2147483648);
    const inputDelay = inputDelayFor(...present.map((s) => s.rttMs));
    const startAt = this.host.now() + START_LEAD_MS;
    const seats: number[] = [];
    let players = 0;
    for (const seat of this.seats) seats.push(seat ? players++ : -1);
    const rttMs = this.seats.map((s) => s?.rttMs ?? UNKNOWN_RTT_MS);
    for (const seat of present) {
      seat.ready = false;
      seat.lastTick = -1;
      seat.result = null;
      seat.ghost = false;
      seat.left = false;
    }
    this.inputLog = [];
    this.hashes.clear();
    this.loggedRound = 0;
    this.relaying = true;
    this.setStatus('playing');
    this.match = { seed: this.seed, winsToWin: this.winsToWin, players, seats, inputDelay, rttMs };
    this.broadcast({ type: 'start', ...this.match, startAt });
    this.host.log({ event: 'start', seed: this.seed, players, inputDelay, rttMs, names: present.map((s) => s.name) });
  }

  /** The seats whose hashes and results count: connected and not ghosted. */
  private reporters(): number[] {
    const out: number[] = [];
    this.seats.forEach((s, i) => {
      if (s?.connected && !s.ghost) out.push(i);
    });
    return out;
  }

  private onHash(player: number, seat: Seat, tick: number, hash: number, result?: RoundResult): void {
    if (this.statusNow !== 'playing' || !Number.isInteger(tick) || typeof hash !== 'number') return;
    let row = this.hashes.get(tick);
    if (!row) {
      row = new Array<number | undefined>(this.size).fill(undefined);
      this.hashes.set(tick, row);
      // A rejoining client re-sends hashes for ticks already settled; drop old partial rows.
      for (const t of this.hashes.keys()) if (t < tick - 1200) this.hashes.delete(t);
    }
    row[player] = hash;
    if (result) seat.result = result;
    this.logRoundIfComplete();
    const reporters = this.reporters();
    if (reporters.length < 2 || !reporters.every((i) => row![i] !== undefined)) return;
    this.hashes.delete(tick);
    const reported = reporters.map((i) => row![i]);
    if (reported.some((h) => h !== reported[0])) {
      this.host.log({ event: 'desync', tick, hashes: reported, seats: reporters, seed: this.seed, frames: this.inputLog.length });
      this.broadcast({ type: 'desync', tick });
      this.backToLobby();
      return;
    }
    const results = reporters.map((i) => this.seats[i]!.result);
    const first = results[0];
    if (
      result &&
      first &&
      first.matchWinner !== null &&
      results.every((r) => r !== null && r.round === first.round && r.matchWinner === first.matchWinner)
    ) {
      this.host.log({ event: 'match', winner: first.matchWinner, scores: first.scores, rounds: first.round, seed: this.seed });
      this.backToLobby();
    }
  }

  /** Once every reporting seat has reported the same round, log its result with everyone's netcode stats. */
  private logRoundIfComplete(): void {
    const reporters = this.reporters();
    if (reporters.length === 0) return;
    const results = reporters.map((i) => this.seats[i]!.result);
    const first = results[0];
    if (!first || !results.every((r) => r !== null && r.round === first.round) || first.round === this.loggedRound) return;
    this.loggedRound = first.round;
    this.host.log({
      event: 'round',
      round: first.round,
      winner: first.winner,
      scores: first.scores,
      rttMs: this.seats.map((s) => s?.rttMs ?? null),
      net: this.seats.map((s) => s?.result?.net ?? null),
    });
  }

  /**
   * The match is finished: ghosts who never came back lose their seats, and everyone must opt into
   * a rematch. Frames keep relaying (until a seat empties or the next start) so the round-over
   * play-out reaches the match-over screen on every client.
   */
  private backToLobby(): void {
    this.match = null;
    this.seats.forEach((seat, player) => {
      if (!seat) return;
      seat.ready = false;
      if (seat.cancelGrace) {
        seat.cancelGrace();
        seat.cancelGrace = null;
      }
      if (seat.left || (seat.ghost && !seat.connected)) this.seats[player] = null;
      seat.ghost = false;
    });
    this.setStatus(this.seats.every((s) => s !== null) ? 'lobby' : 'waiting');
    this.broadcastLobby();
    if (this.playerCount === 0) this.scheduleEmpty();
  }

  /** A seat's connection dropped (or its tab hid) mid-match. */
  private absent(player: number, seat: Seat): void {
    if (this.size <= 2) {
      this.startGrace(player, seat);
      return;
    }
    if (!seat.ghost) {
      seat.ghost = true;
      this.sendToOthers(player, { type: 'seatAway', seat: player, deadline: null });
      this.host.log({ event: 'ghost', seat: player, reason: seat.connected ? 'away' : 'dropped' });
      this.synthesise();
    }
    this.endIfAlone();
  }

  /** A deliberate leave mid-match in a larger room: the seat is a ghost until the match ends and the token dies. */
  private leaveMidMatch(player: number, seat: Seat): void {
    seat.connected = false;
    seat.left = true;
    seat.session = '';
    if (!seat.ghost) {
      seat.ghost = true;
      this.synthesise();
    }
    this.sendToOthers(player, { type: 'seatLeft', seat: player });
    this.host.log({ event: 'left', seat: player });
    this.endIfAlone();
    if (this.playerCount === 0) this.scheduleEmpty();
  }

  /** Fewer than two humans left in a larger room: the last one standing wins and the room goes back to the lobby. */
  private endIfAlone(): void {
    if (this.statusNow !== 'playing' || this.size <= 2) return;
    const humans = this.reporters();
    if (humans.length >= 2) return;
    const winner = humans[0] ?? null;
    this.host.log({ event: 'ended', winner, seed: this.seed });
    if (winner !== null) this.host.send(winner, { type: 'ended', winner, reason: 'left' });
    this.backToLobby();
  }

  /** Two-player rooms: the other player gets a countdown, then wins by forfeit. */
  private startGrace(player: number, seat: Seat): void {
    if (seat.cancelGrace) return;
    const deadline = this.host.now() + this.graceMs;
    this.sendToOthers(player, { type: 'seatAway', seat: player, deadline });
    seat.cancelGrace = this.after(this.graceMs, () => {
      seat.cancelGrace = null;
      if (this.statusNow !== 'playing') return;
      this.freeSeat(player, 'timeout');
    });
  }

  /** Empties a seat. While playing (two-player rooms), the other player wins by forfeit. */
  private freeSeat(player: number, reason: 'left' | 'timeout'): void {
    const seat = this.seats[player];
    if (!seat) return;
    if (seat.cancelGrace) {
      seat.cancelGrace();
      seat.cancelGrace = null;
    }
    this.seats[player] = null;
    if (this.statusNow === 'playing') {
      this.relaying = false;
      this.match = null;
      const winner = this.seats.findIndex((s) => s !== null);
      this.host.log({ event: 'forfeit', loser: player, reason, seed: this.seed });
      if (winner >= 0 && this.seats[winner]?.connected) this.host.send(winner, { type: 'forfeit', winner, reason });
    } else {
      this.sendToOthers(player, { type: 'seatLeft', seat: player });
    }
    for (const s of this.seats) if (s) s.ready = false;
    this.setStatus('waiting');
    this.broadcastLobby();
    if (this.playerCount === 0) this.scheduleEmpty();
  }

  /** Forwards one input to every other connected seat and logs it. */
  private relay(player: number, tick: number, input: Parameters<typeof encodeRelayed>[2]): void {
    const relayed = encodeRelayed(player, tick, input);
    this.inputLog.push(relayed);
    this.seats.forEach((other, i) => {
      if (i !== player && other?.connected) this.host.send(i, relayed);
    });
  }

  /** The lowest last tick among the other seats still sending (0 before anyone has). */
  private slowestLiveTick(except: number): number {
    let min = Number.POSITIVE_INFINITY;
    this.seats.forEach((s, i) => {
      if (i === except || !s || s.ghost || !s.connected) return;
      min = Math.min(min, Math.max(0, s.lastTick));
    });
    return min === Number.POSITIVE_INFINITY ? 0 : min;
  }

  /**
   * Ghost seats get neutral inputs for every tick up to the highest tick any live seat has sent,
   * so the others never wait on an empty chair. Their snakes coast straight and take their chances.
   */
  private synthesise(): void {
    if (!this.relaying || !this.match) return;
    let upto = -1;
    for (const s of this.seats) if (s && !s.ghost && s.connected) upto = Math.max(upto, s.lastTick);
    this.seats.forEach((seat, player) => {
      if (!seat?.ghost || this.match!.seats[player] < 0) return;
      if (seat.lastTick < 0) seat.lastTick = 0; // ticks start at 1
      while (seat.lastTick < upto) {
        seat.lastTick++;
        this.relay(player, seat.lastTick, NO_INPUT);
      }
    });
  }

  private broadcastLobby(): void {
    const players: (LobbyPlayer | null)[] = this.seats.map((s) =>
      s ? { name: s.name, ready: s.ready, connected: s.connected && !s.away } : null,
    );
    const pingMs = this.pingMs();
    this.lastPingShown = pingMs;
    this.broadcast({ type: 'lobby', players, winsToWin: this.winsToWin, size: this.size, pingMs });
  }

  /** The relay's estimate of the latency between the players: the mean of the known round trips (null until two are known). */
  private pingMs(): number | null {
    const known = this.seats.map((s) => s?.rttMs).filter((r): r is number => r != null);
    if (known.length < 2) return null;
    return Math.round(known.reduce((a, b) => a + b, 0) / known.length);
  }

  private broadcast(message: ServerMessage): void {
    this.seats.forEach((seat, player) => {
      if (seat?.connected) this.host.send(player, message);
    });
  }

  private sendToOthers(player: number, message: ServerMessage): void {
    this.seats.forEach((seat, i) => {
      if (i !== player && seat?.connected) this.host.send(i, message);
    });
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
