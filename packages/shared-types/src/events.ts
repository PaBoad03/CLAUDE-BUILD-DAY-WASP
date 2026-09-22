/**
 * THE event contract. Everything on the bus is a WaspEvent (CONTEXT.md §13).
 *
 * UI, voice, audit and shared context all consume this same stream.
 * Adding an event type: add it to EventPayloads below (owner: Pablo/CYAN, via PR).
 */

import type { AgentId, AgentMode, AgentPresence, AgentRegistration, FaceState, Participant } from './agents';
import type { AuditEntry } from './audit';
import type { SessionState, SharedContext } from './context';
import type {
  HumanAuthorization,
  PermissionDecision,
  PermissionEvaluation,
  PermissionRequest,
} from './permissions';
import type { ResearchRequest, ResearchSummary } from './research';
import type { SandboxState, ToolDefinition, ToolRequest, ToolResult, ValidationRequest, ValidationResult } from './tools';
import type { WorkshopSpec } from './workshop';

/** Payload carried by every event type. */
export interface EventPayloads {
  // --- session / presence (hub) ---
  session_started: { session_id: string };
  session_completed: { session_id: string; final_response?: string };
  /** Hub → newly connected client: full state so it can catch up. */
  session_snapshot: { context: SharedContext; recent_events: WaspEvent[] };
  agent_registered: AgentRegistration;
  agent_started: AgentRegistration; // alias kept for CONTEXT.md naming; hub treats as register
  agent_finished: { agent: AgentId; summary?: string };
  agent_offline: { agent: AgentId; mode?: AgentMode; reason?: string };
  agent_state: { agent: AgentId; state: FaceState; detail?: string };
  context_updated: { revision: number; changed: string[]; context: SharedContext };
  hub_error: { message: string; original?: unknown };

  // --- human ↔ WASP ---
  user_message: { text: string; channel: 'voice' | 'ui' | 'cli' };
  user_authorization: HumanAuthorization;
  final_response: { text: string; workshop?: WorkshopSpec };

  // --- agent ↔ agent (the visible/audible conversation) ---
  // A UI window connects as its agent with meta.role = 'ui'. Such sockets do not count
  // for presence and must only emit tts_* events; human input goes through POST /events.
  agent_message: {
    message: string;
    /** Intent label shown in UI, e.g. "research_request". */
    intent?: string;
    /** Should the receiving PC speak it? Default true. */
    speak?: boolean;
    data?: unknown;
  };

  // --- research (MAGENTA) ---
  research_request: ResearchRequest;
  research_started: { request_id: string };
  research_result: ResearchSummary;

  // --- validation / tools / sandbox (ORANGE) ---
  validation_request: ValidationRequest;
  validation_result: ValidationResult;
  tools_registered: { tools: ToolDefinition[] };
  tool_requested: ToolRequest;
  tool_started: { tool_id: string; request_id: string; permission_id?: string };
  tool_finished: ToolResult;
  sandbox_started: SandboxState;
  sandbox_test: { request_id: string; command: string };
  sandbox_result: ToolResult;
  sandbox_state: SandboxState;

  // --- permissions (GREEN) ---
  permission_requested: PermissionRequest; // any agent → security
  permission_required: PermissionEvaluation; // security → architect (ask the human)
  permission_granted: PermissionDecision; // security → all
  permission_denied: PermissionDecision;
  permission_cancelled: PermissionDecision;
  permission_clarification_needed: { permission_id: string; human_prompt: string }; // ambiguous speech

  // --- voice (packages/voice, Andrea) ---
  speak_requested: { agent: Participant; text: string; priority?: 'normal' | 'high' };
  tts_started: { agent: Participant; text: string };
  tts_finished: { agent: Participant; ok: boolean; error?: string };
  stt_transcript: { text: string; confidence?: number; final: boolean };

  // --- workshop / decisions / task lifecycle (CYAN) ---
  workshop_updated: { workshop: WorkshopSpec; changed: string[] };
  decision_made: { decision: string; rationale?: string };
  session_state: { state: SessionState; detail?: string };

  // --- audit / diagnostics ---
  audit_event: AuditEntry;
  warning: { message: string; detail?: unknown };
  error: { message: string; detail?: unknown };
}

export type EventType = keyof EventPayloads;

export const EVENT_TYPES = [
  'session_started',
  'session_completed',
  'session_snapshot',
  'agent_registered',
  'agent_started',
  'agent_finished',
  'agent_offline',
  'agent_state',
  'context_updated',
  'hub_error',
  'user_message',
  'user_authorization',
  'final_response',
  'agent_message',
  'research_request',
  'research_started',
  'research_result',
  'validation_request',
  'validation_result',
  'tools_registered',
  'tool_requested',
  'tool_started',
  'tool_finished',
  'sandbox_started',
  'sandbox_test',
  'sandbox_result',
  'sandbox_state',
  'permission_requested',
  'permission_required',
  'permission_granted',
  'permission_denied',
  'permission_cancelled',
  'permission_clarification_needed',
  'speak_requested',
  'tts_started',
  'tts_finished',
  'stt_transcript',
  'workshop_updated',
  'decision_made',
  'session_state',
  'audit_event',
  'warning',
  'error',
] as const satisfies readonly EventType[];

/** The envelope. One shape for everything on the wire. */
export interface WaspEvent<T extends EventType = EventType> {
  id: string;
  type: T;
  session_id: string;
  from: Participant;
  /** Target agent, or 'all' for broadcast. Hub delivers everything to everyone; `to` is for UI/filtering. */
  to: Participant;
  timestamp: string;
  payload: EventPayloads[T];
  /**
   * Ties a response to its request (research_request ↔ research_result,
   * permission_requested ↔ permission_granted, ...). Use the request_id / permission_id.
   */
  correlation_id?: string;
}

export type AnyEvent = { [K in EventType]: WaspEvent<K> }[EventType];

export function isEventType(x: unknown): x is EventType {
  return typeof x === 'string' && (EVENT_TYPES as readonly string[]).includes(x);
}

export function isWaspEvent(x: unknown): x is AnyEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.id === 'string' &&
    isEventType(e.type) &&
    typeof e.from === 'string' &&
    typeof e.to === 'string' &&
    typeof e.timestamp === 'string' &&
    'payload' in e
  );
}

export type { AgentPresence };
