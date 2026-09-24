/**
 * A phone or tablet with no mouse and no keyboard: coarse pointer, no hover. Such a device gets
 * the "play on a computer" page instead of a game it can't steer.
 */
export function isTouchOnly(matches: (query: string) => boolean): boolean {
  return matches('(pointer: coarse)') && !matches('(hover: hover)');
}

export const DESKTOP_OVERRIDE_KEY = 'snakeboom.desktop';
