import type { PickupKind } from '../sim';

export const PLAYER_COLORS: number[] = [0x22f3ff, 0xff2e97];

export const PALETTE = {
  background: 0x05060d,
  gridLine: 0x0f1a2e,
  border: 0x9fd8ff,
  obstacle: 0xffb020,
  obstacleFill: 0x2a1a00,
  core: 0xffffff,
  missile: 0xff3030,
  fuse: 0xffb020,
  wormhole: 0xb388ff,
  saw: 0xffd23f,
};

export const PICKUP_COLORS: Record<PickupKind, number> = {
  missile: 0xff4d2e,
  scissors: 0xff7ad9,
  ghost: 0xe8f4ff,
  shield: 0x3dff7a,
  dozer: 0xff9f1c,
};

export const PLAYER_CSS = ['var(--cyan)', 'var(--pink)'];
