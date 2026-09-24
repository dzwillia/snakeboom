/**
 * The quick-match queue: a FIFO of open rooms. A queued player owns a room flagged open, so they
 * also have an invite link, and the next player to queue joins the oldest open room instead of
 * making one. Policy (when to offer, take and withdraw) lives in the server.
 */
export class QuickMatch {
  private readonly codes: string[] = [];

  /** Oldest open room first. */
  get open(): readonly string[] {
    return this.codes;
  }

  get size(): number {
    return this.codes.length;
  }

  /** Adds an open room; false if it is already listed. */
  offer(code: string): boolean {
    if (this.codes.includes(code)) return false;
    this.codes.push(code);
    return true;
  }

  /** The oldest open room other than `except`, removed from the list, or null. */
  take(except?: string): string | null {
    const i = this.codes.findIndex((c) => c !== except);
    if (i < 0) return null;
    return this.codes.splice(i, 1)[0];
  }

  /** Removes a room (filled, closed or cancelled). Unknown codes are ignored. */
  withdraw(code: string): void {
    const i = this.codes.indexOf(code);
    if (i >= 0) this.codes.splice(i, 1);
  }

  has(code: string): boolean {
    return this.codes.includes(code);
  }
}
