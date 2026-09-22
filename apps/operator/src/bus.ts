import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { AgentId, EventType, WaspEvent } from '@wasp/tools';

export type Handler = (e: WaspEvent) => void;

/**
 * Minimal event bus interface. `packages/event-bus` (owner: Pablo) should
 * expose something equivalent; when it does, implement this interface on
 * top of it (or replace it) — the agent only depends on these three methods.
 */
export interface Bus {
  publish(e: WaspEvent): Promise<void>;
  subscribe(h: Handler): () => void;
  close(): Promise<void>;
}

export function makeEvent<T>(
  session_id: string,
  type: EventType,
  from: AgentId,
  to: AgentId | 'broadcast',
  payload: T,
): WaspEvent<T> {
  return { event_id: randomUUID(), session_id, timestamp: new Date().toISOString(), type, from, to, payload };
}

/** Local, single-process bus. Used for tests and the standalone demo. */
export class InMemoryBus implements Bus {
  private handlers = new Set<Handler>();
  readonly log: WaspEvent[] = [];

  async publish(e: WaspEvent) {
    this.log.push(e);
    // Deliver asynchronously so publishers never re-enter subscribers.
    queueMicrotask(() => { for (const h of [...this.handlers]) h(e); });
  }
  subscribe(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  async close() { this.handlers.clear(); }
}

/**
 * WebSocket client to the WASP HUB. Protocol assumption (to be confirmed
 * with Pablo): one JSON-encoded WaspEvent per text frame, both directions.
 * On connect we announce ourselves with `agent_started`.
 * If the hub protocol differs, adapt `encode`/`decode` only.
 */
export class WebSocketBus implements Bus {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private queue: string[] = [];
  private closed = false;
  private reconnectMs = 1000;

  constructor(
    private readonly url: string,
    private readonly onStatus: (s: 'connecting' | 'open' | 'closed') => void = () => {},
  ) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    this.onStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.on('open', () => {
      this.reconnectMs = 1000;
      this.onStatus('open');
      for (const m of this.queue.splice(0)) ws.send(m);
    });
    ws.on('message', (data) => {
      const e = decode(data.toString());
      if (e) for (const h of [...this.handlers]) h(e);
    });
    ws.on('close', () => {
      this.onStatus('closed');
      if (!this.closed) setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, 10_000);
    });
    ws.on('error', () => { /* close handler reconnects */ });
  }

  async publish(e: WaspEvent) {
    const msg = JSON.stringify(e);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(msg);
    else this.queue.push(msg);
  }
  subscribe(h: Handler) { this.handlers.add(h); return () => this.handlers.delete(h); }
  async close() { this.closed = true; this.ws?.close(); this.handlers.clear(); }
}

function decode(raw: string): WaspEvent | null {
  try {
    const e = JSON.parse(raw) as Partial<WaspEvent>;
    if (typeof e.type !== 'string' || typeof e.from !== 'string') return null;
    return {
      event_id: e.event_id ?? randomUUID(),
      session_id: e.session_id ?? 'unknown',
      timestamp: e.timestamp ?? new Date().toISOString(),
      type: e.type as EventType,
      from: e.from as AgentId,
      to: (e.to ?? 'broadcast') as WaspEvent['to'],
      payload: e.payload ?? {},
    };
  } catch {
    return null;
  }
}
