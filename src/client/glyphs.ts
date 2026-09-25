import type { PickupKind } from '../sim';

/**
 * The pickup glyphs as inline SVG, matching the shapes the renderer draws on the arena
 * (see render/pickups.ts) so the Powers page shows what you'll actually see. Everything is
 * drawn in a -1..1 box with `currentColor`, so CSS sets the colour and size.
 */
export function glyphSvg(kind: PickupKind): string {
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true">${GLYPHS[kind]}</svg>`;
}

const BG = 'var(--bg)';
const FUSE = '#ffb020';

const GLYPHS: Record<PickupKind, string> = {
  bomb:
    `<circle cx="-0.1" cy="0.15" r="0.7" fill="currentColor"/>` +
    `<path d="M0.3 -0.4 L0.75 -0.9" stroke="${FUSE}" stroke-width="0.14" stroke-linecap="round" fill="none"/>`,
  ghost:
    `<circle cx="0" cy="-0.15" r="0.6" fill="currentColor"/>` +
    `<rect x="-0.6" y="-0.15" width="1.2" height="0.75" fill="currentColor"/>` +
    `<circle cx="-0.22" cy="-0.2" r="0.14" fill="${BG}"/><circle cx="0.22" cy="-0.2" r="0.14" fill="${BG}"/>`,
  shield:
    `<polygon points="0,-0.9 0.75,-0.55 0.6,0.35 0,0.9 -0.6,0.35 -0.75,-0.55" fill="none" ` +
    `stroke="currentColor" stroke-width="0.16" stroke-linejoin="round"/>`,
  dozer:
    `<rect x="-0.3" y="-0.75" width="0.65" height="0.55" fill="currentColor"/>` +
    `<polygon points="-0.85,-0.1 0.85,-0.1 0.65,0.55 -0.65,0.55" fill="currentColor"/>`,
};
