import { roomCode } from '../net/names';
import { Room } from '../net/room';
import type { Overrides } from '../sim/configSchema';
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
    private readonly houseRules: () => Overrides = () => ({}),
  ) {}

  get count(): number {
    return this.rooms.size;
  }

  get players(): number {
    let n = 0;
    for (const { room } of this.rooms.values()) n += room.playerCount;
    return n;
  }

  /**
   * A new room, or null when the server is full. With `name` the room is filed under that name
   * instead of a random code; the caller checks first that the name is valid and free.
   */
  create(winsToWin: number, size = 2, name?: string): RoomEntry | null {
    if (this.rooms.size >= this.maxRooms) return null;
    if (name !== undefined && this.rooms.has(name)) throw new Error(`room ${name} already exists`);
    let code = name ?? roomCode(Math.random);
    while (this.rooms.has(code)) code = roomCode(Math.random);
    const host = new WsHost(code, this.log, this.lagMs, size);
    const room = new Room(host, { code, winsToWin, size, houseRules: this.houseRules });
    const entry = { room, host };
    this.rooms.set(code, entry);
    room.onClosed = () => {
      this.rooms.delete(code);
      for (const [token, c] of this.sessions) if (c === code) this.sessions.delete(token);
      this.onRoomStatus?.(code, 'closed');
    };
    room.onStatus = (status) => this.onRoomStatus?.(code, status);
    this.log({ room: code, event: 'created', winsToWin, size });
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
