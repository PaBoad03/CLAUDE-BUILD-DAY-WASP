/**
 * HubClient — the ONE way an agent talks to the WASP HUB.
 *
 *   const hub = await connectHub({ agent: 'researcher' });
 *   hub.on('research_request', async (evt) => { ... hub.emit('research_result', {...}, { to: evt.from, correlation_id: evt.correlation_id }) });
 *   hub.say('architect', 'Research request received.', 'ack');
 *
 * Works in Node >= 22 and in browsers: it uses the global WebSocket.
 */

import {
  AGENT_IDS,
  DEFAULT_HUB_PORT,
  isWaspEvent,
  newId,
  nowIso,
  type AgentId,
  type AgentMode,
  type AgentPresence,
  type AnyEvent,
  type AuditEntry,
  type EventPayloads,
  type EventType,
  type FaceState,
  type Participant,
  type SharedContext,
  type WaspEvent,
} from '@wasp/shared-types';

export interface ConnectOptions {
  /** Who am I. Use 'human' only for UI bridges that inject user_message / user_authorization. */
  agent: AgentId | 'human';
  mode?: AgentMode;
  url?: string;
  meta?: Record<string, unknown>;
  /** Auto-reconnect with backoff. Default true. */
  reconnect?: boolean;
  log?: (msg: string) => void;
}

export interface EmitOptions {
  to?: Participant;
  correlation_id?: string;
}

export interface RequestOptions<R extends EventType> extends EmitOptions {
  /** Event type that answers this request. */
  expect: R | R[];
  /** Default 30s. */
  timeoutMs?: number;
  /** If the target agent is not online, fail immediately instead of waiting. Default true. */
  failIfOffline?: boolean;
}

export type Handler<T extends EventType> = (event: WaspEvent<T>) => void | Promise<void>;
export type AnyHandler = (event: AnyEvent) => void | Promise<void>;

export class AgentUnavailableError extends Error {
  constructor(public readonly agent: Participant, detail?: string) {
    super(`Agent "${agent}" is unavailable${detail ? `: ${detail}` : ''}`);
    this.name = 'AgentUnavailableError';
  }
}

export class RequestTimeoutError extends Error {
  constructor(public readonly type: string, public readonly to: Participant, ms: number) {
    super(`No "${type}" response from "${to}" within ${ms}ms`);
    this.name = 'RequestTimeoutError';
  }
}

export function resolveHubUrl(explicit?: string): string {
  if (explicit) return explicit;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.WASP_HUB_URL) return env.WASP_HUB_URL;
  if (typeof location !== 'undefined' && location.hostname) {
    return `ws://${location.hostname}:${DEFAULT_HUB_PORT}`;
  }
  return `ws://localhost:${DEFAULT_HUB_PORT}`;
}

export class HubClient {
  readonly agent: AgentId | 'human';
  readonly mode: AgentMode;
  readonly url: string;

  private ws: WebSocket | null = null;
  private handlers = new Map<EventType, Set<Handler<EventType>>>();
  private anyHandlers = new Set<AnyHandler>();
  private closedByUser = false;
  private backoff = 500;
  private log: (msg: string) => void;
  private meta: Record<string, unknown>;
  private reconnectEnabled: boolean;
  private queue: string[] = [];

  /** Latest authoritative snapshot from the hub. Read, don't mutate. */
  context: SharedContext | null = null;
  session_id = '';

  constructor(opts: ConnectOptions) {
    this.agent = opts.agent;
    this.mode = opts.mode ?? 'real';
    this.url = resolveHubUrl(opts.url);
    this.meta = opts.meta ?? {};
    this.reconnectEnabled = opts.reconnect ?? true;
    this.log = opts.log ?? (() => {});
  }

  // ---------------------------------------------------------------- lifecycle

  connect(): Promise<this> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const open = () => {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.backoff = 500;
          this.log(`connected to ${this.url}`);
          if (this.agent !== 'human') {
            this.send(this.build('agent_registered', { agent: this.agent, mode: this.mode, meta: this.meta }, { to: 'hub' }));
          } else {
            this.send(this.build('agent_registered', { agent: 'architect', mode: this.mode, meta: { ...this.meta, bridge: 'human' } }, { to: 'hub' }));
          }
          for (const q of this.queue.splice(0)) ws.send(q);
        };

        ws.onmessage = (m) => {
          let data: unknown;
          try {
            data = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data));
          } catch {
            return;
          }
          if (!isWaspEvent(data)) return;
          if (data.type === 'session_snapshot') {
            this.context = data.payload.context;
            this.session_id = data.payload.context.session_id;
            if (!settled) {
              settled = true;
              resolve(this);
            }
          } else if (data.type === 'context_updated') {
            this.context = data.payload.context;
          }
          this.dispatch(data);
        };

        ws.onerror = () => {
          this.log(`socket error (${this.url})`);
        };

        ws.onclose = () => {
          this.ws = null;
          if (this.closedByUser) return;
          if (!settled && !this.reconnectEnabled) {
            settled = true;
            reject(new Error(`Could not connect to hub at ${this.url}`));
            return;
          }
          if (!this.reconnectEnabled) return;
          this.log(`disconnected, retrying in ${this.backoff}ms`);
          setTimeout(open, this.backoff);
          this.backoff = Math.min(this.backoff * 2, 10_000);
        };
      };
      open();
    });
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  // ---------------------------------------------------------------- presence

  /** Presence of every agent, from the authoritative context. */
  agents(): Record<AgentId, AgentPresence> | null {
    return this.context?.agents ?? null;
  }

  isOnline(agent: Participant): boolean {
    if (agent === 'hub' || agent === 'all' || agent === 'human') return true;
    return this.context?.agents?.[agent]?.status === 'online';
  }

  /** true if the agent is connected as a stub responder (fake data). */
  isStub(agent: Participant): boolean {
    if (!(AGENT_IDS as readonly string[]).includes(agent)) return false;
    return this.context?.agents?.[agent as AgentId]?.mode === 'stub';
  }

  // ---------------------------------------------------------------- emit

  build<T extends EventType>(type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    return {
      id: newId('evt'),
      type,
      session_id: this.session_id,
      from: this.agent,
      to: opts.to ?? 'all',
      timestamp: nowIso(),
      payload,
      correlation_id: opts.correlation_id,
    };
  }

  emit<T extends EventType>(type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    const evt = this.build(type, payload, opts);
    this.send(evt);
    return evt;
  }

  private send(evt: WaspEvent): void {
    const raw = JSON.stringify(evt);
    if (this.ws && this.ws.readyState === 1) this.ws.send(raw);
    else this.queue.push(raw);
  }

  /** The visible/audible agent-to-agent line. */
  say(to: Participant, message: string, intent?: string, data?: unknown, speak = true): WaspEvent<'agent_message'> {
    return this.emit('agent_message', { message, intent, speak, data }, { to });
  }

  setState(state: FaceState, detail?: string): void {
    if (this.agent === 'human') return;
    this.emit('agent_state', { agent: this.agent, state, detail }, { to: 'all' });
  }

  audit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'agent'> & Partial<Pick<AuditEntry, 'agent'>>): WaspEvent<'audit_event'> {
    return this.emit('audit_event', {
      id: newId('aud'),
      timestamp: nowIso(),
      agent: entry.agent ?? this.agent,
      ...entry,
    } as AuditEntry);
  }

  // ---------------------------------------------------------------- request/response

  /**
   * Emit a request and wait for the correlated response.
   * Throws AgentUnavailableError if the target is offline, RequestTimeoutError on silence.
   * NEVER swallow these: an offline agent must be reported, not faked.
   */
  request<T extends EventType, R extends EventType>(
    type: T,
    payload: EventPayloads[T],
    opts: RequestOptions<R>,
  ): Promise<WaspEvent<R>> {
    const to = opts.to ?? 'all';
    if ((opts.failIfOffline ?? true) && to !== 'all' && !this.isOnline(to)) {
      return Promise.reject(new AgentUnavailableError(to, 'not connected to hub'));
    }
    // Convention: correlation_id === payload.request_id / permission_id, so responders can just echo it.
    const p = payload as Record<string, unknown> | undefined;
    const correlation_id =
      opts.correlation_id ??
      (typeof p?.request_id === 'string' ? p.request_id : undefined) ??
      (typeof p?.permission_id === 'string' ? p.permission_id : undefined) ??
      newId('req');
    const expects = Array.isArray(opts.expect) ? opts.expect : [opts.expect];
    const timeoutMs = opts.timeoutMs ?? 30_000;

    return new Promise<WaspEvent<R>>((resolve, reject) => {
      const offs: Array<() => void> = [];
      const cleanup = () => offs.forEach((f) => f());
      const timer = setTimeout(() => {
        cleanup();
        reject(new RequestTimeoutError(expects.join('|'), to, timeoutMs));
      }, timeoutMs);

      for (const ex of expects) {
        offs.push(
          this.on(ex, (evt) => {
            if (evt.correlation_id !== correlation_id) return;
            clearTimeout(timer);
            cleanup();
            resolve(evt as WaspEvent<R>);
          }),
        );
      }
      offs.push(
        this.on('agent_offline', (evt) => {
          if (evt.payload.agent !== to) return;
          clearTimeout(timer);
          cleanup();
          reject(new AgentUnavailableError(to, 'went offline while handling the request'));
        }),
      );
      this.emit(type, payload, { to, correlation_id });
    });
  }

  // ---------------------------------------------------------------- subscribe

  on<T extends EventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<EventType>);
    return () => set!.delete(handler as Handler<EventType>);
  }

  onAny(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /** Convenience: only events addressed to me (or to all). */
  onMine<T extends EventType>(type: T, handler: Handler<T>): () => void {
    return this.on(type, (evt) => {
      if (evt.to === this.agent || evt.to === 'all') return handler(evt);
    });
  }

  private dispatch(evt: AnyEvent): void {
    for (const h of this.anyHandlers) void safe(h, evt, this.log);
    const set = this.handlers.get(evt.type);
    if (set) for (const h of set) void safe(h as Handler<EventType>, evt, this.log);
  }
}

async function safe(h: (e: AnyEvent) => void | Promise<void>, e: AnyEvent, log: (m: string) => void) {
  try {
    await h(e);
  } catch (err) {
    log(`handler for ${e.type} threw: ${(err as Error).message}`);
  }
}

/** Connect and resolve once the hub has sent the session snapshot. */
export async function connectHub(opts: ConnectOptions): Promise<HubClient> {
  const client = new HubClient(opts);
  await client.connect();
  return client;
}
