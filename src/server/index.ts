import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { isRoomCode, isRoomKey, normalizeRoomName, roomNameProblem, sanitizeName } from '../net/names';
import { isClientMessage, PROTOCOL, type ClientMessage, type ServerMessage } from '../net/protocol';
import { logLine } from './log';
import { QuickMatch } from '../net/quickMatch';
import { clampSize } from '../net/room';
import { RateLimit } from './rateLimit';
import { Registry, type RoomEntry } from './registry';

export interface ServerOptions {
  port: number;
  hostname?: string;
  /** Exact origin to accept; unset accepts localhost origins only. */
  allowedOrigin?: string;
  version?: string;
  maxRooms?: number;
  /** Room creations (create or queue) allowed per address per minute. */
  roomsPerMinute?: number;
  /** Open quick-match rooms allowed at once. */
  maxQueued?: number;
  /** Delay every message the relay sends, to test rollback without a real network. */
  lagMs?: number;
  log?: (entry: Record<string, unknown>) => void;
}

export interface RunningServer {
  port: number;
  registry: Registry;
  close(): Promise<void>;
}

export const MAX_MESSAGE_BYTES = 1024;
const DEFAULT_MAX_ROOMS = 200;
const DEFAULT_ROOMS_PER_MINUTE = 5;
const DEFAULT_MAX_QUEUED = 50;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

interface Connection {
  socket: WebSocket;
  /** The client's address (the first X-Forwarded-For entry behind Caddy), for rate limits. */
  ip: string;
  name: string;
  entry: RoomEntry | null;
  player: number;
  helloed: boolean;
}

function originAllowed(origin: string | undefined, allowed: string | undefined): boolean {
  if (allowed) return origin === allowed;
  return origin === undefined || LOCAL_ORIGIN.test(origin);
}

function clientAddress(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || req.socket.remoteAddress || 'unknown';
}

function clampWins(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 5;
  return Math.min(10, Math.max(1, n));
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? logLine;
  const version = opts.version ?? 'dev';
  const registry = new Registry(opts.maxRooms ?? DEFAULT_MAX_ROOMS, log, opts.lagMs ?? 0);
  const quick = new QuickMatch();
  const creations = new RateLimit(opts.roomsPerMinute ?? DEFAULT_ROOMS_PER_MINUTE, 60_000);
  const maxQueued = opts.maxQueued ?? DEFAULT_MAX_QUEUED;
  const pruneTimer = setInterval(() => creations.prune(Date.now()), 60_000);
  pruneTimer.unref();
  const app = new Hono();
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      version,
      timestamp: new Date().toISOString(),
      rooms: registry.count,
      players: registry.players,
      queued: quick.size,
    }),
  );

  const wss = new WebSocketServer({ noServer: true });
  const connections = new Set<Connection>();

  /** Tells everyone still waiting in the queue how things look. */
  const broadcastQueued = () => {
    for (const conn of connections) {
      if (conn.entry && quick.has(conn.entry.room.code)) {
        send(conn.socket, { type: 'queued', waiting: quick.size, online: connections.size });
      }
    }
  };
  registry.onRoomStatus = (code, status) => {
    if (status !== 'waiting' && quick.has(code)) {
      quick.withdraw(code);
      broadcastQueued();
    }
  };

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };
  const refuse = (socket: WebSocket, code: 'version' | 'badMessage', message: string) => {
    send(socket, { type: 'error', code, message });
    socket.close(1002, code);
  };

  const seat = (conn: Connection, entry: RoomEntry, player: number, session: string) => {
    conn.entry = entry;
    conn.player = player;
    entry.host.attach(player, conn.socket);
    registry.remember(session, entry.room.code);
  };

  const slowDown = (conn: Connection) =>
    send(conn.socket, { type: 'error', code: 'busy', message: 'Slow down a little.' });

  /**
   * A live room by code or name. Names are lowercase and codes uppercase, so an exact match is
   * unambiguous; a lowercase code typed by hand (`abc234`) falls back to the code when no room
   * has that name.
   */
  const lookup = (room: unknown): RoomEntry | undefined => {
    if (!isRoomKey(room)) return undefined;
    const exact = registry.get(room);
    if (exact) return exact;
    const asCode = room.toUpperCase();
    return isRoomCode(asCode) ? registry.get(asCode) : undefined;
  };

  const onLobbyMessage = (conn: Connection, message: ClientMessage) => {
    switch (message.type) {
      case 'create': {
        // A chosen name: the client validates too, so a bad one here is a bug or a hand-made message.
        const name = message.name === undefined ? undefined : normalizeRoomName(message.name);
        const problem = name === undefined ? null : roomNameProblem(name);
        if (problem) return send(conn.socket, { type: 'error', code: 'roomName', message: problem });
        // Named rooms count against the same per-address limit, so nobody can squat a list of names.
        if (!creations.allow(conn.ip, Date.now())) return slowDown(conn);
        const holder = name === undefined ? undefined : registry.get(name);
        if (holder && !holder.room.abandoned) {
          log({ event: 'nameTaken', room: name });
          return send(conn.socket, { type: 'error', code: 'roomName', message: `"${name}" is taken right now. Try another name.` });
        }
        // A room everyone has left lingers so its link keeps working, but it doesn't keep the name.
        holder?.room.close('idle');
        const entry = registry.create(clampWins(message.winsToWin), clampSize(message.size), name);
        if (!entry) return send(conn.socket, { type: 'error', code: 'busy', message: 'The server is full right now.' });
        joinEntry(conn, entry);
        return;
      }
      case 'join': {
        const entry = lookup(message.room);
        if (!entry) {
          log({ event: 'joinFailed', room: message.room });
          return send(conn.socket, { type: 'closed', reason: 'unknownRoom' });
        }
        joinEntry(conn, entry);
        return;
      }
      case 'queue': {
        // Join the oldest open room of this size if one is really still waiting; otherwise open my own.
        if (!creations.allow(conn.ip, Date.now())) return slowDown(conn);
        const size = clampSize(message.size);
        for (;;) {
          const code = quick.take(size);
          if (code === null) break;
          const open = registry.get(code);
          // Only a room with someone actually waiting in it; stale ones just fall out of the queue.
          if (open && open.room.status === 'waiting' && open.room.playerCount >= 1) {
            joinEntry(conn, open);
            // A room with seats still free stays open for the next player of that size.
            if (open.room.status === 'waiting') quick.offer(code, size);
            broadcastQueued();
            return;
          }
        }
        if (quick.size >= maxQueued) return send(conn.socket, { type: 'error', code: 'busy', message: 'Too many players are waiting right now.' });
        const entry = registry.create(clampWins(message.winsToWin), size);
        if (!entry) return send(conn.socket, { type: 'error', code: 'busy', message: 'The server is full right now.' });
        joinEntry(conn, entry);
        if (conn.entry === entry) {
          quick.offer(entry.room.code, size);
          broadcastQueued();
        }
        return;
      }
      case 'leaveQueue':
        return;
      case 'hello':
        return refuse(conn.socket, 'badMessage', 'hello was already sent');
      default:
        return send(conn.socket, { type: 'error', code: 'notInRoom', message: 'Create or join a room first.' });
    }
  };

  const joinEntry = (conn: Connection, entry: RoomEntry) => {
    // Attach first so the room's welcome and lobby messages reach this socket.
    const player = entry.room.nextFreeSeat;
    if (player === null) return send(conn.socket, { type: 'closed', reason: 'full' });
    entry.host.attach(player, conn.socket);
    const result = entry.room.join(conn.name);
    if (result === 'full') {
      entry.host.detach(player, conn.socket);
      return send(conn.socket, { type: 'closed', reason: 'full' });
    }
    if (result.player !== player) {
      entry.host.detach(player, conn.socket);
      entry.host.attach(result.player, conn.socket);
    }
    seat(conn, entry, result.player, result.session);
  };

  const onRejoin = (conn: Connection, message: Extract<ClientMessage, { type: 'hello' }>) => {
    const session = message.session as string;
    const entry = registry.bySession(session);
    const player = entry?.room.seatForSession(session) ?? null;
    if (!entry || player === null) {
      log({ event: 'rejoinFailed', known: !!entry, room: entry?.room.code ?? null, status: entry?.room.status ?? null });
      return send(conn.socket, { type: 'closed', reason: 'unknownRoom' });
    }
    // Attach first so rejoin()'s welcome reaches this socket.
    entry.host.attach(player, conn.socket);
    const fromTick = typeof message.fromTick === 'number' && message.fromTick >= 0 ? Math.floor(message.fromTick) : 0;
    if (entry.room.rejoin(session, fromTick) === null) {
      entry.host.detach(player, conn.socket);
      return send(conn.socket, { type: 'closed', reason: 'unknownRoom' });
    }
    seat(conn, entry, player, session);
  };

  const onMessage = (conn: Connection, data: RawData, isBinary: boolean) => {
    const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data)) : data;
    if (bytes.byteLength > MAX_MESSAGE_BYTES) return conn.socket.close(1009, 'too big');
    if (!conn.helloed) {
      if (isBinary) return refuse(conn.socket, 'badMessage', 'Say hello first.');
      const parsed = parse(bytes);
      if (!parsed || parsed.type !== 'hello') return refuse(conn.socket, 'badMessage', 'Say hello first.');
      if (parsed.protocol !== PROTOCOL) return refuse(conn.socket, 'version', 'Please refresh the game.');
      conn.helloed = true;
      conn.name = sanitizeName(parsed.name);
      if (typeof parsed.session === 'string') onRejoin(conn, parsed);
      return;
    }
    if (isBinary) {
      if (conn.entry) conn.entry.room.onInput(conn.player, new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return;
    }
    const parsed = parse(bytes);
    if (!parsed) return refuse(conn.socket, 'badMessage', 'Unreadable message.');
    if (!conn.entry) return onLobbyMessage(conn, parsed);
    if (parsed.type === 'hello' || parsed.type === 'create' || parsed.type === 'join') return;
    if (parsed.type === 'queue') {
      // Already in a room (waiting in the queue): just refresh the readout.
      if (quick.has(conn.entry.room.code)) send(conn.socket, { type: 'queued', waiting: quick.size, online: connections.size });
      return;
    }
    if (parsed.type === 'leaveQueue') {
      quick.withdraw(conn.entry.room.code);
      conn.entry.room.onMessage(conn.player, { type: 'leave' });
      broadcastQueued();
      return;
    }
    conn.entry.room.onMessage(conn.player, parsed);
  };

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const conn: Connection = { socket, ip: clientAddress(req), name: '', entry: null, player: -1, helloed: false };
    connections.add(conn);
    socket.on('message', (data, isBinary) => {
      try {
        onMessage(conn, data, isBinary);
      } catch (err) {
        log({ event: 'error', message: err instanceof Error ? err.message : String(err) });
        socket.close(1011, 'error');
      }
    });
    socket.on('close', () => {
      connections.delete(conn);
      if (conn.entry) {
        conn.entry.host.detach(conn.player, socket);
        conn.entry.room.onDisconnect(conn.player);
        if (conn.entry.room.playerCount === 0) quick.withdraw(conn.entry.room.code);
      }
      broadcastQueued();
    });
    socket.on('error', () => socket.close());
  });

  let listening: ServerType;
  const server = await new Promise<ServerType>((resolve) => {
    listening = serve({ fetch: app.fetch, port: opts.port, hostname: opts.hostname ?? '0.0.0.0' }, () => resolve(listening));
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin, opts.allowedOrigin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log({ event: 'listening', port, version });

  return {
    port,
    registry,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pruneTimer);
        registry.closeAll();
        for (const conn of connections) conn.socket.close(1001, 'restart');
        wss.close();
        server.close(() => resolve());
        setTimeout(resolve, 500).unref();
      }),
  };
}

function parse(bytes: Buffer): ClientMessage | null {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isClientMessage(value) ? value : null;
  } catch {
    return null;
  }
}
