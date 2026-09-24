import { describe, expect, it } from 'vitest';
import { NO_INPUT } from '../sim';
import { decodeRelayed, decodeReplay, encodeInput } from './codec';
import type { ServerMessage } from './protocol';
import { DEFAULT_EMPTY_MS, DEFAULT_GRACE_MS, DEFAULT_IDLE_MS, inputDelayFor, Room, type RoomHost } from './room';

type Sent = ServerMessage | Uint8Array;

class FakeHost implements RoomHost {
  t = 0;
  readonly sent: Sent[][] = [[], []];
  readonly closed = [false, false];
  readonly logs: Record<string, unknown>[] = [];
  private timers: { due: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  private r = 12345;

  now(): number {
    return this.t;
  }
  send(player: number, message: Sent): void {
    this.sent[player].push(message);
  }
  close(player: number): void {
    this.closed[player] = true;
  }
  setTimer(ms: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ due: this.t + ms, fn, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }
  random(): number {
    this.r = (this.r * 1103515245 + 12345) % 2147483648;
    return this.r / 2147483648;
  }
  log(entry: Record<string, unknown>): void {
    this.logs.push(entry);
  }

  /** Advances the clock, firing timers in due order. */
  tick(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      const next = this.timers.filter((x) => x.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x.id !== next.id);
      this.t = Math.max(this.t, next.due);
      next.fn();
    }
    this.t = end;
  }
  get pendingTimers(): number {
    return this.timers.length;
  }
  messages(player: number, type: ServerMessage['type']): ServerMessage[] {
    return this.sent[player].filter((m): m is ServerMessage => !(m instanceof Uint8Array) && m.type === type);
  }
  last(player: number, type: ServerMessage['type']): ServerMessage | undefined {
    const all = this.messages(player, type);
    return all[all.length - 1];
  }
  frames(player: number): Uint8Array[] {
    return this.sent[player].filter((m): m is Uint8Array => m instanceof Uint8Array);
  }
}

function lobbyWith(host: FakeHost, winsToWin = 5): Room {
  const room = new Room(host, { code: 'ABCDEF', winsToWin });
  expect(room.join('Ada')).toEqual({ player: 0, session: expect.any(String) });
  expect(room.join('Bob')).toEqual({ player: 1, session: expect.any(String) });
  return room;
}

function started(host: FakeHost, rtts: [number, number] = [60, 80]): Room {
  const room = lobbyWith(host);
  host.tick(1000);
  const ping0 = host.last(0, 'ping') as { t: number };
  host.t += rtts[0];
  room.onMessage(0, { type: 'pong', t: ping0.t });
  host.t += rtts[1] - rtts[0];
  room.onMessage(1, { type: 'pong', t: ping0.t });
  room.onMessage(0, { type: 'ready', ready: true });
  room.onMessage(1, { type: 'ready', ready: true });
  expect(room.status).toBe('playing');
  return room;
}

describe('inputDelayFor', () => {
  it('rounds the one-way latency between the players up to ticks, within 1–4', () => {
    expect(inputDelayFor(60, 80)).toBe(3);
    expect(inputDelayFor(20, 20)).toBe(1);
    expect(inputDelayFor(200, 250)).toBe(4);
    expect(inputDelayFor(null, null)).toBe(3);
    expect(inputDelayFor(0, 0)).toBe(1);
  });
});

describe('Room joining', () => {
  it('seats two players, then is full', () => {
    const host = new FakeHost();
    const room = new Room(host, { code: 'ABCDEF', winsToWin: 3 });
    expect(room.status).toBe('waiting');
    room.join('Ada');
    expect(room.status).toBe('waiting');
    expect(host.last(0, 'welcome')).toMatchObject({ player: 0, room: 'ABCDEF', name: 'Ada' });
    room.join('Bob');
    expect(room.status).toBe('lobby');
    expect(host.last(1, 'welcome')).toMatchObject({ player: 1 });
    expect(room.join('Cy')).toBe('full');
    expect(host.last(0, 'lobby')).toMatchObject({
      players: [
        { name: 'Ada', ready: false, connected: true },
        { name: 'Bob', ready: false, connected: true },
      ],
      winsToWin: 3,
      pingMs: null,
    });
    expect(room.playerCount).toBe(2);
  });
});

describe('Room ready-up and start', () => {
  it('starts only when both are ready, with one seed, a delay from the pings and a start time', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    room.onMessage(0, { type: 'ready', ready: true });
    expect(room.status).toBe('lobby');
    expect(host.messages(0, 'start')).toHaveLength(0);
    expect(host.last(1, 'lobby')).toMatchObject({ players: [{ ready: true }, { ready: false }] });
    room.onMessage(0, { type: 'ready', ready: false });
    room.onMessage(1, { type: 'ready', ready: true });
    expect(room.status).toBe('lobby');
    host.t = 5000;
    room.onMessage(0, { type: 'ready', ready: true });
    expect(room.status).toBe('playing');
    const s0 = host.last(0, 'start') as Extract<ServerMessage, { type: 'start' }>;
    const s1 = host.last(1, 'start') as Extract<ServerMessage, { type: 'start' }>;
    expect(s0).toEqual(s1);
    expect(s0.winsToWin).toBe(5);
    expect(s0.inputDelay).toBe(3);
    expect(s0.startAt).toBe(6500);
    expect(s0.rttMs).toEqual([100, 100]);
  });

  it('measures pings and uses them for the delay and the lobby readout', () => {
    const host = new FakeHost();
    const room = started(host, [60, 80]);
    const start = host.last(0, 'start') as Extract<ServerMessage, { type: 'start' }>;
    expect(start.inputDelay).toBe(3);
    expect(start.rttMs).toEqual([60, 80]);
    const host2 = new FakeHost();
    started(host2, [200, 250]);
    expect((host2.last(0, 'start') as { inputDelay: number }).inputDelay).toBe(4);
    expect(host2.last(0, 'lobby')).toMatchObject({ pingMs: 225 });
    expect(room.status).toBe('playing');
  });
});

describe('Room input relay', () => {
  it('forwards frames to the other seat with the sender marked, and logs them', () => {
    const host = new FakeHost();
    const room = started(host);
    room.onInput(0, encodeInput(1, { turn: 1, boost: false, use: false }));
    room.onInput(0, encodeInput(2, { turn: -1, boost: true, use: true }));
    const got = host.frames(1).map((f) => decodeRelayed(f));
    expect(got).toEqual([
      { player: 0, tick: 1, input: { turn: 1, boost: false, use: false } },
      { player: 0, tick: 2, input: { turn: -1, boost: true, use: true } },
    ]);
    expect(room.log).toHaveLength(2);
  });

  it('drops frames before the start, out of order, malformed, or too far ahead', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    room.onInput(0, encodeInput(1, NO_INPUT));
    expect(host.frames(1)).toHaveLength(0);
    room.onMessage(0, { type: 'ready', ready: true });
    room.onMessage(1, { type: 'ready', ready: true });
    room.onInput(0, encodeInput(5, NO_INPUT));
    room.onInput(0, encodeInput(5, NO_INPUT));
    room.onInput(0, encodeInput(4, NO_INPUT));
    room.onInput(0, new Uint8Array([9, 9]));
    room.onInput(0, encodeInput(601, NO_INPUT));
    expect(host.frames(1)).toHaveLength(1);
    room.onInput(1, encodeInput(10, NO_INPUT));
    room.onInput(0, encodeInput(610, NO_INPUT));
    room.onInput(0, encodeInput(611, NO_INPUT));
    expect(host.frames(1)).toHaveLength(2);
  });
});

describe('Room refereeing', () => {
  it('clears matching hashes and voids the match on a mismatch', () => {
    const host = new FakeHost();
    const room = started(host);
    room.onMessage(0, { type: 'hash', tick: 60, hash: 111 });
    room.onMessage(1, { type: 'hash', tick: 60, hash: 111 });
    expect(host.messages(0, 'desync')).toHaveLength(0);
    room.onMessage(1, { type: 'hash', tick: 120, hash: 222 });
    room.onMessage(0, { type: 'hash', tick: 120, hash: 333 });
    expect(host.last(0, 'desync')).toEqual({ type: 'desync', tick: 120 });
    expect(host.last(1, 'desync')).toEqual({ type: 'desync', tick: 120 });
    expect(room.status).toBe('lobby');
    expect(host.logs.find((l) => l.event === 'desync')).toMatchObject({ tick: 120, hashes: [333, 222] });
  });

  it('records the match result when both clients agree on a match winner, and keeps relaying inputs', () => {
    const host = new FakeHost();
    const room = started(host);
    const result = { round: 7, winner: 1, scores: [3, 5], matchWinner: 1 };
    room.onMessage(0, { type: 'hash', tick: 900, hash: 5, result });
    expect(room.status).toBe('playing');
    room.onMessage(1, { type: 'hash', tick: 900, hash: 5, result });
    expect(room.status).toBe('lobby');
    expect(host.logs.find((l) => l.event === 'match')).toMatchObject({ winner: 1, scores: [3, 5] });
    room.onInput(0, encodeInput(1, NO_INPUT));
    expect(host.frames(1)).toHaveLength(1);
  });

  // Review Focus 3: rematches.
  it('returns to the lobby after a match and starts a rematch with a fresh seed and log', () => {
    const host = new FakeHost();
    const room = started(host);
    const firstStart = host.last(0, 'start') as Extract<ServerMessage, { type: 'start' }>;
    room.onInput(0, encodeInput(1, NO_INPUT));
    const result = { round: 3, winner: 0, scores: [2, 1], matchWinner: 0 };
    room.onMessage(0, { type: 'hash', tick: 500, hash: 9, result });
    room.onMessage(1, { type: 'hash', tick: 500, hash: 9, result });
    expect(room.status).toBe('lobby');
    expect(host.last(0, 'lobby')).toMatchObject({ players: [{ ready: false }, { ready: false }] });
    room.onMessage(1, { type: 'ready', ready: true });
    expect(room.status).toBe('lobby');
    expect(host.messages(0, 'start')).toHaveLength(1);
    room.onMessage(0, { type: 'ready', ready: true });
    expect(room.status).toBe('playing');
    const second = host.last(0, 'start') as Extract<ServerMessage, { type: 'start' }>;
    expect(host.messages(0, 'start')).toHaveLength(2);
    expect(second.seed).not.toBe(firstStart.seed);
    expect(room.log).toHaveLength(0);
    const session = (host.last(1, 'welcome') as { session: string }).session;
    room.onDisconnect(1);
    expect(room.rejoin(session)).toBe(1);
  });

  it('after a forfeit the winner waits alone and the loser’s token is gone', () => {
    const host = new FakeHost();
    const room = started(host);
    const session = (host.last(1, 'welcome') as { session: string }).session;
    room.onMessage(1, { type: 'leave' });
    expect(room.status).toBe('waiting');
    room.onMessage(0, { type: 'ready', ready: true });
    expect(room.status).toBe('waiting');
    expect(room.rejoin(session)).toBeNull();
    expect(room.join('Cy')).toEqual({ player: 1, session: expect.any(String) });
    expect(room.status).toBe('lobby');
  });
});

describe('Room disconnects', () => {
  // Review Focus 4: the disconnect countdown.
  it('gives a player 15 s to come back mid-match, then forfeits', () => {
    const host = new FakeHost();
    const room = started(host);
    host.t = 10_000;
    room.onDisconnect(1);
    expect(host.last(0, 'peerAway')).toEqual({ type: 'peerAway', deadline: 10_000 + DEFAULT_GRACE_MS });
    expect(room.playerCount).toBe(1);
    host.tick(14_000);
    expect(room.status).toBe('playing');
    host.tick(1_000);
    expect(room.status).toBe('waiting');
    expect(host.last(0, 'forfeit')).toEqual({ type: 'forfeit', winner: 0, reason: 'timeout' });
  });

  it('cancels the countdown when the player rejoins in time', () => {
    const host = new FakeHost();
    const room = started(host);
    const session = (host.last(1, 'welcome') as { session: string }).session;
    room.onDisconnect(1);
    host.tick(14_000);
    expect(room.rejoin(session)).toBe(1);
    expect(host.last(0, 'peerBack')).toEqual({ type: 'peerBack' });
    host.tick(20_000);
    expect(room.status).toBe('playing');
    expect(host.messages(0, 'forfeit')).toHaveLength(0);
    expect(room.rejoin('nope')).toBeNull();
  });

  // Review Focus 1: the rejoin hands over everything needed to rebuild the match.
  it('replays the match parameters and the input log to a rejoining player', () => {
    const host = new FakeHost();
    const room = started(host, [60, 80]);
    const session = (host.last(1, 'welcome') as { session: string }).session;
    room.onInput(0, encodeInput(1, NO_INPUT));
    room.onInput(1, encodeInput(1, { turn: 1, boost: false, use: false }));
    room.onInput(0, encodeInput(2, NO_INPUT));
    room.onInput(1, encodeInput(2, NO_INPUT));
    room.onInput(0, encodeInput(3, { turn: -1, boost: true, use: true }));
    room.onDisconnect(1);
    host.sent[1].length = 0;
    expect(room.rejoin(session, 0)).toBe(1);
    const types = host.sent[1].map((m) => (m instanceof Uint8Array ? 'binary' : m.type));
    expect(types.slice(0, 4)).toEqual(['welcome', 'resume', 'binary', 'lobby']);
    const start = host.last(0, 'start') as Extract<ServerMessage, { type: 'start' }>;
    expect(host.last(1, 'resume')).toEqual({
      type: 'resume',
      seed: start.seed,
      winsToWin: 5,
      inputDelay: start.inputDelay,
      rttMs: [60, 80],
      frames: 5,
    });
    const replay = decodeReplay(host.frames(1)[0]);
    expect(replay?.map((f) => [f.player, f.tick])).toEqual([
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [0, 3],
    ]);
    expect(replay?.[4].input).toEqual({ turn: -1, boost: true, use: true });
    expect(host.last(0, 'peerBack')).toEqual({ type: 'peerBack' });

    room.onDisconnect(1);
    host.sent[1].length = 0;
    room.rejoin(session, 3);
    expect(host.last(1, 'resume')).toMatchObject({ frames: 1 });
    expect(decodeReplay(host.frames(1)[0])?.map((f) => f.tick)).toEqual([3]);
  });

  it('sends no replay to a player who rejoins the lobby', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    const session = (host.last(1, 'welcome') as { session: string }).session;
    room.onDisconnect(1);
    expect(room.status).toBe('waiting');
    expect(room.rejoin(session)).toBeNull();
  });

  it('treats a hidden tab like a disconnect and a shown tab like a rejoin', () => {
    const host = new FakeHost();
    const room = started(host);
    room.onMessage(0, { type: 'away' });
    expect(host.last(1, 'peerAway')).toMatchObject({ type: 'peerAway' });
    expect(host.last(1, 'lobby')).toMatchObject({ players: [{ connected: true }, { connected: true }] });
    host.tick(5_000);
    room.onMessage(0, { type: 'back' });
    expect(host.last(1, 'peerBack')).toEqual({ type: 'peerBack' });
    host.tick(20_000);
    expect(room.status).toBe('playing');
  });

  it('frees a seat that leaves the lobby and clears the other ready flag', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    room.onMessage(0, { type: 'ready', ready: true });
    room.onDisconnect(1);
    expect(room.status).toBe('waiting');
    expect(host.last(0, 'peerLeft')).toEqual({ type: 'peerLeft' });
    expect(host.last(0, 'lobby')).toMatchObject({ players: [{ name: 'Ada', ready: false }, null] });
    expect(room.join('Cy')).toEqual({ player: 1, session: expect.any(String) });
    expect(room.status).toBe('lobby');
  });

  it('forfeits at once when a player leaves on purpose mid-match', () => {
    const host = new FakeHost();
    const room = started(host);
    room.onMessage(1, { type: 'leave' });
    expect(room.status).toBe('waiting');
    expect(host.last(0, 'forfeit')).toEqual({ type: 'forfeit', winner: 0, reason: 'left' });
    expect(host.closed[1]).toBe(true);
  });
});

describe('Room cleanup', () => {
  it('closes an empty room after two minutes', () => {
    const host = new FakeHost();
    const room = new Room(host, { code: 'ABCDEF', winsToWin: 5 });
    let closed = 0;
    room.onClosed = () => closed++;
    room.join('Ada');
    room.onDisconnect(0);
    host.tick(DEFAULT_EMPTY_MS - 1);
    expect(room.status).toBe('waiting');
    host.tick(1);
    expect(room.status).toBe('closed');
    expect(closed).toBe(1);
    expect(host.pendingTimers).toBe(0);
  });

  it('closes an idle room after ten minutes and tells the players', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    host.tick(DEFAULT_IDLE_MS / 2);
    room.onMessage(0, { type: 'ready', ready: true });
    host.tick(DEFAULT_IDLE_MS - 1000);
    expect(room.status).toBe('lobby');
    host.tick(DEFAULT_IDLE_MS);
    expect(room.status).toBe('closed');
    expect(host.last(0, 'closed')).toEqual({ type: 'closed', reason: 'idle' });
    expect(host.last(1, 'closed')).toEqual({ type: 'closed', reason: 'idle' });
    expect(host.closed).toEqual([true, true]);
    expect(host.pendingTimers).toBe(0);
    host.tick(DEFAULT_IDLE_MS * 3);
    expect(host.messages(0, 'closed')).toHaveLength(1);
  });

  it('keeps pinging connected players every second and refreshes the lobby ping', () => {
    const host = new FakeHost();
    const room = lobbyWith(host);
    host.tick(3_500);
    expect(host.messages(0, 'ping')).toHaveLength(3);
    expect(host.messages(1, 'ping')).toHaveLength(3);
    const lobbiesBefore = host.messages(0, 'lobby').length;
    const t = (host.last(0, 'ping') as { t: number }).t;
    host.t = t + 30;
    room.onMessage(0, { type: 'pong', t });
    room.onMessage(1, { type: 'pong', t });
    expect(host.messages(0, 'lobby')).toHaveLength(lobbiesBefore + 1);
    expect(host.last(0, 'lobby')).toMatchObject({ pingMs: 30 });
    room.onMessage(0, { type: 'pong', t });
    expect(host.messages(0, 'lobby')).toHaveLength(lobbiesBefore + 1);
  });

  it('close() cancels every timer and fires nothing afterward', () => {
    const host = new FakeHost();
    const room = started(host);
    room.onDisconnect(0);
    room.close('restart');
    expect(host.pendingTimers).toBe(0);
    expect(host.last(1, 'closed')).toEqual({ type: 'closed', reason: 'restart' });
    host.tick(60_000);
    expect(host.messages(1, 'forfeit')).toHaveLength(0);
  });
});
