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

const GLYPHS: Record<PickupKind, string> = {
  missile:
    `<polygon points="0.95,0 -0.35,-0.5 -0.1,0 -0.35,0.5" fill="currentColor"/>` +
    `<circle cx="-0.7" cy="0" r="0.18" fill="currentColor" opacity="0.6"/>`,
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
