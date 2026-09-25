/**
 * The client's view of the arena: a centre and a zoom, where zoom 1 shows the whole arena and
 * zoom 2 shows the original 1600×1000 apparent size. Pure functions; the world applies them.
 */
export interface View {
  cx: number;
  cy: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2;
/** World units of breathing room around the heads in fit mode. */
export const FIT_MARGIN = 320;
/** Per-second easing rate toward the target view. */
export const EASE = 6;

/** Local play: every live head in view with a margin, as close as MAX_ZOOM allows. */
export function fitView(heads: readonly Point[], arenaW: number, arenaH: number): View {
  if (heads.length === 0) return { cx: arenaW / 2, cy: arenaH / 2, zoom: MIN_ZOOM };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const h of heads) {
    minX = Math.min(minX, h.x);
    maxX = Math.max(maxX, h.x);
    minY = Math.min(minY, h.y);
    maxY = Math.max(maxY, h.y);
  }
  const spanX = maxX - minX + 2 * FIT_MARGIN;
  const spanY = maxY - minY + 2 * FIT_MARGIN;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, arenaW / spanX, arenaH / spanY));
  return clampView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom }, arenaW, arenaH);
}

/** Online: follow one head at the close zoom. */
export function followView(head: Point, arenaW: number, arenaH: number, zoom = MAX_ZOOM): View {
  return clampView({ cx: head.x, cy: head.y, zoom }, arenaW, arenaH);
}

/** Keeps the visible rectangle inside the arena. */
export function clampView(view: View, arenaW: number, arenaH: number): View {
  const halfW = arenaW / view.zoom / 2;
  const halfH = arenaH / view.zoom / 2;
  return {
    cx: Math.min(Math.max(view.cx, halfW), arenaW - halfW),
    cy: Math.min(Math.max(view.cy, halfH), arenaH - halfH),
    zoom: view.zoom,
  };
}

/** Moves `current` toward `target` by an exponential ease; `snap` jumps at once (a warp). */
export function easeView(current: View, target: View, dt: number, snap = false): View {
  if (snap) return { ...target };
  const k = 1 - Math.exp(-EASE * dt);
  return {
    cx: current.cx + (target.cx - current.cx) * k,
    cy: current.cy + (target.cy - current.cy) * k,
    zoom: current.zoom + (target.zoom - current.zoom) * k,
  };
}
