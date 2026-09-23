import GUI from 'lil-gui';
import { DEFAULT_CONFIG, type Config, type PickupKind } from '../sim';
import { DEFAULT_SETTINGS, resetInPlace, type ClientSettings } from './settings';

export interface TuningPanel {
  show(): void;
  hide(): void;
  /** Re-reads values changed outside the panel (e.g. the M mute key). */
  refresh(): void;
}

/** Live sliders for every M1 tunable. The sim reads `cfg` each tick, so changes apply at once. */
export function createTuningPanel(cfg: Config, settings: ClientSettings, hooks: { onChange(): void }): TuningPanel {
  const gui = new GUI({ title: 'SnakeBoom tuning  ( ` to hide )' });

  const move = gui.addFolder('Movement');
  move.add(cfg, 'baseSpeed', 60, 400, 5).name('speed');
  move.add(cfg, 'turnRate', 1, 8, 0.1).name('turn rate (rad/s)');
  move.add(cfg, 'snakeRadius', 3, 14, 0.5).name('thickness (radius)');
  move.add(cfg, 'neckLength', 10, 60, 1).name('neck length');

  const growth = gui.addFolder('Growth');
  growth.add(cfg, 'startLength', 20, 600, 10).name('start length');
  growth.add(cfg, 'growthPerSecond', 0, 200, 5).name('growth per second');
  growth.add(cfg, 'overtimeAt', 10, 300, 5).name('overtime at (s)');
  growth.add(cfg, 'overtimeGrowthMultiplier', 1, 10, 0.5).name('overtime growth ×');
  growth.add(cfg, 'roundMaxSeconds', 30, 600, 10).name('round cap (s)');

  const boost = gui.addFolder('Boost');
  boost.add(cfg, 'boostMultiplier', 1, 3, 0.1).name('speed ×');
  boost.add(cfg, 'boostMeterSeconds', 0.5, 6, 0.1).name('meter (s)');
  boost.add(cfg, 'boostRefillSeconds', 1, 20, 0.5).name('refill (s)');

  const match = gui.addFolder('Match');
  match.add(cfg, 'winsToWin', 1, 10, 1).name('first to');
  match.add(cfg, 'countdownSeconds', 1, 5, 1).name('countdown (s)');
  match.add(cfg, 'roundOverSeconds', 1, 6, 0.5).name('round banner (s)');

  const pickups = gui.addFolder('Pickups');
  pickups.add(cfg, 'maxPickups', 0, 10, 1).name('max on field');
  pickups.add(cfg, 'itemSlots', 1, 5, 1).name('item slots');
  pickups.add(cfg, 'firstPickupDelay', 0, 20, 0.5).name('first spawn (s)');
  pickups.add(cfg, 'pickupInterval', 1, 30, 0.5).name('spawn every (s)');
  pickups.add(cfg, 'pickupLifetime', 3, 60, 1).name('lifetime (s)');
  pickups.add(cfg, 'pickupRadius', 6, 30, 1).name('size');
  pickups.add(cfg, 'pickupMinHeadDistance', 0, 400, 10).name('min distance from heads');
  pickups.add(cfg, 'pickupClearance', 10, 120, 5).name('clearance');

  const bombs = gui.addFolder('Bombs');
  bombs.add(cfg, 'bombCharges', 1, 10, 1).name('bombs per pickup');
  bombs.add(cfg, 'bombThrowCooldown', 0, 2, 0.05).name('throw cooldown (s)');
  bombs.add(cfg, 'bombFlightTime', 0.1, 2, 0.05).name('flight time (s)');
  bombs.add(cfg, 'bombFuse', 0.2, 5, 0.1).name('fuse after landing (s)');
  bombs.add(cfg, 'bombLeadFactor', 0, 2, 0.05).name('aim ahead ×');
  bombs.add(cfg, 'blastRadius', 20, 200, 5).name('blast radius');
  bombs.add(cfg, 'chainDelay', 0.02, 1, 0.02).name('chain delay (s)');

  const power = gui.addFolder('Power-ups');
  power.add(cfg, 'ghostDuration', 0.5, 10, 0.25).name('ghost (s)');
  power.add(cfg, 'ghostWarning', 0, 3, 0.25).name('ghost warning (s)');
  power.add(cfg, 'shieldGrace', 0, 3, 0.1).name('shield grace (s)');
  power.add(cfg, 'turboDuration', 0.5, 15, 0.5).name('turbo (s)');
  power.add(cfg, 'slowDuration', 0.5, 15, 0.5).name('slow (s)');
  power.add(cfg, 'slowFactor', 0.1, 1, 0.05).name('slow speed ×');
  power.add(cfg, 'reverseDuration', 0.5, 15, 0.5).name('reverse (s)');
  power.add(cfg, 'dozerDuration', 0.5, 15, 0.5).name('bulldozer (s)');

  const mix = gui.addFolder('Pickup mix');
  for (const kind of Object.keys(cfg.pickupWeights) as PickupKind[]) mix.add(cfg.pickupWeights, kind, 0, 100, 1);

  const fx = gui.addFolder('Effects');
  fx.add(settings, 'bloom');
  fx.add(settings, 'bloomStrength', 0, 4, 0.1).name('bloom strength');
  fx.add(settings, 'bloomThreshold', 0, 1, 0.05).name('bloom threshold');
  fx.add(settings, 'shakeScale', 0, 3, 0.1).name('screen shake');

  const audio = gui.addFolder('Audio');
  audio.add(settings, 'masterVolume', 0, 1, 0.05).name('volume');
  audio.add(settings, 'muted');

  for (const folder of gui.folders.slice(1)) folder.close();
  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());
  const actions = {
    reset: () => {
      resetInPlace(cfg, DEFAULT_CONFIG);
      resetInPlace(settings, DEFAULT_SETTINGS);
      refresh();
      hooks.onChange();
    },
    copy: () => {
      void navigator.clipboard?.writeText(JSON.stringify({ config: cfg, settings }, null, 2)).catch(() => {});
    },
  };
  gui.add(actions, 'reset').name('Reset to defaults');
  gui.add(actions, 'copy').name('Copy config JSON');
  gui.onChange(() => hooks.onChange());
  gui.hide();

  return { show: () => gui.show(), hide: () => gui.hide(), refresh };
}
