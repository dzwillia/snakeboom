const SMOOTHING = 0.2;

/** Estimates the relay's clock from its pings, so `startAt` and deadlines can be turned into local times. */
export class RelayClock {
  private offset: number | null = null;

  /** A ping carrying relay time `t` arrived at `localNow`; the relay last measured our round trip as `rttMs`. */
  onPing(t: number, localNow: number, rttMs: number | null): void {
    const sample = t + (rttMs ?? 0) / 2 - localNow;
    this.offset = this.offset === null ? sample : this.offset + SMOOTHING * (sample - this.offset);
  }

  /** Relay time now, or null before the first ping. */
  toRelay(localNow: number): number | null {
    return this.offset === null ? null : localNow + this.offset;
  }

  /** The local time at which relay time `t` happens (assumes no offset before the first ping). */
  toLocal(t: number): number {
    return t - (this.offset ?? 0);
  }

  get synced(): boolean {
    return this.offset !== null;
  }
}
