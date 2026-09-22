import type { EmitOptions, Handler } from "@wasp/event-bus";
import { newId, nowIso, type AnyEvent, type AuditEntry, type EventPayloads, type EventType, type FaceState, type Participant, type WaspEvent } from "@wasp/shared-types";
import type { HubLike } from "../src/agent/ResearcherAgent";

/**
 * In-memory stand-in for HubClient, for unit tests. Records everything the
 * agent emits and lets a test inject events "from the hub".
 */
export class FakeHub implements HubLike {
  readonly agent = "researcher" as const;
  readonly session_id = "sess_test";
  readonly sent: AnyEvent[] = [];
  private handlers = new Map<EventType, Set<Handler<EventType>>>();

  onMine<T extends EventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped: Handler<EventType> = (evt) => {
      if (evt.to === this.agent || evt.to === "all") return (handler as Handler<EventType>)(evt);
    };
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  emit<T extends EventType>(type: T, payload: EventPayloads[T], opts: EmitOptions = {}): WaspEvent<T> {
    const evt: WaspEvent<T> = {
      id: newId("evt"),
      type,
      session_id: this.session_id,
      from: this.agent,
      to: opts.to ?? "all",
      timestamp: nowIso(),
      payload,
      correlation_id: opts.correlation_id,
    };
    this.sent.push(evt as AnyEvent);
    return evt;
  }

  say(to: Participant, message: string, intent?: string, data?: unknown, speak = true): WaspEvent<"agent_message"> {
    return this.emit("agent_message", { message, intent, speak, data }, { to });
  }

  setState(state: FaceState, detail?: string): void {
    this.emit("agent_state", { agent: this.agent, state, detail }, { to: "all" });
  }

  audit(entry: Omit<AuditEntry, "id" | "timestamp" | "agent"> & Partial<Pick<AuditEntry, "agent">>): WaspEvent<"audit_event"> {
    return this.emit("audit_event", { id: newId("aud"), timestamp: nowIso(), agent: entry.agent ?? this.agent, ...entry } as AuditEntry);
  }

  /** Test helper: deliver an event as if it came from the hub. */
  async deliver<T extends EventType>(type: T, payload: EventPayloads[T], from: Participant, to: Participant = "researcher", correlation_id?: string) {
    const evt: WaspEvent<T> = { id: newId("evt"), type, session_id: this.session_id, from, to, timestamp: nowIso(), payload, correlation_id };
    const set = this.handlers.get(type);
    if (set) for (const h of set) await h(evt as WaspEvent<EventType>);
    return evt;
  }

  /** All events of one type the agent emitted. */
  ofType<T extends EventType>(type: T): WaspEvent<T>[] {
    return this.sent.filter((e) => e.type === type) as unknown as WaspEvent<T>[];
  }

  states(): FaceState[] {
    return this.ofType("agent_state").map((e) => e.payload.state);
  }
}
