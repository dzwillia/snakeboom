import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { NO_INPUT } from '../sim';
import { decodeRelayed, decodeReplay, encodeInput } from '../net/codec';
import { PROTOCOL, type ClientMessage, type ServerMessage } from '../net/protocol';
import { startServer, type RunningServer } from './index';

class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly frames: Uint8Array[] = [];
  readonly socket: WebSocket;
  closed = false;
  readonly opened: Promise<void>;

  constructor(port: number, origin?: string) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { headers: { origin } } : {});
    this.socket.binaryType = 'nodebuffer';
    this.opened = new Promise((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
      this.socket.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    this.socket.on('message', (data, isBinary) => {
      if (isBinary) this.frames.push(new Uint8Array(data as Buffer));
      else this.messages.push(JSON.parse((data as Buffer).toString()) as ServerMessage);
    });
    this.socket.on('close', () => (this.closed = true));
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  sendFrame(frame: Uint8Array): void {
    this.socket.send(frame, { binary: true });
  }

  /** The next unread message of a type (optionally matching a predicate), waiting up to 2 s for it. */
  async expect<T extends ServerMessage['type']>(
    type: T,
    where: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const deadline = Date.now() + 2000;
    for (;;) {
      const i = this.messages.findIndex((m) => m.type === type && where(m as Extract<ServerMessage, { type: T }>));
      if (i >= 0) return this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>;
      if (Date.now() > deadline) throw new Error(`no ${type} within 2 s; got ${this.messages.map((m) => m.type).join(',')}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async waitClosed(): Promise<void> {
    const deadline = Date.now() + 2000;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('socket did not close');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  async waitFrames(n: number): Promise<Uint8Array[]> {
    const deadline = Date.now() + 2000;
    while (this.frames.length < n) {
      if (Date.now() > deadline) throw new Error(`only ${this.frames.length} frames`);
      await new Promise((r) => setTimeout(r, 10));
    }
    return this.frames;
  }

  close(): void {
    this.socket.close();
  }
}

type Hello = Extract<ClientMessage, { type: 'hello' }>;
const hello = (name: string): Hello => ({ type: 'hello', protocol: PROTOCOL, version: 'test', name });

describe('relay server', () => {
  let server: RunningServer;
  const logs: Record<string, unknown>[] = [];

  beforeAll(async () => {
    server = await startServer({ port: 0, version: '0.8.0-test', roomsPerMinute: 1000, log: (e) => logs.push(e) });
  });
  afterAll(async () => {
    await server.close();
  });

  it('runs a room end to end: create, join, ready, start, relay inputs, hashes, disconnect, health', async () => {
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.opened, b.opened]);

    a.send(hello('Ada'));
    a.send({ type: 'create', winsToWin: 3 });
    const welcomeA = await a.expect('welcome');
    expect(welcomeA).toMatchObject({ player: 0, name: 'Ada' });
    expect(welcomeA.room).toMatch(/^[A-Z2-9]{6}$/);

    b.send(hello('Bob'));
    b.send({ type: 'join', room: welcomeA.room });
    const welcomeB = await b.expect('welcome');
    expect(welcomeB).toMatchObject({ player: 1, name: 'Bob', room: welcomeA.room });
    const lobby = await a.expect('lobby', (m) => m.players[1] !== null);
    expect(lobby.players.map((p) => p?.name)).toEqual(['Ada', 'Bob']);

    const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
    expect(health).toMatchObject({ status: 'ok', version: '0.8.0-test', rooms: 1, players: 2 });

    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    const startA = await a.expect('start');
    const startB = await b.expect('start');
    expect(startA).toEqual(startB);
    expect(startA.winsToWin).toBe(3);
    expect(startA.inputDelay).toBeGreaterThanOrEqual(1);

    a.sendFrame(encodeInput(1, { turn: 1, boost: false, use: false, select: false }));
    a.sendFrame(encodeInput(2, NO_INPUT));
    a.sendFrame(encodeInput(3, { turn: -1, boost: true, use: true, select: false }));
    const frames = await b.waitFrames(3);
    expect(frames.map((f) => decodeRelayed(f)?.tick)).toEqual([1, 2, 3]);
    expect(frames.map((f) => decodeRelayed(f)?.player)).toEqual([0, 0, 0]);
    expect(decodeRelayed(frames[2])?.input).toEqual({ turn: -1, boost: true, use: true, select: false });

    a.send({ type: 'hash', tick: 60, hash: 1 });
    b.send({ type: 'hash', tick: 60, hash: 1 });
    await new Promise((r) => setTimeout(r, 50));
    expect(a.messages.some((m) => m.type === 'desync')).toBe(false);

    b.close();
    const away = await a.expect('peerAway');
    expect(away.deadline).toBeGreaterThan(Date.now());
    a.close();
    await a.waitClosed();
  });

  // Review Focus 5: the first message.
  it('refuses a socket whose first message is not a hello', async () => {
    const c = new TestClient(server.port);
    await c.opened;
    c.send({ type: 'create', winsToWin: 5 });
    const err = await c.expect('error');
    expect(err.code).toBe('badMessage');
    await c.waitClosed();
  });

  it('refuses an unsupported protocol', async () => {
    const c = new TestClient(server.port);
    await c.opened;
    c.send({ ...hello('X'), protocol: 0 } as ClientMessage);
    const err = await c.expect('error');
    expect(err.code).toBe('version');
    await c.waitClosed();
  });

  it('refuses unreadable JSON after hello', async () => {
    const c = new TestClient(server.port);
    await c.opened;
    c.send(hello('X'));
    c.sendRaw('{not json');
    const err = await c.expect('error');
    expect(err.code).toBe('badMessage');
    await c.waitClosed();
  });

  it('reports an unknown room and a full room', async () => {
    const a = new TestClient(server.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'join', room: 'ZZZZZZ' });
    expect((await a.expect('closed')).reason).toBe('unknownRoom');
    a.send({ type: 'create', winsToWin: 5 });
    const room = (await a.expect('welcome')).room;
    const b = new TestClient(server.port);
    const c = new TestClient(server.port);
    await Promise.all([b.opened, c.opened]);
    b.send(hello('B'));
    b.send({ type: 'join', room });
    await b.expect('welcome');
    c.send(hello('C'));
    c.send({ type: 'join', room });
    expect((await c.expect('closed')).reason).toBe('full');
    for (const x of [a, b, c]) x.close();
  });

  it('creates a room under a chosen name, normalised, and lets a friend join by it', async () => {
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.opened, b.opened]);
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 3, name: '  Dave-Night ' });
    const wa = await a.expect('welcome');
    expect(wa).toMatchObject({ player: 0, room: 'dave-night' });
    expect(logs.some((e) => e.room === 'dave-night' && e.event === 'created')).toBe(true);
    b.send(hello('B'));
    b.send({ type: 'join', room: 'dave-night' });
    expect(await b.expect('welcome')).toMatchObject({ player: 1, room: 'dave-night' });
    const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
    expect(health.rooms).toBeGreaterThanOrEqual(1);
    a.close();
    b.close();
    await b.waitClosed();
  });

  it('refuses a room name that is taken, reserved or malformed, keeping the socket open', async () => {
    const a = new TestClient(server.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 5, name: 'friday' });
    await a.expect('welcome');

    const b = new TestClient(server.port);
    await b.opened;
    b.send(hello('B'));
    b.send({ type: 'create', winsToWin: 5, name: 'FRIDAY' });
    const taken = await b.expect('error');
    expect(taken).toMatchObject({ code: 'roomName' });
    expect(taken.message).toMatch(/"friday" is taken/);
    expect(b.closed).toBe(false);
    // Still not in a room: the next create works, and a random code is what it gets.
    b.send({ type: 'create', winsToWin: 5, name: 'admin' });
    expect((await b.expect('error')).message).toMatch(/reserved/);
    b.send({ type: 'create', winsToWin: 5, name: 'no spaces' });
    expect((await b.expect('error')).message).toMatch(/letters, digits and dashes/i);
    b.send({ type: 'create', winsToWin: 5, name: 'ab' });
    expect((await b.expect('error')).message).toMatch(/3 to 24/);
    b.send({ type: 'create', winsToWin: 5 });
    expect((await b.expect('welcome')).room).toMatch(/^[A-Z2-9]{6}$/);
    a.close();
    b.close();
    await b.waitClosed();
  });

  it('gives a name back as soon as everyone has left its room', async () => {
    const a = new TestClient(server.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 5, name: 'reuse-me' });
    await a.expect('welcome');
    a.send({ type: 'leave' });
    await a.waitClosed();
    // The empty room lingers (its link still works), but it no longer holds the name.
    expect(server.registry.get('reuse-me')?.room.abandoned).toBe(true);
    const b = new TestClient(server.port);
    await b.opened;
    b.send(hello('B'));
    b.send({ type: 'create', winsToWin: 5, name: 'reuse-me' });
    expect((await b.expect('welcome')).room).toBe('reuse-me');
    expect(server.registry.get('reuse-me')?.room.playerCount).toBe(1);
    b.close();
  });

  it('keeps a name while a match is waiting for its players to come back', async () => {
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.opened, b.opened]);
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 1, name: 'mid-match' });
    await a.expect('welcome');
    b.send(hello('B'));
    b.send({ type: 'join', room: 'mid-match' });
    await b.expect('welcome');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    await a.expect('start');
    // Both tabs drop: nobody is connected, but either can rejoin for 15 s, so the name is still in use.
    a.close();
    b.close();
    await Promise.all([a.waitClosed(), b.waitClosed()]);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.registry.get('mid-match')?.room.playerCount).toBe(0);
    expect(server.registry.get('mid-match')?.room.abandoned).toBe(false);
    const c = new TestClient(server.port);
    await c.opened;
    c.send(hello('C'));
    c.send({ type: 'create', winsToWin: 5, name: 'mid-match' });
    expect((await c.expect('error')).message).toMatch(/is taken/);
    c.close();
    server.registry.get('mid-match')?.room.close('idle');
  });

  it('keeps names and codes apart: "ABC234" as a name is the room abc234, not the code', async () => {
    const a = new TestClient(server.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 5, name: 'ABC234' });
    expect((await a.expect('welcome')).room).toBe('abc234');
    const b = new TestClient(server.port);
    await b.opened;
    b.send(hello('B'));
    b.send({ type: 'join', room: 'ABC234' });
    expect((await b.expect('closed')).reason).toBe('unknownRoom');
    const c = new TestClient(server.port);
    await c.opened;
    c.send(hello('C'));
    c.send({ type: 'join', room: 'abc234' });
    expect((await c.expect('welcome')).room).toBe('abc234');
    for (const x of [a, b, c]) x.close();
  });

  it('finds a random-code room by its lowercase code, but a name exactly', async () => {
    const a = new TestClient(server.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 5 });
    const code = (await a.expect('welcome')).room;
    const b = new TestClient(server.port);
    await b.opened;
    b.send(hello('B'));
    b.send({ type: 'join', room: code.toLowerCase() });
    expect((await b.expect('welcome')).room).toBe(code);
    const c = new TestClient(server.port);
    await c.opened;
    c.send(hello('C'));
    c.send({ type: 'join', room: 'DAVE' });
    expect((await c.expect('closed')).reason).toBe('unknownRoom');
    for (const x of [a, b, c]) x.close();
  });

  it('lets a hidden tab rejoin with its session token', async () => {
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.opened, b.opened]);
    a.send(hello('A'));
    a.send({ type: 'create', winsToWin: 1 });
    const wa = await a.expect('welcome');
    b.send(hello('B'));
    b.send({ type: 'join', room: wa.room });
    const wb = await b.expect('welcome');
    a.send({ type: 'ready', ready: true });
    b.send({ type: 'ready', ready: true });
    await a.expect('start');
    b.close();
    await a.expect('peerAway');
    a.sendFrame(encodeInput(1, NO_INPUT));
    a.sendFrame(encodeInput(2, NO_INPUT));
    await new Promise((r) => setTimeout(r, 50));
    const b2 = new TestClient(server.port);
    await b2.opened;
    b2.send({ ...hello('B'), session: wb.session, fromTick: 0 });
    expect((await b2.expect('welcome')).player).toBe(1);
    const resume = await b2.expect('resume');
    expect(resume).toMatchObject({ winsToWin: 1, frames: 2 });
    const replay = decodeReplay((await b2.waitFrames(1))[0]);
    expect(replay?.map((f) => f.tick)).toEqual([1, 2]);
    b2.frames.length = 0;
    await a.expect('peerBack');
    a.sendFrame(encodeInput(3, NO_INPUT));
    expect(await b2.waitFrames(1)).toHaveLength(1);
    a.close();
    b2.close();
  });
});

describe('relay quick-match', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, roomsPerMinute: 1000, log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  const queued = async (port: number, name: string, winsToWin = 3) => {
    const c = new TestClient(port);
    await c.opened;
    c.send(hello(name));
    c.send({ type: 'queue', winsToWin });
    return c;
  };

  it('pairs the second player into the first player’s open room, and a third waits alone', async () => {
    const a = await queued(server.port, 'A', 4);
    const wa = await a.expect('welcome');
    expect(wa.player).toBe(0);
    expect((await a.expect('queued')).waiting).toBe(1);
    const health = await fetch(`http://127.0.0.1:${server.port}/health`).then((r) => r.json());
    expect(health.queued).toBe(1);

    const b = await queued(server.port, 'B', 9);
    const wb = await b.expect('welcome');
    expect(wb).toMatchObject({ player: 1, room: wa.room });
    const lobby = await a.expect('lobby', (m) => m.players[1] !== null);
    expect(lobby.winsToWin).toBe(4);
    expect(lobby.players.map((p) => p?.name)).toEqual(['A', 'B']);
    expect(b.messages.some((m) => m.type === 'queued')).toBe(false);

    const c = await queued(server.port, 'C');
    const wc = await c.expect('welcome');
    expect(wc.room).not.toBe(wa.room);
    expect((await c.expect('queued')).waiting).toBe(1);
    for (const x of [a, b, c]) x.close();
    await c.waitClosed();
  });

  it('drops a cancelled queue entry and a room filled by link', async () => {
    const a = await queued(server.port, 'A');
    await a.expect('welcome');
    await a.expect('queued');
    a.send({ type: 'leaveQueue' });
    await a.waitClosed();

    const b = await queued(server.port, 'B');
    const wb = await b.expect('welcome');
    expect((await b.expect('queued')).waiting).toBe(1);
    const friend = new TestClient(server.port);
    await friend.opened;
    friend.send(hello('F'));
    friend.send({ type: 'join', room: wb.room });
    expect((await friend.expect('welcome')).room).toBe(wb.room);
    await b.expect('lobby', (m) => m.players[1] !== null);

    const c = await queued(server.port, 'C');
    const wc = await c.expect('welcome');
    expect(wc.room).not.toBe(wb.room);
    expect(wc.player).toBe(0);
    for (const x of [b, friend, c]) x.close();
    await c.waitClosed();
  });
});

describe('relay limits', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, roomsPerMinute: 5, maxQueued: 1, log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  // Review Focus 5: the limits sit above anything a real player does.
  it('refuses a sixth room from one address within a minute, named or not, keeping the socket open', async () => {
    const clients: TestClient[] = [];
    for (let i = 0; i < 6; i++) {
      const c = new TestClient(server.port);
      await c.opened;
      c.send(hello(`P${i}`));
      // Named rooms count too, so a list of names can't be squatted.
      c.send(i % 2 === 0 ? { type: 'create', winsToWin: 5 } : { type: 'create', winsToWin: 5, name: `squat-${i}` });
      clients.push(c);
    }
    for (let i = 0; i < 5; i++) await clients[i].expect('welcome');
    const err = await clients[5].expect('error');
    expect(err).toMatchObject({ code: 'busy', message: 'Slow down a little.' });
    expect(clients[5].closed).toBe(false);
    for (const c of clients) c.close();
  });

  it('caps the number of open quick-match rooms', async () => {
    // Fresh addresses aren't available in a test, so use a new server with a roomy per-address limit.
    const s2 = await startServer({ port: 0, roomsPerMinute: 1000, maxQueued: 1, log: () => {} });
    const a = new TestClient(s2.port);
    await a.opened;
    a.send(hello('A'));
    a.send({ type: 'queue', winsToWin: 5 });
    await a.expect('queued');
    a.send({ type: 'queue', winsToWin: 5 });
    expect((await a.expect('queued')).waiting).toBe(1);
    const health = await fetch(`http://127.0.0.1:${s2.port}/health`).then((r) => r.json());
    expect(health.queued).toBe(1);
    // A second queuer joins the open room rather than opening another, so fill it by link first.
    const f = new TestClient(s2.port);
    await f.opened;
    f.send(hello('F'));
    f.send({ type: 'join', room: (a.messages.find((m) => m.type === 'welcome') as { room: string }).room });
    await f.expect('welcome');
    const b = new TestClient(s2.port);
    await b.opened;
    b.send(hello('B'));
    b.send({ type: 'queue', winsToWin: 5 });
    await b.expect('queued');
    const c = new TestClient(s2.port);
    await c.opened;
    c.send(hello('C'));
    c.send({ type: 'queue', winsToWin: 5 });
    // c pairs with b's open room; d finds the queue empty again but the cap counts open rooms only.
    await c.expect('welcome');
    for (const x of [a, f, b, c]) x.close();
    await s2.close();
  });
});

describe('relay origin check', () => {
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer({ port: 0, allowedOrigin: 'https://snakeboom.com', log: () => {} });
  });
  afterAll(async () => {
    await server.close();
  });

  it('accepts the configured origin and refuses others', async () => {
    const ok = new TestClient(server.port, 'https://snakeboom.com');
    await expect(ok.opened).resolves.toBeUndefined();
    ok.close();
    const bad = new TestClient(server.port, 'https://evil.example');
    await expect(bad.opened).rejects.toThrow(/403/);
  });
});
