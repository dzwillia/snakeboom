import { PLAYER_CSS } from './colors';
import { PLAYER_NAMES } from './text';

type ScreenKind = 'none' | 'title' | 'countdown' | 'banner' | 'matchOver' | 'paused';

/** Centered overlay messages. All strings are our own, never user input. */
export class Screens {
  private token = 0;
  private kind: ScreenKind = 'none';
  private beforePause: { kind: ScreenKind; html: string } | null = null;

  constructor(private readonly root: HTMLElement) {}

  clear(): void {
    this.show('', 'none');
  }

  title(winsToWin: number): void {
    this.show(
      `
      <div class="panel">
        <div class="logo">SNAKEBOOM</div>
        <div class="controls">
          <div class="p1"><h3>${PLAYER_NAMES[0]}</h3>
            <p><kbd>A</kbd> <kbd>D</kbd> steer</p><p><kbd>W</kbd> boost</p><p><kbd>S</kbd> use item</p></div>
          <div class="p2"><h3>${PLAYER_NAMES[1]}</h3>
            <p><kbd>←</kbd> <kbd>→</kbd> steer</p><p><kbd>↑</kbd> boost</p><p><kbd>↓</kbd> use item</p></div>
        </div>
        <div class="small">PICKUPS: BOMB · GHOST · SHIELD · TURBO · SLOW · REVERSE</div>
        <div class="hint">PRESS SPACE TO START</div>
        <div class="small">FIRST TO ${winsToWin} · <kbd>ESC</kbd> PAUSE · <kbd>M</kbd> MUTE · <kbd>\`</kbd> TUNING</div>
      </div>`,
      'title',
    );
  }

  countdown(n: number | 'GO'): void {
    const token = this.show(`<div class="big" style="color:var(--text)">${n}</div>`, 'countdown');
    if (n === 'GO') this.clearLater(token, 700);
  }

  roundOver(title: string, detail: string, winner: number | null): void {
    const color = winner === null ? 'var(--text)' : PLAYER_CSS[winner];
    this.show(
      `<div><div class="banner-title" style="color:${color}">${title}</div><div class="banner-detail">${detail}</div></div>`,
      'banner',
    );
  }

  matchOver(winner: number, scores: readonly number[]): void {
    this.show(
      `
      <div class="panel">
        <div class="banner-title" style="color:${PLAYER_CSS[winner]}">${PLAYER_NAMES[winner]} WINS</div>
        <div class="banner-detail">${scores.join(' – ')}</div>
        <div class="hint">SPACE REMATCH · ESC MENU</div>
      </div>`,
      'matchOver',
    );
  }

  /** Shows the pause panel, remembering what it covers. */
  paused(): void {
    this.beforePause = { kind: this.kind, html: this.root.innerHTML };
    this.show(
      `<div class="panel"><div class="banner-title" style="color:var(--text)">PAUSED</div><div class="hint">ESC TO RESUME</div></div>`,
      'paused',
    );
  }

  /** Brings back a banner the pause panel covered; transient countdown numbers are dropped. */
  resume(): void {
    const saved = this.beforePause;
    this.beforePause = null;
    if (saved && (saved.kind === 'banner' || saved.kind === 'matchOver')) this.show(saved.html, saved.kind);
    else this.clear();
  }

  private show(html: string, kind: ScreenKind): number {
    this.token++;
    this.kind = kind;
    this.root.innerHTML = html;
    return this.token;
  }

  private clearLater(token: number, ms: number): void {
    setTimeout(() => {
      if (token === this.token) this.clear();
    }, ms);
  }
}
