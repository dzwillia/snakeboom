import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { NO_INPUT } from '../sim';
import { decodeRelayed, encodeInput } from '../net/codec';
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
    server = await startServer({ port: 0, version: '0.8.0-test', log: (e) => logs.push(e) });
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

    a.sendFrame(encodeInput(1, { turn: 1, boost: false, use: false }));
    a.sendFrame(encodeInput(2, NO_INPUT));
    a.sendFrame(encodeInput(3, { turn: -1, boost: true, use: true }));
    const frames = await b.waitFrames(3);
    expect(frames.map((f) => decodeRelayed(f)?.tick)).toEqual([1, 2, 3]);
    expect(frames.map((f) => decodeRelayed(f)?.player)).toEqual([0, 0, 0]);
    expect(decodeRelayed(frames[2])?.input).toEqual({ turn: -1, boost: true, use: true });

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
    const b2 = new TestClient(server.port);
    await b2.opened;
    b2.send({ ...hello('B'), session: wb.session });
    expect((await b2.expect('welcome')).player).toBe(1);
    await a.expect('peerBack');
    a.sendFrame(encodeInput(1, NO_INPUT));
    expect(await b2.waitFrames(1)).toHaveLength(1);
    a.close();
    b2.close();
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
