import type { PickupKind } from '../sim';

export const PLAYER_COLORS: number[] = [0x22f3ff, 0xff2e97];

export const PALETTE = {
  background: 0x05060d,
  gridLine: 0x0f1a2e,
  border: 0x9fd8ff,
  obstacle: 0xffb020,
  obstacleFill: 0x2a1a00,
  core: 0xffffff,
  bomb: 0xff3030,
  bombDim: 0x8a1010,
  fuse: 0xffb020,
};

export const PICKUP_COLORS: Record<PickupKind, number> = {
  bomb: 0xff4d2e,
  ghost: 0xe8f4ff,
  shield: 0x3dff7a,
  turbo: 0xffe14d,
  slow: 0x4d7cff,
  reverse: 0xb44dff,
  dozer: 0xff9f1c,
};

export const PLAYER_CSS = ['var(--cyan)', 'var(--pink)'];
