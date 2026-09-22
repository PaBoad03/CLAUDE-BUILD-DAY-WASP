import { useEffect, useMemo, useRef, useState } from 'react';
import { HubClient, resolveHubUrl } from '@wasp/event-bus';
import type { AgentId, AnyEvent, EventPayloads, EventType, FaceState, SharedContext, WaspEvent } from '@wasp/shared-types';

/**
 * A face is a passive viewer of the shared event stream (docs/CONTRACT.md §2).
 * It connects to the hub as its agent with meta.role = "ui": the hub streams
 * everything to it but never counts it as the agent being online.
 *
 * The UI emits only voice-layer events (tts_*, stt_transcript). Human input
 * (buttons, typed text) enters WASP through the hub's HTTP bridge as `human`.
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface HubView {
  status: ConnectionStatus;
  sessionId: string;
  context: SharedContext | null;
  events: AnyEvent[];
  /** This PC's agent face state (OFFLINE when the hub is unreachable). */
  faceState: FaceState;
  faceDetail: string;
  /** Whether the agent PROCESS (not this UI) is connected. */
  agentProcessOnline: boolean;
  /** Presence of any agent, from the authoritative context. */
  isOnline(agent: AgentId): boolean;
  messages: WaspEvent<'agent_message'>[];
  /** Latest line this PC should speak: its own agent_message / speak_requested. */
  lastSpeech: { id: string; text: string } | null;
  emitTts(kind: 'tts_started' | 'tts_finished', text: string, ok?: boolean): void;
  /** Voice layer: the human spoke on this PC. */
  emitTranscript(text: string, final: boolean, confidence?: number): void;
  /** Human input through the hub HTTP bridge (from: 'human'). */
  postAsHuman<T extends EventType>(type: T, payload: EventPayloads[T], opts?: { to?: string; correlation_id?: string }): Promise<void>;
}

export interface UseHubOptions {
  url?: string;
  maxEvents?: number;
}

export function useHub(agent: AgentId, opts: UseHubOptions = {}): HubView {
  const url = useMemo(() => resolveHubUrl(opts.url), [opts.url]);
  const maxEvents = opts.maxEvents ?? 200;
  const hubRef = useRef<HubClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [sessionId, setSessionId] = useState('');
  const [context, setContext] = useState<SharedContext | null>(null);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const [messages, setMessages] = useState<WaspEvent<'agent_message'>[]>([]);
  const [lastSpeech, setLastSpeech] = useState<{ id: string; text: string } | null>(null);
  const [faceDetail, setFaceDetail] = useState('');

  useEffect(() => {
    const hub = new HubClient({ agent, mode: 'real', url, meta: { role: 'ui' }, log: (m) => console.debug('[hub]', m) });
    hubRef.current = hub;
    const offAny = hub.onAny((e) => {
      if (e.type !== 'context_updated') setEvents((prev) => [...prev.slice(-(maxEvents - 1)), e]);
      switch (e.type) {
        case 'session_snapshot':
          setContext(e.payload.context);
          setSessionId(e.payload.context.session_id);
          setMessages(e.payload.recent_events.filter((x): x is WaspEvent<'agent_message'> => x.type === 'agent_message').slice(-20));
          setStatus('open');
          break;
        case 'context_updated':
          setContext(e.payload.context);
          break;
        case 'agent_state':
          if (e.payload.agent === agent) setFaceDetail(e.payload.detail ?? '');
          break;
        case 'agent_message':
          setMessages((prev) => [...prev.slice(-19), e]);
          if (e.from === agent && e.payload.speak !== false) setLastSpeech({ id: e.id, text: e.payload.message });
          break;
        case 'speak_requested':
          if (e.payload.agent === agent) setLastSpeech({ id: e.id, text: e.payload.text });
          break;
        default:
          break;
      }
    });
    hub.connect().catch(() => setStatus('closed'));
    const poll = setInterval(() => setStatus((s) => (hub.connected ? 'open' : s === 'open' ? 'closed' : s)), 1000);
    return () => {
      clearInterval(poll);
      offAny();
      hub.close();
      hubRef.current = null;
    };
  }, [agent, url, maxEvents]);

  const isOnline = (a: AgentId) => context?.agents?.[a]?.status === 'online';
  const agentProcessOnline = isOnline(agent);
  const faceState: FaceState = status !== 'open' ? 'OFFLINE' : (context?.agent_states?.[agent] ?? 'OFFLINE');

  const emitTts: HubView['emitTts'] = (kind, text, ok = true) => {
    const hub = hubRef.current;
    if (!hub) return;
    if (kind === 'tts_started') hub.emit('tts_started', { agent, text });
    else hub.emit('tts_finished', { agent, ok });
  };

  const emitTranscript: HubView['emitTranscript'] = (text, final, confidence) => {
    hubRef.current?.emit('stt_transcript', { text, final, confidence }, { to: 'architect' });
  };

  const postAsHuman: HubView['postAsHuman'] = async (type, payload, o = {}) => {
    const http = url.replace(/^ws/, 'http');
    const res = await fetch(`${http}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, from: 'human', to: o.to ?? 'all', correlation_id: o.correlation_id, payload }),
    });
    if (!res.ok) throw new Error(`hub responded ${res.status}`);
  };

  return { status, sessionId, context, events, faceState, faceDetail, agentProcessOnline, isOnline, messages, lastSpeech, emitTts, emitTranscript, postAsHuman };
}
