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
