import { TICK_RATE, type Config, type EffectName, type MatchState, type SnakeState } from '../sim';
import { blinkOn } from './blink';
import { PLAYER_NAMES, describeItem, formatClock } from './text';

const EFFECT_ORDER: EffectName[] = ['dozer', 'ghost', 'turbo', 'slow', 'reverse'];
const EFFECT_LABELS: Record<EffectName, string> = {
  dozer: 'DOZER',
  ghost: 'GHOST',
  turbo: 'TURBO',
  slow: 'SLOWED',
  reverse: 'REVERSED',
};

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
  private lastPips = '';
  private lastClock = '';

  constructor(private readonly root: HTMLElement) {
    const side = (i: number) =>
      `<div class="side p${i + 1}">` +
      `<div class="row"><span class="name">${PLAYER_NAMES[i]}</span><span class="hearts"></span><span class="pips"></span></div>` +
      `<div class="row"><span class="boost"><span class="fill" style="display:block"></span></span>` +
      `<span class="effects"></span><span class="slots"></span></div></div>`;
    root.innerHTML = `${side(0)}<div class="clock">0:00</div>${side(1)}`;
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
  }

  /** Adds a tag after a player's name (like AI) or clears it with an empty string. */
  setTag(player: number, tag: string): void {
    const name = this.root.querySelectorAll<HTMLElement>('.name')[player];
    if (name) name.textContent = tag ? `${PLAYER_NAMES[player]} · ${tag}` : PLAYER_NAMES[player];
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
