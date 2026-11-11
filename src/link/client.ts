import {
  parseLinkMessage,
  snapshotUrl,
  socketUrl,
  type LinkHello,
  type LinkMessage,
} from "@/lib/link/protocol";
import type { LinkPhase } from "@/link/status";

const PING_MS = 20_000;
const PONG_LIMIT = 3;
const HELLO_MS = 5_000;
const POLL_VISIBLE_MS = 1_000;
const POLL_HIDDEN_MS = 5_000;
const QUIET_FIRST_MS = 2_000;
const QUIET_MAX_MS = 60_000;

export type LinkHandlers = {
  onMessage: (message: LinkMessage) => void;
  onPhase: (phase: LinkPhase, error?: string | null) => void;
  onHello?: (producer: LinkHello["producer"]) => void;
};

function backoff(attempt: number): number {
  const base = Math.min(8_000, 250 * 2 ** attempt);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export function quietDelay(attempt: number): number {
  return Math.min(QUIET_MAX_MS, QUIET_FIRST_MS * 2 ** Math.max(0, attempt - 1));
}

export class LinkClient {
  private readonly token: string;
  private readonly handlers: LinkHandlers;
  private ws: WebSocket | null = null;
  private stopped = false;
  private everConnected = false;
  private attempt = 0;
  private lastSeq = 0;
  private resyncing = false;
  private pongMissed = 0;
  private retryTimer: number | null = null;
  private pollTimer: number | null = null;
  private pingTimer: number | null = null;
  private helloTimer: number | null = null;
  private polling = false;

  constructor(token: string, handlers: LinkHandlers) {
    this.token = token.trim();
    this.handlers = handlers;
  }

  start(): void {
    this.stopped = false;
    this.everConnected = false;
    this.attempt = 0;
    this.lastSeq = 0;
    this.resyncing = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.polling = false;
    this.clearTimers();
    this.closeSocket();
    this.handlers.onPhase("off");
  }

  private clearTimers(): void {
    for (const timer of [this.retryTimer, this.pollTimer, this.pingTimer, this.helloTimer]) {
      if (timer !== null) window.clearTimeout(timer);
      if (timer !== null) window.clearInterval(timer);
    }
    this.retryTimer = null;
    this.pollTimer = null;
    this.pingTimer = null;
    this.helloTimer = null;
  }

  private closeSocket(): void {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    ws.close();
  }

  private connect(): void {
    if (this.stopped) return;
    if (this.attempt === 0) this.handlers.onPhase("connecting", null);
    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl(this.token));
    } catch (err) {
      this.fallback(err instanceof Error ? err.message : String(err));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.helloTimer = window.setTimeout(() => {
        if (this.ws === ws) ws.close();
      }, HELLO_MS);
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const parsed = parseLinkMessage(event.data);
      if (!parsed) return;
      const message = parsed.message;
      if (message.type === "hello") {
        if (this.helloTimer !== null) window.clearTimeout(this.helloTimer);
        this.helloTimer = null;
        this.attempt = 0;
        this.everConnected = true;
        this.pongMissed = 0;
        this.stopPolling();
        this.startPing();
        this.handlers.onHello?.(message.producer);
        this.handlers.onPhase("connected", null);
        return;
      }
      if (message.type === "pong") {
        this.pongMissed = 0;
        return;
      }
      if (message.type === "error") {
        this.handlers.onPhase("error", message.message || message.code);
        return;
      }
      if (message.type === "snapshot") {
        this.lastSeq = message.seq;
        this.resyncing = false;
        this.handlers.onMessage(message);
        return;
      }
      if (this.resyncing || message.seq <= this.lastSeq) return;
      if (message.seq !== this.lastSeq + 1) {
        this.resyncing = true;
        void this.requestSnapshot();
        return;
      }
      this.lastSeq = message.seq;
      this.handlers.onMessage(message);
    };
    ws.onerror = () => {
      // onclose carries the retry decision.
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.stopPing();
      if (this.stopped) return;
      if (!this.everConnected) {
        this.attempt += 1;
        this.handlers.onPhase("off", null);
        this.retryTimer = window.setTimeout(() => this.connect(), quietDelay(this.attempt));
        return;
      }
      this.attempt += 1;
      if (this.attempt >= 2 && !this.polling) {
        this.startPolling();
      }
      this.handlers.onPhase("error", "連線中斷，正在重試");
      this.retryTimer = window.setTimeout(() => this.connect(), backoff(this.attempt));
    };
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (this.pongMissed >= PONG_LIMIT) {
        ws.close();
        return;
      }
      this.pongMissed += 1;
      ws.send(JSON.stringify({ type: "ping", seq: 0 }));
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pongMissed = 0;
  }

  private fallback(error: string): void {
    if (!this.everConnected) {
      this.stopped = true;
      this.handlers.onPhase("off", null);
      return;
    }
    this.handlers.onPhase("error", error);
    this.startPolling();
  }

  private startPolling(): void {
    if (this.stopped || this.polling) return;
    this.polling = true;
    this.handlers.onPhase("polling", null);
    void this.poll();
  }

  private stopPolling(): void {
    this.polling = false;
    if (this.pollTimer !== null) window.clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.polling) return;
    try {
      const message = await this.fetchSnapshot();
      if (message) {
        this.lastSeq = message.seq;
        this.resyncing = false;
        this.handlers.onMessage(message);
        this.handlers.onPhase("polling", null);
      }
    } catch (err) {
      this.handlers.onPhase("error", err instanceof Error ? err.message : String(err));
    }
    if (this.stopped || !this.polling) return;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    this.pollTimer = window.setTimeout(
      () => void this.poll(),
      hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
    );
  }

  private async requestSnapshot(): Promise<void> {
    try {
      const message = await this.fetchSnapshot();
      if (!message) return;
      this.lastSeq = message.seq;
      this.resyncing = false;
      this.handlers.onMessage(message);
    } catch (err) {
      this.handlers.onPhase("error", err instanceof Error ? err.message : String(err));
      this.closeSocket();
    }
  }

  private async fetchSnapshot() {
    const response = await fetch(snapshotUrl(this.token), { cache: "no-store" });
    if (!response.ok) throw new Error(`snapshot ${response.status}`);
    const parsed = parseLinkMessage(await response.text());
    if (!parsed || parsed.message.type !== "snapshot") {
      throw new Error("snapshot shape");
    }
    return parsed.message;
  }
}
