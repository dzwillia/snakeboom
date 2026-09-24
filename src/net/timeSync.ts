/**
 * Keeping two rollback peers on the same tick. Each side estimates how far ahead of the other
 * it runs and nudges its own speed by at most 1%: gentle enough to be invisible, and both sides
 * share the work, so a 10-tick gap closes in about 8 seconds.
 */

/** Ticks of lead (or lag, negative) inside which no correction is made. */
export const DEADBAND_TICKS = 1;
/** Speed change per tick of lead beyond the deadband. */
export const SLOPE_PER_TICK = 0.005;
/** The most either side ever speeds up or slows down. */
export const MAX_ADJUST = 0.01;
/** Smoothing of the lead estimate per sample (an exponential moving average). */
export const LEAD_SMOOTHING = 0.1;

/** The loop's time scale for a smoothed lead: below 1 when ahead, above 1 when behind. */
export function timeScaleFor(smoothedLead: number): number {
  if (smoothedLead > DEADBAND_TICKS) return 1 - Math.min(MAX_ADJUST, (smoothedLead - DEADBAND_TICKS) * SLOPE_PER_TICK);
  if (smoothedLead < -DEADBAND_TICKS) return 1 + Math.min(MAX_ADJUST, (-smoothedLead - DEADBAND_TICKS) * SLOPE_PER_TICK);
  return 1;
}

/** One EMA step. */
export function smoothLead(previous: number | null, sample: number): number {
  return previous === null ? sample : previous + LEAD_SMOOTHING * (sample - previous);
}
