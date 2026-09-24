import type { WebSocket } from 'ws';
import type { RoomHost } from '../net/room';

/** RoomHost over `ws` sockets and Node timers. Sockets come and go (rejoins), so they are attached by seat. */
export class WsHost implements RoomHost {
  private readonly sockets: (WebSocket | null)[] = [null, null];

  constructor(
    private readonly code: string,
    private readonly logSink: (entry: Record<string, unknown>) => void,
  ) {}

  attach(player: number, socket: WebSocket): void {
    this.sockets[player] = socket;
  }

  /** Forgets a socket, but only if it is still the one attached (a rejoin may have replaced it). */
  detach(player: number, socket: WebSocket): void {
    if (this.sockets[player] === socket) this.sockets[player] = null;
  }

  now(): number {
    return Date.now();
  }

  send(player: number, message: Record<string, unknown> | Uint8Array): void {
    const socket = this.sockets[player];
    if (!socket || socket.readyState !== socket.OPEN) return;
    if (message instanceof Uint8Array) socket.send(message, { binary: true });
    else socket.send(JSON.stringify(message));
  }

  close(player: number): void {
    const socket = this.sockets[player];
    this.sockets[player] = null;
    socket?.close(1000, 'bye');
  }

  setTimer(ms: number, fn: () => void): () => void {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  }

  random(): number {
    return Math.random();
  }

  log(entry: Record<string, unknown>): void {
    this.logSink({ room: this.code, ...entry });
  }
}
