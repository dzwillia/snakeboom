import { DEFAULT_CONFIG, hashState, type Config, type MatchState } from '../../sim';
import { decodeRelayed, encodeInput } from '../../net/codec';
import { EventGate } from '../../net/events';
import { displayName } from '../../net/names';
import { PROTOCOL, type RoundResult, type ServerMessage } from '../../net/protocol';
import { NetSession } from '../../net/session';
import { PLAYER_CSS } from '../colors';
import type { EventSink } from '../events';
import type { Hud } from '../hud';
import type { KeyboardInput } from '../input';
import type { Fx } from '../render/fx';
import type { Screens } from '../screens';
import { RelayClock } from './clock';
import { RelayConnection } from './transport';

export type OnlineMode = { kind: 'create'; winsToWin: number } | { kind: 'join'; room: string };

export interface OnlineDeps {
  screens: Screens;
  hud: Hud;
  fx: Fx;
  sink: EventSink;
  input: KeyboardInput;
  /** Back to the title screen. */
  onExit: () => void;
  /** Called with the names to use on banners whenever they change. */
  onNames: (names: string[]) => void;
  /** The loop's time scale, for time sync. */
  setTimeScale: (scale: number) => void;
}

type Phase = 'connecting' | 'lobby' | 'starting' | 'playing' | 'over' | 'error';

const TICK_MS = 1000 / 60;
const STALL_CAPTION_MS = 500;
const LEAVE_PROMPT_MS = 3000;
const HASH_EVERY = 60;
const SLOW_SCALE = 0.97;

/** One visit to a room: connect, lobby, ready-up, a match through NetSession, and the ways it ends. */
export class OnlineMatch {
  /** Fixed for the match: the defaults plus the room's first-to-N. */
  readonly cfg: Config = { ...DEFAULT_CONFIG };

  private readonly conn: RelayConnection;
  private readonly clock = new RelayClock();
  private readonly gate = new EventGate();
  private session: NetSession | null = null;
  private phase: Phase = 'connecting';
  private me = -1;
  private room = '';
  private link = '';
  private names: string[] = ['CYAN', 'PINK'];
  private lobby: Extract<ServerMessage, { type: 'lobby' }> | null = null;
  private startAtLocal = 0;
  private oneWayTicks = 2;
  private rttMs: number | null = null;
  private peerAwayDeadline: number | null = null;
  private reconnectShown = -1;
  private stalledSince: number | null = null;
  private stallShown = false;
  private leavePromptUntil = 0;
  private readonly onVisibility = () => {
    if (this.phase !== 'playing' && this.phase !== 'starting') return;
    this.conn.send({ type: document.hidden ? 'away' : 'back' });
  };

  constructor(
    url: string,
    name: string,
    private readonly mode: OnlineMode,
    private readonly deps: OnlineDeps,
  ) {
    this.conn = new RelayConnection(url);
    this.conn.onMessage = (m) => this.onMessage(m);
    this.conn.onFrame = (f) => this.onFrame(f);
    this.conn.onClose = (code) => this.onSocketClosed(code);
    this.conn.send({ type: 'hello', protocol: PROTOCOL, version: __APP_VERSION__, name });
    if (mode.kind === 'create') this.conn.send({ type: 'create', winsToWin: mode.winsToWin });
    else this.conn.send({ type: 'join', room: mode.room });
    deps.screens.caption('CONNECTING…');
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** The state to draw, once a match has started. */
  get state(): MatchState | null {
    return this.session?.state ?? null;
  }

  get playing(): boolean {
    return this.phase === 'playing';
  }

  /** For dev tools and browser checks. */
  get debug(): Record<string, unknown> {
    const s = this.session;
    return {
      phase: this.phase,
      me: this.me,
      room: this.room,
      tick: s?.tick ?? -1,
      confirmedTick: s?.confirmedTick ?? -1,
      stalled: s?.stalled ?? false,
      stats: s ? { ...s.stats } : null,
      sim: s ? { phase: s.state.phase, round: s.state.round, scores: s.state.scores.slice(), hearts: s.state.snakes.map((x) => x.hearts) } : null,
    };
  }

  /** One sim tick from the fixed-step loop. */
  tick(): void {
    if (this.phase === 'starting') {
      if (performance.now() < this.startAtLocal) return;
      this.phase = 'playing';
      this.deps.screens.clear();
    }
    if (this.phase !== 'playing' || !this.session) return;
    const events = this.session.advance(this.deps.input.sampleLocal());
    const play = this.gate.filter(events);
    if (play.length > 0) this.deps.sink.handle(play, this.session.state);
    if (this.session.tick % HASH_EVERY === 0) this.gate.prune(this.session.tick);
  }

  /** Once per rendered frame: time sync, the ping readout and the overlays that count down. */
  frame(nowMs: number): void {
    const session = this.session;
    const stalled = this.phase === 'playing' && !!session?.stalled;
    this.deps.setTimeScale(session && this.phase === 'playing' && session.lead(this.oneWayTicks) > 1 ? SLOW_SCALE : 1);
    this.deps.hud.setPing(this.lobby?.pingMs ?? null, stalled);

    if (this.peerAwayDeadline !== null && (this.phase === 'playing' || this.phase === 'starting')) {
      const seconds = Math.max(0, Math.ceil((this.peerAwayDeadline - nowMs) / 1000));
      if (seconds !== this.reconnectShown) {
        this.reconnectShown = seconds;
        this.deps.screens.reconnecting(this.names[1 - this.me], seconds);
      }
      return;
    }

    if (stalled) {
      if (this.stalledSince === null) this.stalledSince = nowMs;
      else if (!this.stallShown && nowMs - this.stalledSince > STALL_CAPTION_MS) {
        this.stallShown = true;
        this.deps.screens.waiting(this.names[1 - this.me]);
      }
    } else {
      this.stalledSince = null;
      if (this.stallShown) {
        this.stallShown = false;
        this.deps.screens.uncover();
      }
    }

    if (this.leavePromptUntil && nowMs > this.leavePromptUntil) {
      this.leavePromptUntil = 0;
      this.deps.screens.uncover();
    }
  }

  /** Space and Escape. Returns true when the key was used. */
  key(code: string): boolean {
    const matchOver = this.phase === 'playing' && this.session?.state.phase === 'matchOver';
    if (matchOver && code === 'Space') {
      // Request (or withdraw) a rematch; the lobby message updates the line under the banner.
      const mine = this.lobby?.players[this.me];
      this.conn.send({ type: 'ready', ready: !(mine?.ready ?? false) });
      return true;
    }
    if (matchOver && code === 'Escape') {
      this.conn.send({ type: 'ready', ready: false });
      this.toLobby();
      return true;
    }
    if (code === 'Space') {
      if (this.phase === 'lobby') {
        const mine = this.lobby?.players[this.me];
        this.conn.send({ type: 'ready', ready: !(mine?.ready ?? false) });
        return true;
      }
      if (this.phase === 'over') {
        this.toLobby();
        return true;
      }
      if (this.phase === 'error') {
        this.exit();
        return true;
      }
      if (this.leavePromptUntil) {
        this.leavePromptUntil = 0;
        this.deps.screens.uncover();
        return true;
      }
      return false;
    }
    if (code === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'starting') {
        if (this.leavePromptUntil) {
          this.conn.send({ type: 'leave' });
          this.exit();
        } else {
          this.leavePromptUntil = performance.now() + LEAVE_PROMPT_MS;
          this.deps.screens.leavePrompt();
        }
        return true;
      }
      if (this.phase === 'lobby' || this.phase === 'connecting') this.conn.send({ type: 'leave' });
      this.exit();
      return true;
    }
    return false;
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.conn.close();
    this.session = null;
    this.deps.setTimeScale(1);
    this.deps.hud.setPing(null, false);
  }

  private exit(): void {
    this.dispose();
    this.deps.onExit();
  }

  private onMessage(m: ServerMessage): void {
    const { screens } = this.deps;
    switch (m.type) {
      case 'welcome':
        this.me = m.player;
        this.room = m.room;
        this.link = `${location.origin}/r/${m.room}`;
        if (location.pathname !== `/r/${m.room}`) history.replaceState(null, '', `/r/${m.room}`);
        if (this.phase === 'connecting') this.phase = 'lobby';
        return;
      case 'lobby':
        this.lobby = m;
        this.names = m.players.map((p, i) => displayName(p?.name ?? '', i));
        this.deps.hud.setNames(this.names);
        this.deps.onNames(this.names);
        if (this.phase === 'lobby') this.showLobby();
        else if (this.phase === 'playing' && this.session?.state.phase === 'matchOver') this.showRematchLine();
        return;
      case 'ping':
        this.clock.onPing(m.t, performance.now(), this.rttMs);
        this.conn.send({ type: 'pong', t: m.t });
        return;
      case 'start':
        this.start(m);
        return;
      case 'peerAway':
        this.peerAwayDeadline = this.clock.toLocal(m.deadline);
        this.reconnectShown = -1;
        return;
      case 'peerBack':
        this.peerAwayDeadline = null;
        this.reconnectShown = -1;
        screens.uncover();
        return;
      case 'forfeit':
        this.end('over', `${this.names[m.winner]} WINS`, `${this.names[1 - m.winner]} LEFT THE MATCH`, PLAYER_CSS[m.winner]);
        return;
      case 'desync':
        this.end('over', 'OUT OF SYNC', 'MATCH VOIDED', 'var(--red)');
        return;
      case 'peerLeft':
        if (this.session?.state.phase === 'matchOver') return; // the lobby message updates the line
        if (this.phase === 'playing' || this.phase === 'starting') this.end('over', 'OPPONENT LEFT', '', 'var(--text)');
        return;
      case 'closed':
        if (m.reason === 'full') this.end('error', 'ROOM IS FULL', `${this.room || this.roomFromMode()} ALREADY HAS TWO PLAYERS`, 'var(--text)');
        else if (m.reason === 'unknownRoom') this.end('error', 'NO SUCH ROOM', 'THE LINK MAY HAVE EXPIRED', 'var(--text)');
        else if (m.reason === 'restart') this.end('error', 'SERVER RESTARTED', 'THE MATCH ENDED', 'var(--text)');
        else this.end('error', 'ROOM CLOSED', 'NOBODY PLAYED FOR A WHILE', 'var(--text)');
        return;
      case 'error':
        if (m.code === 'version') this.end('error', 'PLEASE REFRESH', 'THIS TAB IS RUNNING AN OLD VERSION', 'var(--text)');
        else if (m.code === 'busy') this.end('error', 'SERVER FULL', 'TRY AGAIN IN A MINUTE', 'var(--text)');
        else this.end('error', 'SOMETHING WENT WRONG', m.message.toUpperCase(), 'var(--text)');
        return;
    }
  }

  /** Back to the lobby view after a match, staying in the room. */
  private toLobby(): void {
    this.phase = 'lobby';
    this.session = null;
    this.peerAwayDeadline = null;
    this.deps.setTimeScale(1);
    this.deps.hud.setPing(this.lobby?.pingMs ?? null, false);
    this.deps.fx.clear();
    this.deps.sink.beat = null;
    this.showLobby();
  }

  private showRematchLine(): void {
    if (!this.lobby) return;
    const mine = this.lobby.players[this.me]?.ready ?? false;
    const peer = this.lobby.players[1 - this.me];
    const peerName = this.names[1 - this.me];
    let line = '';
    if (!peer) line = `${peerName} LEFT · SPACE FOR THE LOBBY`;
    else if (mine && peer.ready) line = 'REMATCH!';
    else if (mine) line = `REMATCH REQUESTED · WAITING FOR ${peerName}`;
    else if (peer.ready) line = `${peerName} WANTS A REMATCH · SPACE TO ACCEPT`;
    this.deps.screens.matchOverLine(line);
  }

  private roomFromMode(): string {
    return this.mode.kind === 'join' ? this.mode.room : '';
  }

  private showLobby(): void {
    if (!this.lobby || this.me < 0) return;
    this.deps.screens.lobby({
      code: this.room,
      link: this.link,
      players: this.lobby.players,
      winsToWin: this.lobby.winsToWin,
      pingMs: this.lobby.pingMs,
      me: this.me,
    });
  }

  private start(m: Extract<ServerMessage, { type: 'start' }>): void {
    this.cfg.winsToWin = m.winsToWin;
    this.rttMs = m.rttMs[this.me] ?? null;
    this.oneWayTicks = (m.rttMs[0] + m.rttMs[1]) / 2 / 2 / TICK_MS;
    this.session = new NetSession({
      seed: m.seed,
      cfg: this.cfg,
      local: this.me,
      inputDelay: m.inputDelay,
      send: (tick, input) => this.conn.sendFrame(encodeInput(tick, input)),
      onConfirmed: (tick, state, events) => this.onConfirmed(tick, state, events),
    });
    this.startAtLocal = this.clock.synced ? this.clock.toLocal(m.startAt) : performance.now() + 1500;
    this.peerAwayDeadline = null;
    this.stalledSince = null;
    this.stallShown = false;
    this.leavePromptUntil = 0;
    this.deps.sink.beat = null;
    this.deps.fx.clear();
    this.deps.input.clearLatches();
    this.phase = 'starting';
    this.deps.screens.caption('GET READY');
  }

  private onConfirmed(tick: number, state: MatchState, events: readonly { type: string }[]): void {
    const roundOver = events.find((e) => e.type === 'roundOver') as { winner: number | null } | undefined;
    if (tick % HASH_EVERY !== 0 && !roundOver) return;
    const result: RoundResult | undefined = roundOver
      ? { round: state.round, winner: roundOver.winner, scores: state.scores.slice(), matchWinner: state.matchWinner }
      : undefined;
    this.conn.send({ type: 'hash', tick, hash: hashState(state), ...(result ? { result } : {}) });
  }

  private onFrame(frame: Uint8Array): void {
    const decoded = decodeRelayed(frame);
    if (!decoded || !this.session || decoded.player === this.me) return;
    this.session.receive(decoded.tick, decoded.input);
  }

  private onSocketClosed(code: number): void {
    if (this.phase === 'over' || this.phase === 'error') return;
    const detail = code === 1006 ? 'THE RELAY IS UNREACHABLE' : `THE CONNECTION CLOSED (${code})`;
    this.end('error', 'CONNECTION LOST', detail, 'var(--text)');
  }

  private end(phase: 'over' | 'error', title: string, detail: string, colorCss: string): void {
    this.phase = phase;
    this.session = null;
    this.peerAwayDeadline = null;
    this.deps.setTimeScale(1);
    this.deps.hud.setPing(null, false);
    this.deps.screens.notice(title, detail, phase === 'over' ? 'SPACE LOBBY · ESC MENU' : 'SPACE OR ESC · MENU', colorCss);
  }
}
