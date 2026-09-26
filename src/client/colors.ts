import type { PickupKind } from '../sim';

/** Eight seat colours that read on the dark arena, in seat order: CYAN, PINK, LIME, AMBER, VIOLET, ORANGE, ICE, CORAL. */
export const PLAYER_COLORS: number[] = [0x22f3ff, 0xff2e97, 0x7cff4d, 0xffb020, 0xb388ff, 0xff7a1a, 0xdff6ff, 0xff3b5c];

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
  flame: 0xff7a1a,
  ghost: 0xe8f4ff,
  shield: 0x3dff7a,
  dozer: 0xff9f1c,
};

export const PLAYER_CSS = ['var(--cyan)', 'var(--pink)', 'var(--lime)', 'var(--amber)', 'var(--violet)', 'var(--orange)', 'var(--ice)', 'var(--coral)'];
