import { roomCode } from '../net/names';
import { Room } from '../net/room';
import { WsHost } from './wsHost';

export interface RoomEntry {
  room: Room;
  host: WsHost;
}

/** Every live room, by code, plus the session tokens that can rejoin them. */
export class Registry {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly sessions = new Map<string, string>();
  /** A room's status changed or it closed (status 'closed'). */
  onRoomStatus: ((code: string, status: Room['status']) => void) | null = null;

  constructor(
    private readonly maxRooms: number,
    private readonly log: (entry: Record<string, unknown>) => void,
    private readonly lagMs = 0,
  ) {}

  get count(): number {
    return this.rooms.size;
  }

  get players(): number {
    let n = 0;
    for (const { room } of this.rooms.values()) n += room.playerCount;
    return n;
  }

  /** A new room, or null when the server is full. */
  create(winsToWin: number): RoomEntry | null {
    if (this.rooms.size >= this.maxRooms) return null;
    let code = roomCode(Math.random);
    while (this.rooms.has(code)) code = roomCode(Math.random);
    const host = new WsHost(code, this.log, this.lagMs);
    const room = new Room(host, { code, winsToWin });
    const entry = { room, host };
    this.rooms.set(code, entry);
    room.onClosed = () => {
      this.rooms.delete(code);
      for (const [token, c] of this.sessions) if (c === code) this.sessions.delete(token);
      this.onRoomStatus?.(code, 'closed');
    };
    room.onStatus = (status) => this.onRoomStatus?.(code, status);
    this.log({ room: code, event: 'created', winsToWin });
    return entry;
  }

  get(code: string): RoomEntry | undefined {
    return this.rooms.get(code);
  }

  remember(session: string, code: string): void {
    this.sessions.set(session, code);
  }

  bySession(session: string): RoomEntry | undefined {
    const code = this.sessions.get(session);
    return code ? this.rooms.get(code) : undefined;
  }

  closeAll(): void {
    for (const { room } of [...this.rooms.values()]) room.close('restart');
  }
}
