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

/** One WebSocket to the relay: JSON control messages and binary input frames, queued until open. */
export class RelayConnection {
  onOpen: () => void = () => {};
  onMessage: (message: ServerMessage) => void = () => {};
  onFrame: (frame: Uint8Array) => void = () => {};
  onClose: (code: number, reason: string) => void = () => {};

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
        this.onFrame(new Uint8Array(ev.data));
        return;
      }
      try {
        const parsed = JSON.parse(ev.data) as ServerMessage;
        if (parsed && typeof parsed.type === 'string') this.onMessage(parsed);
      } catch {
        // Ignore anything unreadable; the relay never sends it.
      }
    };
    this.socket.onclose = (ev) => {
      this.isOpen = false;
      if (!this.closedByUs) this.onClose(ev.code, ev.reason);
    };
    this.socket.onerror = () => {
      // onclose follows with the code.
    };
  }

  get open(): boolean {
    return this.isOpen;
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
