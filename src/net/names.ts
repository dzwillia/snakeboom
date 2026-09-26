export const NAME_MAX = 12;
export const DEFAULT_NAMES: readonly string[] = ['CYAN', 'PINK'];

/** Trimmed, letters/digits/spaces only, single spaces, at most NAME_MAX chars; '' when nothing is left. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** The seat's default name when the player didn't give one. */
export function displayName(name: string, player: number): string {
  return name || DEFAULT_NAMES[player] || `P${player + 1}`;
}

/** No 0/O or 1/I, so codes read aloud unambiguously. */
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function isRoomCode(s: unknown): s is string {
  if (typeof s !== 'string' || s.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of s) if (!ROOM_ALPHABET.includes(ch)) return false;
  return true;
}

/** A fresh code from `rng()` in [0, 1). */
export function roomCode(rng: () => number): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const k = Math.min(ROOM_ALPHABET.length - 1, Math.max(0, Math.floor(rng() * ROOM_ALPHABET.length)));
    out += ROOM_ALPHABET[k];
  }
  return out;
}

/*
 * Room names: a host may pick one instead of a random code. Names are lowercase and codes are
 * uppercase, so the two never collide in the relay's one namespace of live rooms.
 */
export const ROOM_NAME_MIN = 3;
export const ROOM_NAME_MAX = 24;
/** Words kept free for routes and for the game's own vocabulary. */
export const RESERVED_ROOM_NAMES: ReadonlySet<string> = new Set([
  'new',
  'quick',
  'admin',
  'api',
  'health',
  'ws',
  'join',
  'create',
  'room',
  'snakeboom',
]);

/** Lowercased and trimmed; the form a name is stored and looked up in. */
export function normalizeRoomName(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/** Why a (normalised) name can't be used, or null when it can. The same words the relay sends back. */
export function roomNameProblem(name: string): string | null {
  if (name.length < ROOM_NAME_MIN || name.length > ROOM_NAME_MAX) return `A room name is ${ROOM_NAME_MIN} to ${ROOM_NAME_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(name)) return 'Letters, digits and dashes only.';
  if (RESERVED_ROOM_NAMES.has(name)) return `"${name}" is reserved.`;
  return null;
}

export function isRoomName(s: unknown): s is string {
  return typeof s === 'string' && roomNameProblem(s) === null;
}

/** Anything a live room can be filed under: a random code or a chosen name. */
export function isRoomKey(s: unknown): s is string {
  return isRoomCode(s) || isRoomName(s);
}
