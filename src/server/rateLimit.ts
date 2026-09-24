/** A sliding-window counter per key: at most `limit` events in any `windowMs`. */
export class RateLimit {
  private readonly events = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an event for `key` if it is within the limit, and says whether it was. */
  allow(key: string, now: number): boolean {
    const cutoff = now - this.windowMs;
    const list = (this.events.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.limit) {
      this.events.set(key, list);
      return false;
    }
    list.push(now);
    this.events.set(key, list);
    return true;
  }

  /** Drops keys with nothing in the window; call now and then. */
  prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, list] of this.events) {
      if (!list.some((t) => t > cutoff)) this.events.delete(key);
    }
  }
}
