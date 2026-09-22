import { useEffect, useMemo, useRef, useState } from "react";
import { HubClient, resolveHubUrl } from "@wasp/event-bus";
import { newId, type AnyEvent, type FaceState, type SharedContext, type WaspEvent } from "@wasp/shared-types";
import type { MagentaResearchSummary } from "../../research/types";

/**
 * The MAGENTA UI is a passive viewer of the shared event stream. It connects
 * to the hub as `researcher` with meta.role = "ui": the hub keeps an agent
 * online while ANY of its sockets is open, so reloading the page never marks
 * the researcher offline while the agent process is running.
 *
 * The UI never emits research or state events. It only emits tts_* (voice
 * layer, owned by Andrea) and, in dev, injects a fake architect request
 * through the hub's HTTP endpoint.
 */

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface HubView {
  status: ConnectionStatus;
  sessionId: string;
  context: SharedContext | null;
  events: AnyEvent[];
  faceState: FaceState;
  faceDetail: string;
  /** Whether the agent PROCESS (not this UI) is connected. */
  agentProcessOnline: boolean;
  research: MagentaResearchSummary | null;
  messages: WaspEvent<"agent_message">[];
  /** Latest line MAGENTA should speak on this PC. */
  lastSpeech: { id: string; text: string } | null;
  emitTts(kind: "tts_started" | "tts_finished", text: string, ok?: boolean): void;
  /** DEV ONLY: fake a CYAN research_request via the hub's HTTP API. */
  simulateArchitectRequest(question: string): Promise<string>;
}

const MAX_EVENTS = 200;

// Guarded so the file also compiles under the root tsconfig (no vite/client types there).
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

export function useHub(): HubView {
  const url = useMemo(() => resolveHubUrl(viteEnv.VITE_WASP_HUB_URL || undefined), []);
  const hubRef = useRef<HubClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [sessionId, setSessionId] = useState("");
  const [context, setContext] = useState<SharedContext | null>(null);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const [research, setResearch] = useState<MagentaResearchSummary | null>(null);
  const [messages, setMessages] = useState<WaspEvent<"agent_message">[]>([]);
  const [lastSpeech, setLastSpeech] = useState<{ id: string; text: string } | null>(null);
  const [faceDetail, setFaceDetail] = useState("");

  useEffect(() => {
    const hub = new HubClient({ agent: "researcher", mode: "real", url, meta: { role: "ui" }, log: (m) => console.debug("[hub]", m) });
    hubRef.current = hub;

    const offAny = hub.onAny((e) => {
      if (e.type !== "context_updated") setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), e]);
      switch (e.type) {
        case "session_snapshot":
          setContext(e.payload.context);
          setSessionId(e.payload.context.session_id);
          setStatus("open");
          break;
        case "context_updated":
          setContext(e.payload.context);
          break;
        case "agent_state":
          if (e.payload.agent === "researcher") setFaceDetail(e.payload.detail ?? "");
          break;
        case "research_result":
          if (e.from === "researcher") setResearch(e.payload as MagentaResearchSummary);
          break;
        case "agent_message":
          setMessages((prev) => [...prev.slice(-19), e]);
          if (e.from === "researcher" && e.payload.speak !== false) setLastSpeech({ id: e.id, text: e.payload.message });
          break;
        case "speak_requested":
          if (e.payload.agent === "researcher") setLastSpeech({ id: e.id, text: e.payload.text });
          break;
        default:
          break;
      }
    });

    hub.connect().catch(() => setStatus("closed"));
    const poll = setInterval(() => setStatus((s) => (hub.connected ? (s === "open" ? s : "open") : s === "open" ? "closed" : s)), 1000);

    return () => {
      clearInterval(poll);
      offAny();
      hub.close();
      hubRef.current = null;
    };
  }, [url]);

  const agentProcessOnline = useMemo(() => {
    // The UI itself is a researcher socket; only trust presence if a non-UI registration is recorded.
    const me = context?.agents?.researcher;
    return Boolean(me && me.status === "online" && (me.meta as { role?: string } | undefined)?.role !== "ui");
  }, [context]);

  const faceState: FaceState = status !== "open" ? "OFFLINE" : (context?.agent_states?.researcher ?? "OFFLINE");

  const emitTts: HubView["emitTts"] = (kind, text, ok = true) => {
    const hub = hubRef.current;
    if (!hub) return;
    if (kind === "tts_started") hub.emit("tts_started", { agent: "researcher", text });
    else hub.emit("tts_finished", { agent: "researcher", ok });
  };

  const simulateArchitectRequest = async (question: string): Promise<string> => {
    const http = url.replace(/^ws/, "http");
    const request_id = newId("req");
    const res = await fetch(`${http}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "research_request",
        from: "architect",
        to: "researcher",
        correlation_id: request_id,
        payload: { request_id, question, scope: { source: "magenta-ui-dev-button" } },
      }),
    });
    if (!res.ok) throw new Error(`hub responded ${res.status}`);
    return request_id;
  };

  return { status, sessionId, context, events, faceState, faceDetail, agentProcessOnline, research, messages, lastSpeech, emitTts, simulateArchitectRequest };
}
