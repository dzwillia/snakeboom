import { ARENA_HEIGHT, ARENA_WIDTH, DEFAULT_CONFIG, hashState, type Config, type MatchState } from '../../sim';
import { decodeRelayed, decodeReplay, encodeInput, FRAME_REPLAY } from '../../net/codec';
import { EventGate } from '../../net/events';
import { displayName } from '../../net/names';
import { PROTOCOL, type ClientMessage, type RoundResult, type ServerMessage } from '../../net/protocol';
import { emptyStats, NetSession, statsDelta, type SessionStats } from '../../net/session';
import { timeScaleFor } from '../../net/timeSync';
import { followView, MAX_ZOOM, type View } from '../camera';
import { PLAYER_CSS } from '../colors';
import { describeRound, PLAYER_NAMES } from '../text';
import type { EventSink } from '../events';
import type { Hud } from '../hud';
import type { KeyboardInput } from '../input';
import type { Fx } from '../render/fx';
import type { Screens } from '../screens';
import { HeadSmoothing } from '../smoothing';
import { RelayClock } from './clock';
import { inviteLink } from './link';
import { RelayConnection } from './transport';

export type OnlineMode =
  /** `name`: the room name the host chose, or undefined for a random code. */
  | { kind: 'create'; winsToWin: number; size: number; name?: string }
  | { kind: 'join'; room: string }
  | { kind: 'quick'; winsToWin: number; size: number }
  /** A refreshed tab coming back to its room with its session token. */
  | { kind: 'rejoin'; room: string; session: string };

export const SESSION_KEY = 'snakeboom.session';

/** The first message of a refreshed tab: identify the seat and ask for the whole log. */
export function rejoinHello(name: string, session: string): ClientMessage {
  return { type: 'hello', protocol: PROTOCOL, version: __APP_VERSION__, name, session, fromTick: 0 };
}

/** The room and token of the tab's current visit, so a refresh can rejoin. */
export function storedSession(): { room: string; session: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as { room?: unknown; session?: unknown }) : null;
    return parsed && typeof parsed.room === 'string' && typeof parsed.session === 'string' ? { room: parsed.room, session: parsed.session } : null;
  } catch {
    return null;
  }
}

function storeSession(value: { room: string; session: string } | null): void {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode or blocked storage: refreshing just won't rejoin.
  }
}

export interface OnlineDeps {
  screens: Screens;
  hud: Hud;
  fx: Fx;
  sink: EventSink;
  input: KeyboardInput;
  /** Back to the title screen. */
  onExit: () => void;
  /** The player took the AI offer while waiting in the queue: start a local match at this length. */
  onAi: (winsToWin: number) => void;
  /** Called with the names to use on banners whenever they change. */
  onNames: (names: string[]) => void;
  /** The relay refused the chosen room name (taken, most likely); `message` says why. The match is over. */
  onRoomNameRefused: (name: string, message: string) => void;
  /** The loop's time scale, for time sync. */
  setTimeScale: (scale: number) => void;
  /** A connection opened early (a rejoin hello already sent), so the countdown stops before the renderer is up. */
  connection?: RelayConnection;
}

type Phase = 'connecting' | 'queue' | 'lobby' | 'starting' | 'rejoining' | 'playing' | 'over' | 'error';

const TICK_MS = 1000 / 60;
const STALL_CAPTION_MS = 500;
/** A stall shorter than this stays out of the ping readout (the N readout still counts it). */
const STALL_SHOW_MS = 300;
const LEAVE_PROMPT_MS = 3000;
const HASH_EVERY = 60;
const AI_OFFER_MS = 10_000;
const CATCH_UP_PER_FRAME = 600;

/** One visit to a room: connect, lobby, ready-up, a match through NetSession, and the ways it ends. */
export class OnlineMatch {
  /** Fixed for the match: the defaults plus the room's first-to-N. */
  readonly cfg: Config = { ...DEFAULT_CONFIG };

  private readonly conn: RelayConnection;
  private readonly clock = new RelayClock();
  /** Replaced for every match, since tick numbers start over. */
  private gate = new EventGate();
  private session: NetSession | null = null;
  private phase: Phase = 'connecting';
  /** My room seat. */
  private me = -1;
  /** My sim player index once a match is on (seats compact to players), or −1. */
  private player = -1;
  /** Room seat → sim player index (−1 for an empty seat) for the current match. */
  private seatMap: number[] = [];
  private room = '';
  private link = '';
  /** Names by room seat. */
  private names: string[] = [...PLAYER_NAMES];
  /** Names by sim player index, for the HUD and banners during a match. */
  private playerNames: string[] = [...PLAYER_NAMES];
  /** Spectating after death: which live snake (by sim index) the camera follows, and how close. */
  private spectating: number | null = null;
  private spectateZoom = MAX_ZOOM;
  /** The seat whose drop is being shown (two-player rooms count down; larger ones just note it). */
  private awaySeat: number | null = null;
  private lobby: Extract<ServerMessage, { type: 'lobby' }> | null = null;
  private startAtLocal = 0;
  private oneWayTicks = 2;
  private rttMs: number | null = null;
  /** The relay's latest estimate of the latency between the players. */
  private pingMs: number | null = null;
  private stalledSinceMs: number | null = null;
  private peerAwayDeadline: number | null = null;
  private reconnectShown = -1;
  private stalledSince: number | null = null;
  private stallShown = false;
  private leavePromptUntil = 0;
  private queuedSince = 0;
  private queueOnline = 1;
  private queueShown = '';
  private replayFrames = 0;
  private showNet = false;
  private readonly smoothing = new HeadSmoothing(8);
  private roundStatsBase: SessionStats = emptyStats();
  /** For the per-minute rates: stats and time at the last readout sample. */
  private rateSample: { at: number; stats: SessionStats } | null = null;
  private rates = { rollbacksPerMin: 0, stallsPerMin: 0 };
  private timeScale = 1;
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
    this.conn = deps.connection ?? new RelayConnection(url);
    this.conn.attach({
      onMessage: (m) => this.onMessage(m),
      onFrame: (f) => this.onFrame(f),
      onClose: (code) => this.onSocketClosed(code),
    });
    if (deps.connection) {
      // The hello went out already; the replies are waiting in the connection's inbox.
    } else if (mode.kind === 'rejoin') {
      this.conn.send(rejoinHello(name, mode.session));
    } else {
      this.conn.send({ type: 'hello', protocol: PROTOCOL, version: __APP_VERSION__, name });
      if (mode.kind === 'create') this.conn.send({ type: 'create', winsToWin: mode.winsToWin, size: mode.size, ...(mode.name ? { name: mode.name } : {}) });
      else if (mode.kind === 'join') this.conn.send({ type: 'join', room: mode.room });
      else this.conn.send({ type: 'queue', winsToWin: mode.winsToWin, size: mode.size });
    }
    deps.screens.caption(mode.kind === 'rejoin' ? 'REJOINING…' : 'CONNECTING…');
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** The state to draw, once a match has started. */
  get state(): MatchState | null {
    return this.session?.state ?? null;
  }

  get playing(): boolean {
    return this.phase === 'playing';
  }

  /** Which sim player this machine plays, or −1 outside a match. */
  get localPlayer(): number {
    return this.player;
  }

  /**
   * Where the camera should look: your own head while you're alive; after that the snake you're
   * spectating (the longest live one until you pick with Left/Right); null when nobody is alive.
   */
  cameraTarget(state: MatchState): View | null {
    const mine = state.snakes[this.player];
    if (mine?.alive) return followView(mine, ARENA_WIDTH, ARENA_HEIGHT);
    const live = state.snakes.filter((s) => s.alive);
    if (live.length === 0) return null;
    let target = this.spectating === null ? null : state.snakes[this.spectating];
    if (!target?.alive) {
      target = live.reduce((best, s) => (s.targetLength > best.targetLength ? s : best), live[0]);
      this.spectating = target.id;
    }
    return followView(target, ARENA_WIDTH, ARENA_HEIGHT, this.spectateZoom);
  }

  /** Left/Right: the next live snake; Up/Down: closer or wider. Only while dead in a match. */
  private spectateKey(code: string): boolean {
    const state = this.session?.state;
    if (!state || this.phase !== 'playing' || state.snakes[this.player]?.alive) return false;
    const live = state.snakes.filter((s) => s.alive).map((s) => s.id);
    if (live.length === 0) return false;
    const at = Math.max(0, live.indexOf(this.spectating ?? -1));
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.spectating = live[(at - 1 + live.length) % live.length];
        return true;
      case 'ArrowRight':
      case 'KeyD':
        this.spectating = live[(at + 1) % live.length];
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.spectateZoom = Math.min(MAX_ZOOM, this.spectateZoom + 0.25);
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.spectateZoom = Math.max(1, this.spectateZoom - 0.25);
        return true;
      default:
        return false;
    }
  }

  /** The other player's name in a two-player room; who to wait for otherwise. */
  private peerLabel(): string {
    if (this.names.length <= 2) return this.names[1 - this.me] ?? PLAYER_NAMES[1 - this.me];
    return 'THE OTHERS';
  }

  /** Visual offsets for the drawn heads (rollback smoothing). */
  get offsets(): readonly { x: number; y: number }[] {
    return this.smoothing.offsets;
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
    for (const c of this.session.takeCorrections()) this.smoothing.correct(c.player, c.dx, c.dy);
    const play = this.gate.filter(events);
    if (play.length > 0) this.deps.sink.handle(play, this.session.state);
    if (this.session.tick % HASH_EVERY === 0) this.gate.prune(this.session.tick);
  }

  /** Once per rendered frame: time sync, the ping readout and the overlays that count down. */
  frame(nowMs: number): void {
    if (this.phase === 'queue') {
      this.showQueue(nowMs);
      return;
    }
    if (this.phase === 'rejoining') {
      this.catchUp();
      return;
    }
    const session = this.session;
    const stalled = this.phase === 'playing' && !!session?.stalled;
    // Only a stall that lasts (not a single late frame) is worth showing next to the ping.
    if (stalled) this.stalledSinceMs ??= nowMs;
    else this.stalledSinceMs = null;
    const stalledVisibly = this.stalledSinceMs !== null && nowMs - this.stalledSinceMs >= STALL_SHOW_MS;
    this.smoothing.frame();
    session?.state.snakes.forEach((sn, i) => {
      if (!sn.alive) this.smoothing.reset(i);
    });
    this.timeScale = session && this.phase === 'playing' ? timeScaleFor(session.smoothedLead) : 1;
    this.deps.setTimeScale(this.timeScale);
    this.deps.hud.setPing(this.pingMs, stalledVisibly);
    this.updateNetReadout(nowMs);

    if (this.peerAwayDeadline !== null && (this.phase === 'playing' || this.phase === 'starting')) {
      const seconds = Math.max(0, Math.ceil((this.peerAwayDeadline - nowMs) / 1000));
      if (seconds !== this.reconnectShown) {
        this.reconnectShown = seconds;
        this.deps.screens.reconnecting(this.names[this.awaySeat ?? 1 - this.me] ?? 'YOUR OPPONENT', seconds);
      }
      return;
    }

    if (stalled) {
      if (this.stalledSince === null) this.stalledSince = nowMs;
      else if (!this.stallShown && nowMs - this.stalledSince > STALL_CAPTION_MS) {
        this.stallShown = true;
        this.deps.screens.waiting(this.peerLabel());
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

  /** The net readout: rates over the last second, refreshed once a second. */
  private updateNetReadout(nowMs: number): void {
    const session = this.session;
    if (!this.showNet || !session || this.phase !== 'playing') {
      this.deps.hud.setNet(null);
      this.rateSample = null;
      return;
    }
    const stats = { ...session.stats };
    if (!this.rateSample) this.rateSample = { at: nowMs, stats };
    const elapsed = nowMs - this.rateSample.at;
    if (elapsed >= 1000) {
      const d = statsDelta(stats, this.rateSample.stats);
      const perMin = 60000 / elapsed;
      this.rates = { rollbacksPerMin: d.rollbacks * perMin, stallsPerMin: d.stalledTicks * perMin };
      this.rateSample = { at: nowMs, stats };
    }
    this.deps.hud.setNet({
      inputDelay: session.inputDelay,
      rollbacksPerMin: this.rates.rollbacksPerMin,
      maxRollbackDepth: stats.maxRollbackDepth,
      stallsPerMin: this.rates.stallsPerMin,
      lead: session.smoothedLead,
      timeScale: this.timeScale,
    });
  }

  /** Space and Escape (and N for the net readout). Returns true when the key was used. */
  key(code: string): boolean {
    if (code === 'KeyN') {
      this.showNet = !this.showNet;
      return true;
    }
    if (this.spectateKey(code)) return true;
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
    if (this.phase === 'queue') {
      if (code === 'Escape') {
        this.conn.send({ type: 'leaveQueue' });
        this.exit();
        return true;
      }
      if (code === 'KeyA' && this.aiOffered(performance.now())) {
        this.conn.send({ type: 'leaveQueue' });
        const winsToWin = this.mode.kind === 'quick' ? this.mode.winsToWin : this.cfg.winsToWin;
        this.dispose();
        this.deps.onAi(winsToWin);
        return true;
      }
      return false;
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
    storeSession(null);
    this.dispose();
    this.deps.onExit();
  }

  private onMessage(m: ServerMessage): void {
    const { screens } = this.deps;
    switch (m.type) {
      case 'welcome':
        this.me = m.player;
        this.room = m.room;
        this.link = inviteLink(location.origin, m.room);
        storeSession({ room: m.room, session: m.session });
        if (location.pathname !== `/r/${m.room}`) history.replaceState(null, '', `/r/${m.room}`);
        if (this.phase === 'connecting' && this.mode.kind === 'quick') {
          this.phase = 'queue';
          this.queuedSince = performance.now();
        } else if (this.phase === 'connecting' && this.mode.kind !== 'rejoin') {
          this.phase = 'lobby';
        }
        return;
      case 'queued':
        this.queueOnline = m.online;
        if (this.phase === 'queue') this.showQueue(performance.now());
        return;
      case 'resume':
        this.resume(m);
        return;
      case 'lobby':
        this.lobby = m;
        this.pingMs = m.pingMs;
        // An empty seat keeps its last name, so "Ada left" reads right after Ada leaves.
        this.names = m.players.map((p, i) => (p ? displayName(p.name, i) : (this.names[i] ?? displayName('', i))));
        // A rejoining tab gets its resume before this lobby message, so the names catch up here.
        this.refreshPlayerNames();
        // Quick match: the lobby shows as soon as someone else is in; a bigger room keeps filling from there.
        if (this.phase === 'queue' && m.players.filter((p) => p !== null).length >= 2) this.phase = 'lobby';
        if (this.phase === 'connecting' && this.mode.kind === 'rejoin') this.phase = 'lobby';
        if (this.phase === 'lobby') this.showLobby();
        else if (this.phase === 'playing' && this.session?.state.phase === 'matchOver') this.showRematchLine();
        return;
      case 'ping':
        this.clock.onPing(m.t, performance.now(), this.rttMs);
        if (m.pingMs !== null && m.pingMs !== undefined) this.pingMs = m.pingMs;
        this.conn.send({ type: 'pong', t: m.t });
        return;
      case 'start':
        this.start(m);
        return;
      case 'seatAway':
        this.awaySeat = m.seat;
        if (m.deadline === null) {
          // A bigger room: their snake coasts on; just say so.
          if (this.phase === 'playing') screens.flash(`${this.names[m.seat] ?? 'A PLAYER'} DROPPED`, 'var(--dim)', 1500);
          return;
        }
        this.peerAwayDeadline = this.clock.toLocal(m.deadline);
        this.reconnectShown = -1;
        return;
      case 'seatBack':
        if (this.peerAwayDeadline !== null) screens.uncover();
        this.peerAwayDeadline = null;
        this.reconnectShown = -1;
        this.awaySeat = null;
        return;
      case 'ended':
        this.end('over', 'YOU WIN', 'EVERYONE ELSE LEFT THE MATCH', PLAYER_CSS[this.player] ?? 'var(--text)');
        return;
      case 'forfeit': {
        const loser = this.names.findIndex((_, i) => i !== m.winner && this.lobby?.players[i]);
        const loserName = this.names[loser >= 0 ? loser : 1 - m.winner] ?? 'YOUR OPPONENT';
        const winnerPlayer = this.seatMap[m.winner] ?? m.winner;
        this.end('over', `${this.names[m.winner]} WINS`, `${loserName} LEFT THE MATCH`, PLAYER_CSS[winnerPlayer] ?? 'var(--text)');
        return;
      }
      case 'desync':
        this.end('over', 'OUT OF SYNC', 'MATCH VOIDED', 'var(--red)');
        return;
      case 'seatLeft':
        if (this.session?.state.phase === 'matchOver') return; // the lobby message updates the line
        if (this.phase !== 'playing' && this.phase !== 'starting') return;
        if (this.names.length <= 2) this.end('over', 'OPPONENT LEFT', '', 'var(--text)');
        else screens.flash(`${this.names[m.seat] ?? 'A PLAYER'} LEFT`, 'var(--dim)', 1500);
        return;
      case 'closed':
        storeSession(null);
        if (m.reason === 'full') this.end('error', 'ROOM IS FULL', `${this.room || this.roomFromMode()} HAS NO SEAT LEFT OR IS MID-MATCH`, 'var(--text)');
        else if (m.reason === 'unknownRoom') this.end('error', 'NO SUCH ROOM', 'THE LINK MAY HAVE EXPIRED', 'var(--text)');
        else if (m.reason === 'restart') this.end('error', 'SERVER RESTARTED', 'THE MATCH ENDED', 'var(--text)');
        else this.end('error', 'ROOM CLOSED', 'NOBODY PLAYED FOR A WHILE', 'var(--text)');
        return;
      case 'error':
        if (m.code === 'version') this.end('error', 'PLEASE REFRESH', 'THIS TAB IS RUNNING AN OLD VERSION', 'var(--text)');
        else if (m.code === 'busy') this.end('error', 'SERVER FULL', 'TRY AGAIN IN A MINUTE', 'var(--text)');
        else if (m.code === 'roomName' && this.mode.kind === 'create') {
          // Back to the form with the relay's reason, so the host can pick another name.
          const name = this.mode.name ?? '';
          this.phase = 'error';
          storeSession(null);
          this.dispose();
          this.deps.onRoomNameRefused(name, m.message);
        }
        else this.end('error', 'SOMETHING WENT WRONG', m.message.toUpperCase(), 'var(--text)');
        return;
    }
  }

  private aiOffered(nowMs: number): boolean {
    return nowMs - this.queuedSince >= AI_OFFER_MS;
  }

  private showQueue(nowMs: number): void {
    const key = `${this.link}|${this.queueOnline}|${this.aiOffered(nowMs)}`;
    if (key === this.queueShown) return;
    this.queueShown = key;
    this.deps.screens.queue({ link: this.link, online: this.queueOnline, aiOffered: this.aiOffered(nowMs) });
  }

  /** A mid-match rejoin: build the session, then wait for the replay frame. */
  /** Names in sim order (through the seat map during a match, seat order otherwise), for the HUD and banners. */
  private refreshPlayerNames(): void {
    if (this.seatMap.length === 0) {
      this.playerNames = [...this.names];
    } else {
      const players = this.seatMap.filter((p) => p >= 0).length;
      this.playerNames = Array.from({ length: players }, (_, p) => PLAYER_NAMES[p]);
      this.seatMap.forEach((p, seat) => {
        if (p >= 0) this.playerNames[p] = this.names[seat] ?? PLAYER_NAMES[seat];
      });
    }
    this.deps.hud.setNames(this.playerNames);
    this.deps.onNames(this.playerNames);
  }

  /** Seats compact to sim players for a match: remember the map and the names in sim order. */
  private seatMatch(m: { players: number; seats: number[]; rttMs: number[] }): void {
    this.seatMap = m.seats;
    this.player = m.seats[this.me] ?? -1;
    this.deps.hud.setLocal(this.player);
    this.refreshPlayerNames();
    const present = m.rttMs.filter((_, seat) => m.seats[seat] >= 0);
    const meanRtt = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 100;
    this.oneWayTicks = meanRtt / 2 / TICK_MS;
    this.spectating = null;
    this.spectateZoom = MAX_ZOOM;
  }

  private resume(m: Extract<ServerMessage, { type: 'resume' }>): void {
    this.cfg.winsToWin = m.winsToWin;
    this.rttMs = m.rttMs[this.me] ?? null;
    this.seatMatch(m);
    this.replayFrames = m.frames;
    this.session = new NetSession({
      seed: m.seed,
      cfg: this.cfg,
      players: m.players,
      local: this.player,
      inputDelay: m.inputDelay,
      oneWayTicks: this.oneWayTicks,
      send: (tick, input) => this.conn.sendFrame(encodeInput(tick, input)),
      onConfirmed: (tick, state, events) => this.onConfirmed(tick, state, events),
    });
    this.gate = new EventGate();
    this.smoothing.reset();
    this.roundStatsBase = emptyStats();
    this.rateSample = null;
    this.deps.sink.beat = null;
    this.deps.fx.clear();
    this.deps.input.clearLatches();
    this.phase = 'rejoining';
    this.deps.screens.caption('REJOINING…');
    if (m.frames === 0) this.finishCatchUp();
  }

  private onReplay(frame: Uint8Array): void {
    const entries = decodeReplay(frame);
    if (!entries || !this.session) return;
    for (const e of entries) {
      const p = this.seatMap[e.player] ?? -1;
      if (p < 0) continue;
      if (e.player === this.me) this.session.restoreLocal(e.tick, e.input);
      else this.session.receive(p, e.tick, e.input);
    }
    this.replayFrames = 0;
  }

  /** One slice of catch-up per frame, with a progress caption; nothing is sent until it's done. */
  private catchUp(): void {
    const session = this.session;
    if (!session || this.replayFrames > 0) return;
    // Done when there is nothing more to replay: the peer may sit a few ticks ahead (it stalled
    // waiting for us), and only our live inputs can close that gap.
    const stepped = session.catchUp(CATCH_UP_PER_FRAME);
    const total = Math.max(1, session.remoteTickSeen);
    if (stepped > 0 && session.behind) {
      this.deps.screens.caption(`REJOINING… ${Math.min(99, Math.floor((100 * session.confirmedTick) / total))}%`);
      return;
    }
    this.finishCatchUp();
  }

  private finishCatchUp(): void {
    const session = this.session;
    if (!session) return;
    this.phase = 'playing';
    this.stalledSince = null;
    this.stallShown = false;
    const state = session.state;
    const { screens } = this.deps;
    screens.clear();
    if (state.phase === 'roundOver') {
      const { title, detail } = describeRound(state.lastRoundWinner, state.deaths, this.playerNames, state.lastPlaces);
      screens.roundOver(title, detail, state.lastRoundWinner);
    } else if (state.phase === 'matchOver' && state.matchWinner !== null) {
      screens.matchOver(state.matchWinner, state.scores, this.playerNames, 'SPACE REMATCH · ESC LOBBY');
      this.showRematchLine();
    }
  }

  /** Back to the lobby view after a match, staying in the room. */
  private toLobby(): void {
    this.phase = 'lobby';
    this.session = null;
    this.seatMap = [];
    this.player = -1;
    this.peerAwayDeadline = null;
    this.awaySeat = null;
    this.deps.setTimeScale(1);
    this.deps.hud.setPing(this.pingMs, false);
    this.deps.fx.clear();
    this.deps.sink.beat = null;
    this.showLobby();
  }

  private showRematchLine(): void {
    if (!this.lobby) return;
    const mine = this.lobby.players[this.me]?.ready ?? false;
    let line = '';
    if (this.lobby.players.length <= 2) {
      const peer = this.lobby.players[1 - this.me];
      const peerName = this.names[1 - this.me];
      if (!peer) line = `${peerName} LEFT · SPACE FOR THE LOBBY`;
      else if (mine && peer.ready) line = 'REMATCH!';
      else if (mine) line = `REMATCH REQUESTED · WAITING FOR ${peerName}`;
      else if (peer.ready) line = `${peerName} WANTS A REMATCH · SPACE TO ACCEPT`;
    } else {
      const seated = this.lobby.players.filter((p) => p !== null);
      const ready = seated.filter((p) => p?.ready).length;
      if (seated.length < 2) line = 'EVERYONE LEFT · SPACE FOR THE LOBBY';
      else if (ready === seated.length) line = 'REMATCH!';
      else line = `${ready} OF ${seated.length} WANT A REMATCH${mine ? '' : ' · SPACE TO JOIN IN'}`;
    }
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
      size: this.lobby.size,
      pingMs: this.lobby.pingMs,
      me: this.me,
    });
  }

  private start(m: Extract<ServerMessage, { type: 'start' }>): void {
    this.cfg.winsToWin = m.winsToWin;
    this.rttMs = m.rttMs[this.me] ?? null;
    this.seatMatch(m);
    this.session = new NetSession({
      seed: m.seed,
      cfg: this.cfg,
      players: m.players,
      local: this.player,
      inputDelay: m.inputDelay,
      oneWayTicks: this.oneWayTicks,
      send: (tick, input) => this.conn.sendFrame(encodeInput(tick, input)),
      onConfirmed: (tick, state, events) => this.onConfirmed(tick, state, events),
    });
    this.gate = new EventGate();
    this.smoothing.reset();
    this.roundStatsBase = emptyStats();
    this.rateSample = null;
    this.startAtLocal = this.clock.synced ? this.clock.toLocal(m.startAt) : performance.now() + 1500;
    this.peerAwayDeadline = null;
    this.awaySeat = null;
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
    let result: RoundResult | undefined;
    if (roundOver && this.session) {
      const net = statsDelta({ ...this.session.stats }, this.roundStatsBase);
      this.roundStatsBase = { ...this.session.stats };
      result = { round: state.round, winner: roundOver.winner, scores: state.scores.slice(), matchWinner: state.matchWinner, net };
    }
    this.conn.send({ type: 'hash', tick, hash: hashState(state), ...(result ? { result } : {}) });
  }

  private onFrame(frame: Uint8Array): void {
    if (frame[0] === FRAME_REPLAY) return this.onReplay(frame);
    const decoded = decodeRelayed(frame);
    if (!decoded || !this.session || decoded.player === this.me) return;
    const p = this.seatMap[decoded.player] ?? -1;
    if (p >= 0) this.session.receive(p, decoded.tick, decoded.input);
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
