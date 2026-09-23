/**
 * Flashing for timed specials about to run out: steady until `warning` seconds remain, then on and
 * off, faster and faster (2 Hz rising to 10 Hz) as time runs out.
 */
export function blinkOn(left: number, warning: number, t: number): boolean {
  if (!(warning > 0) || left >= warning) return true;
  const hz = 2 + 8 * (1 - Math.max(0, left) / warning);
  return Math.floor(t * hz * 2) % 2 === 0;
}
