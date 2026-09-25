import { TICK_RATE, type Config, type EffectName, type MatchState, type SnakeState } from '../sim';
import { blinkOn } from './blink';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

const EFFECT_ORDER: EffectName[] = ['dozer', 'ghost', 'reverse'];
const EFFECT_LABELS: Record<EffectName, string> = {
  dozer: 'DOZER',
  ghost: 'GHOST',
  reverse: 'REVERSED',
};

/** Numbers for the net readout, computed by the online match from the session's stats. */
export interface NetReadout {
  inputDelay: number;
  rollbacksPerMin: number;
  maxRollbackDepth: number;
  stallsPerMin: number;
  lead: number;
  timeScale: number;
}

interface Side {
  hearts: HTMLElement;
  pips: HTMLElement;
  fill: HTMLElement;
  effects: HTMLElement;
  slots: HTMLElement;
  lastHearts: string;
  lastEffects: string;
  lastSlots: string;
}

/**
 * Top bar: names, hearts, score pips, boost meters, active effects (flashing as they run out),
 * item queues (plus the Shield bubble) and the round clock.
 */
export class Hud {
  private readonly sides: Side[];
  private readonly clock: HTMLElement;
  private readonly ping: HTMLElement;
  private readonly net: HTMLElement;
  private readonly names: string[] = [...PLAYER_NAMES];
  private readonly tags: string[] = ['', ''];
  private lastPips = '';
  private lastClock = '';
  private lastPing = '';
  private lastNet = '';

  constructor(private readonly root: HTMLElement) {
    const side = (i: number) =>
      `<div class="side p${i + 1}">` +
      `<div class="row"><span class="name">${PLAYER_NAMES[i]}</span><span class="hearts"></span><span class="pips"></span></div>` +
      `<div class="row"><span class="boost"><span class="fill" style="display:block"></span></span>` +
      `<span class="effects"></span><span class="slots"></span></div></div>`;
    root.innerHTML = `${side(0)}<div class="center"><div class="clock">0:00</div><div class="ping"></div><div class="net"></div></div>${side(1)}`;
    this.sides = [...root.querySelectorAll<HTMLElement>('.side')].map((el) => ({
      hearts: el.querySelector<HTMLElement>('.hearts')!,
      pips: el.querySelector<HTMLElement>('.pips')!,
      fill: el.querySelector<HTMLElement>('.fill')!,
      effects: el.querySelector<HTMLElement>('.effects')!,
      slots: el.querySelector<HTMLElement>('.slots')!,
      lastHearts: '-',
      lastEffects: '-',
      lastSlots: '-',
    }));
    this.clock = root.querySelector<HTMLElement>('.clock')!;
    this.ping = root.querySelector<HTMLElement>('.ping')!;
    this.net = root.querySelector<HTMLElement>('.net')!;
  }

  /** The netcode readout under the ping (the N key online); null hides it. */
  setNet(net: NetReadout | null): void {
    const text = net
      ? `delay ${net.inputDelay} · rb ${net.rollbacksPerMin.toFixed(1)}/min (max ${net.maxRollbackDepth}) · stall ${net.stallsPerMin.toFixed(1)}/min · lead ${net.lead >= 0 ? '+' : ''}${net.lead.toFixed(1)} · ×${net.timeScale.toFixed(3)}`
      : '';
    if (text === this.lastNet) return;
    this.lastNet = text;
    this.net.textContent = text;
  }

  /** Adds a tag after a player's name (like AI) or clears it with an empty string. */
  setTag(player: number, tag: string): void {
    this.tags[player] = tag;
    this.renderName(player);
  }

  /** Replaces CYAN and PINK with the players' chosen names (online). */
  setNames(names: readonly string[]): void {
    names.forEach((name, i) => {
      this.names[i] = name || PLAYER_NAMES[i];
      this.renderName(i);
    });
  }

  /** The ping readout under the clock: hidden when null, amber above 120 ms, red with WAITING during a lasting stall. */
  setPing(ms: number | null, stalled: boolean): void {
    const base = ms === null ? '' : `${Math.round(ms)} ms`;
    const text = stalled ? (base ? `${base} · WAITING` : 'WAITING') : base;
    const cls = stalled ? 'stalled' : ms !== null && ms > 120 ? 'slow' : '';
    const key = `${text}|${cls}`;
    if (key === this.lastPing) return;
    this.lastPing = key;
    this.ping.textContent = text;
    this.ping.className = `ping ${cls}`.trim();
  }

  private renderName(player: number): void {
    const el = this.root.querySelectorAll<HTMLElement>('.name')[player];
    if (!el) return;
    const tag = this.tags[player];
    el.textContent = tag ? `${this.names[player]} · ${tag}` : this.names[player];
  }

  update(state: MatchState | null, cfg: Config, t = 0): void {
    this.root.classList.toggle('on', state !== null);
    if (!state) return;

    const pipsKey = `${cfg.winsToWin}:${state.scores.join(',')}`;
    if (pipsKey !== this.lastPips) {
      this.lastPips = pipsKey;
      this.sides.forEach((side, i) => {
        const score = state.scores[i] ?? 0;
        side.pips.innerHTML = Array.from(
          { length: Math.max(cfg.winsToWin, score) },
          (_, k) => `<span class="pip${k < score ? ' on' : ''}"></span>`,
        ).join('');
      });
    }

    state.snakes.forEach((s, i) => {
      const side = this.sides[i];
      if (!side) return;
      side.fill.style.width = `${Math.round(s.boostMeter * 100)}%`;

      const heartsKey = `${s.hearts}/${cfg.hearts}`;
      if (heartsKey !== side.lastHearts) {
        side.lastHearts = heartsKey;
        side.hearts.innerHTML = heartsHtml(s.hearts, cfg.hearts);
      }

      const active = EFFECT_ORDER.filter((e) => s.effects[e] > 0);
      const effectsKey = active.map((e) => `${e}:${Math.ceil(s.effects[e] / TICK_RATE)}`).join(',');
      if (effectsKey !== side.lastEffects) {
        side.lastEffects = effectsKey;
        side.effects.innerHTML = active
          .map((e) => `<span class="slot chip" data-kind="${e}" data-effect="${e}">${EFFECT_LABELS[e]} ${Math.ceil(s.effects[e] / TICK_RATE)}</span>`)
          .join('');
      }
      for (const chip of side.effects.querySelectorAll<HTMLElement>('[data-effect]')) {
        const ticks = s.effects[chip.dataset.effect as EffectName];
        chip.style.visibility = blinkOn(ticks / TICK_RATE, cfg.effectWarning, t) ? 'visible' : 'hidden';
      }

      const slotsKey = `${cfg.itemSlots}|${s.shield}|${s.items.map((it) => `${it.kind}:${it.charges}`).join(',')}`;
      if (slotsKey !== side.lastSlots) {
        side.lastSlots = slotsKey;
        side.slots.innerHTML = slotsHtml(s, cfg.itemSlots);
      }
    });

    const clock = state.overtime
      ? `OVERTIME ${formatClock(state.roundTicks, TICK_RATE)}`
      : formatClock(state.roundTicks, TICK_RATE);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.clock.textContent = clock;
      this.clock.classList.toggle('overtime', state.overtime);
    }
  }
}

function heartsHtml(hearts: number, max: number): string {
  return Array.from({ length: Math.max(1, Math.round(max)) }, (_, k) => `<span class="heart${k < hearts ? '' : ' lost'}">♥</span>`).join('');
}

/** The Shield bubble chip, then the item queue with the next item (front) highlighted. */
function slotsHtml(s: SnakeState, slotCount: number): string {
  const shield = s.shield ? '<span class="slot chip" data-kind="shield">SHIELD</span>' : '';
  const cells = Array.from({ length: Math.max(slotCount, s.items.length) }, (_, k) => {
    const item = s.items[k];
    if (!item) return '<span class="slot">—</span>';
    return `<span class="slot full${k === 0 ? ' next' : ''}" data-kind="${item.kind}">${describeItem(item)}</span>`;
  });
  return shield + cells.join('');
}
