import { isRoomCode, isRoomName, normalizeRoomName } from '../../net/names';

/**
 * The room an invite link points at, from its path: `/r/ABC234` is a code, `/r/dave` a name.
 * A name is normalised the way the relay stores it (so `/r/Dave` works), and a code typed in
 * lowercase goes through as is: the relay tries it as a name first, then as the code.
 */
export function roomFromPath(pathname: string): string | null {
  const segment = pathname.match(/^\/r\/([^/]+)\/?$/)?.[1];
  if (!segment) return null;
  let room: string;
  try {
    room = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (isRoomCode(room)) return room;
  const name = normalizeRoomName(room);
  return isRoomName(name) ? name : null;
}

/** The link to send a friend. */
export function inviteLink(origin: string, room: string): string {
  return `${origin}/r/${room}`;
}
