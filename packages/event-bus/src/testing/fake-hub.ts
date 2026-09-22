/**
 * FakeHub — in-memory stand-in for HubClient, for unit tests of any agent.
 *
 *   import { FakeHub } from '@wasp/event-bus/testing';
 *   const hub = new FakeHub('operator');
 *   hub.responder = (evt) => evt.type === 'permission_requested' ? hub.build...  : undefined;
 *   await hub.deliver('validation_request', payload, 'architect', 'operator');
 *   hub.ofType('validation_result')
 *
 * It records everything the agent emits (`sent`), lets a test inject events "from the hub"
 * (`deliver`) and can auto-answer requests (`responder`) so `hub.request()` resolves.
 * Structurally compatible with HubClient, so agents can type their dependency as
 * `Pick<HubClient, 'onMine' | 'emit' | ...>` and take either.
 */

import {
  AGENT_IDS,
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
import { AgentUnavailableError, RequestTimeoutError, type AnyHandler, type EmitOptions, type Handler, type RequestOptions } from '../index';

export type Responder = (evt: AnyEvent) => AnyEvent | AnyEvent[] | void | Promise<AnyEvent | AnyEvent[] | void>;

export class FakeHub {
  readonly agent: AgentId | 'human';
  readonly mode: AgentMode;
  readonly url = 'fake://hub';
  session_id = 'sess_test';
  context: SharedContext | null = null;

  /** Every event the agent under test emitted, in order. */
  readonly sent: AnyEvent[] = [];
  /** Which agents `isOnline()` reports. Default: everyone. */
  online = new Set<Participant>([...AGENT_IDS]);
  /** Which agents `isStub()` reports. */
  stubs = new Set<Participant>();
  /** Test hook: called after every emit; returned events are delivered back as if from the hub. */
  responder?: Responder;

  private handlers = new Map<EventType, Set<Handler<EventType>>>();
  private anyHandlers = new Set<AnyHandler>();

  constructor(agent: AgentId | 'human' = 'architect', mode: AgentMode = 'real') {
    this.agent = agent;
    this.mode = mode;
  }

  // ---------------------------------------------------------------- lifecycle (no-ops)

  connect(): Promise<this> {
    return Promise.resolve(this);
  }
  close(): void {}
  get connected(): boolean {
    return true;
  }

  // ---------------------------------------------------------------- presence

  agents(): Record<AgentId, AgentPresence> | null {
    return this.context?.agents ?? null;
  }
  isOnline(agent: Participant): boolean {
    if (agent === 'hub' || agent === 'all' || agent === 'human') return true;
    return this.online.has(agent);
  }
  isStub(agent: Participant): boolean {
    return this.stubs.has(agent);
  }

  // ---------------------------------------------------------------- emit

  build<T extends EventType>(type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    return { id: newId('evt'), type, session_id: this.session_id, from: this.agent, to: opts.to ?? 'all', timestamp: nowIso(), payload, correlation_id: opts.correlation_id };
  }

  /**
   * Records the event and, like the real hub, echoes it back to the sender's own handlers
   * (the hub broadcasts every accepted event to every client, sender included).
   */
  emit<T extends EventType>(type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    const evt = this.build(type, payload, opts);
    this.sent.push(evt as AnyEvent);
    queueMicrotask(async () => {
      if (this.echo) await this.dispatch(evt as AnyEvent);
      const out = await this.responder?.(evt as AnyEvent);
      if (!out) return;
      for (const e of Array.isArray(out) ? out : [out]) await this.dispatch(e);
    });
    return evt;
  }

  /** Echo emitted events back to the agent's own handlers (default true, as the real hub does). */
  echo = true;

  say(to: Participant, message: string, intent?: string, data?: unknown, speak = true): WaspEvent<'agent_message'> {
    return this.emit('agent_message', { message, intent, speak, data }, { to });
  }

  setState(state: FaceState, detail?: string): void {
    if (this.agent === 'human') return;
    this.emit('agent_state', { agent: this.agent, state, detail }, { to: 'all' });
  }

  audit(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'agent'> & Partial<Pick<AuditEntry, 'agent'>>): WaspEvent<'audit_event'> {
    return this.emit('audit_event', { id: newId('aud'), timestamp: nowIso(), agent: entry.agent ?? this.agent, ...entry } as AuditEntry);
  }

  // ---------------------------------------------------------------- request/response

  request<T extends EventType, R extends EventType>(type: T, payload: EventPayloads[T], opts: RequestOptions<R>): Promise<WaspEvent<R>> {
    const to = opts.to ?? 'all';
    if ((opts.failIfOffline ?? true) && to !== 'all' && !this.isOnline(to)) {
      return Promise.reject(new AgentUnavailableError(to, 'not connected to hub'));
    }
    const p = payload as Record<string, unknown> | undefined;
    const correlation_id =
      opts.correlation_id ?? (typeof p?.request_id === 'string' ? p.request_id : undefined) ?? (typeof p?.permission_id === 'string' ? p.permission_id : undefined) ?? newId('req');
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

  onMine<T extends EventType>(type: T, handler: Handler<T>): () => void {
    return this.on(type, (evt) => {
      if (evt.to === this.agent || evt.to === 'all') return handler(evt);
    });
  }

  // ---------------------------------------------------------------- test helpers

  /** Deliver an event as if it came from the hub. Awaits every handler and the echoes/responses they triggered. */
  async deliver<T extends EventType>(type: T, payload: EventPayloads[T], from: Participant, to: Participant = 'all', correlation_id?: string): Promise<WaspEvent<T>> {
    const evt: WaspEvent<T> = { id: newId('evt'), type, session_id: this.session_id, from, to, timestamp: nowIso(), payload, correlation_id };
    await this.dispatch(evt as AnyEvent);
    await new Promise((r) => setImmediate(r)); // drain echo / responder microtasks
    return evt;
  }

  /** Build an event from another participant (for `responder` return values). */
  from<T extends EventType>(from: Participant, type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    return { id: newId('evt'), type, session_id: this.session_id, from, to: opts.to ?? 'all', timestamp: nowIso(), payload, correlation_id: opts.correlation_id };
  }

  /** All events of one type the agent emitted. */
  ofType<T extends EventType>(type: T): WaspEvent<T>[] {
    return this.sent.filter((e) => e.type === type) as unknown as WaspEvent<T>[];
  }

  /** Face states the agent went through, in order. */
  states(): FaceState[] {
    return this.ofType('agent_state').map((e) => e.payload.state);
  }

  /** Spoken lines the agent emitted. */
  said(): string[] {
    return this.ofType('agent_message').map((e) => e.payload.message);
  }

  /** Wait for the microtask queue / short timers to drain. */
  settle(ms = 5): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async dispatch(evt: AnyEvent): Promise<void> {
    for (const h of this.anyHandlers) await h(evt);
    const set = this.handlers.get(evt.type);
    if (set) for (const h of [...set]) await (h as Handler<EventType>)(evt);
  }
}
