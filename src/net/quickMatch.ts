/**
 * The quick-match queue: a FIFO of open rooms per room size. A queued player owns a room flagged
 * open, so they also have an invite link, and the next player to queue for that size joins the
 * oldest open room instead of making one. Policy (when to offer, take and withdraw) lives in the server.
 */
export class QuickMatch {
  private readonly entries: { code: string; size: number }[] = [];

  /** Oldest open room first, every size. */
  get open(): readonly string[] {
    return this.entries.map((e) => e.code);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Adds an open room; false if it is already listed. */
  offer(code: string, size = 2): boolean {
    if (this.has(code)) return false;
    this.entries.push({ code, size });
    return true;
  }

  /** The oldest open room of `size` other than `except`, removed from the list, or null. */
  take(size = 2, except?: string): string | null {
    const i = this.entries.findIndex((e) => e.size === size && e.code !== except);
    if (i < 0) return null;
    return this.entries.splice(i, 1)[0].code;
  }

  /** Removes a room (filled, closed or cancelled). Unknown codes are ignored. */
  withdraw(code: string): void {
    const i = this.entries.findIndex((e) => e.code === code);
    if (i >= 0) this.entries.splice(i, 1);
  }

  has(code: string): boolean {
    return this.entries.some((e) => e.code === code);
  }
}
