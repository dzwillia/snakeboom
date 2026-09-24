import type { ClientMessage, ServerMessage } from '../../net/protocol';

/** `wss://api.example.com/ws` from `https://api.example.com` (or ws from http). */
export function relayUrl(base: string): string {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/**
 * One WebSocket to the relay: JSON control messages and binary input frames, queued until open.
 * Incoming traffic is buffered until `attach` names the handlers, so a connection can be opened
 * (and a rejoin hello sent) before the rest of the client has finished starting up.
 */
export class RelayConnection {
  onOpen: () => void = () => {};

  private onMessage: ((message: ServerMessage) => void) | null = null;
  private onFrame: ((frame: Uint8Array) => void) | null = null;
  private onClose: ((code: number, reason: string) => void) | null = null;
  private readonly inbox: ({ message: ServerMessage } | { frame: Uint8Array } | { closed: [number, string] })[] = [];

  private readonly socket: WebSocket;
  private readonly queue: (string | Uint8Array<ArrayBuffer>)[] = [];
  private isOpen = false;
  private closedByUs = false;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => {
      this.isOpen = true;
      for (const item of this.queue) this.socket.send(item);
      this.queue.length = 0;
      this.onOpen();
    };
    this.socket.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (ev.data instanceof ArrayBuffer) {
        this.deliver({ frame: new Uint8Array(ev.data) });
        return;
      }
      try {
        const parsed = JSON.parse(ev.data) as ServerMessage;
        if (parsed && typeof parsed.type === 'string') this.deliver({ message: parsed });
      } catch {
        // Ignore anything unreadable; the relay never sends it.
      }
    };
    this.socket.onclose = (ev) => {
      this.isOpen = false;
      if (!this.closedByUs) this.deliver({ closed: [ev.code, ev.reason] });
    };
    this.socket.onerror = () => {
      // onclose follows with the code.
    };
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** Names the handlers and replays anything that arrived before they existed. */
  attach(handlers: {
    onMessage: (message: ServerMessage) => void;
    onFrame: (frame: Uint8Array) => void;
    onClose: (code: number, reason: string) => void;
  }): void {
    this.onMessage = handlers.onMessage;
    this.onFrame = handlers.onFrame;
    this.onClose = handlers.onClose;
    const pending = this.inbox.splice(0);
    for (const item of pending) this.deliver(item);
  }

  private deliver(item: { message: ServerMessage } | { frame: Uint8Array } | { closed: [number, string] }): void {
    if (!this.onMessage || !this.onFrame || !this.onClose) {
      this.inbox.push(item);
      return;
    }
    if ('message' in item) this.onMessage(item.message);
    else if ('frame' in item) this.onFrame(item.frame);
    else this.onClose(...item.closed);
  }

  send(message: ClientMessage): void {
    this.push(JSON.stringify(message));
  }

  sendFrame(frame: Uint8Array): void {
    this.push(frame.buffer instanceof ArrayBuffer ? (frame as Uint8Array<ArrayBuffer>) : new Uint8Array(frame));
  }

  close(): void {
    this.closedByUs = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(1000, 'bye');
  }

  private push(item: string | Uint8Array<ArrayBuffer>): void {
    if (this.isOpen) this.socket.send(item);
    else if (this.socket.readyState === WebSocket.CONNECTING) this.queue.push(item);
  }
}
