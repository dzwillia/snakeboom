/** Per-frame decay of the visual offset (about 0.083 of a correction is left after 6 frames). */
export const DECAY = 0.45;
/** The largest offset ever drawn; a bigger jump is shown as a jump. */
export const MAX_OFFSET = 40;
const SNAP_BELOW = 0.1;

export interface Offset {
  x: number;
  y: number;
}

/**
 * Hides rollback corrections: when the sim moves a head, the drawn head starts where it was and
 * slides to where it is over a few frames. Purely visual; the sim never sees these offsets.
 */
export class HeadSmoothing {
  readonly offsets: Offset[];

  constructor(players: number) {
    this.offsets = Array.from({ length: players }, () => ({ x: 0, y: 0 }));
  }

  /** A head moved by (dx, dy) = old − new; keep drawing it near the old spot for now. */
  correct(player: number, dx: number, dy: number): void {
    const o = this.offsets[player];
    if (!o) return;
    o.x += dx;
    o.y += dy;
    const len = Math.hypot(o.x, o.y);
    if (len > MAX_OFFSET) {
      o.x *= MAX_OFFSET / len;
      o.y *= MAX_OFFSET / len;
    }
  }

  /** Once per rendered frame. */
  frame(): void {
    for (const o of this.offsets) {
      o.x *= DECAY;
      o.y *= DECAY;
      if (Math.abs(o.x) < SNAP_BELOW && Math.abs(o.y) < SNAP_BELOW) {
        o.x = 0;
        o.y = 0;
      }
    }
  }

  /** A dead (or respawned) head draws exactly where the sim says. */
  reset(player?: number): void {
    for (const [i, o] of this.offsets.entries()) {
      if (player === undefined || player === i) {
        o.x = 0;
        o.y = 0;
      }
    }
  }
}
