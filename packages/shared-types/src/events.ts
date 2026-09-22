import type { Actor, AgentId } from './agents.ts';
import type { AuditEntry } from './audit.ts';
import type {
  PermissionRecord,
  RiskLevel,
  SecurityEvaluation,
  ToolRequest,
  VoiceDecision,
} from './permissions.ts';

/**
 * Event types on the shared WASP event bus (CONTEXT.md §13) plus the
 * security-specific events GREEN emits.
 *
 * Everything the UI shows, the voice layer speaks, the audit records and the
 * shared context stores flows through these.
 */
export type WaspEventType =
  // session
  | 'session_started'
  | 'session_completed'
  | 'user_message'
  // agents
  | 'agent_started'
  | 'agent_message'
  | 'agent_finished'
  | 'agent_state_changed'
  | 'agent_offline'
  // research (MAGENTA)
  | 'research_started'
  | 'research_result'
  // tools / sandbox (ORANGE)
  | 'tool_requested'
  | 'tool_started'
  | 'tool_finished'
  | 'tool_blocked'
  | 'sandbox_started'
  | 'sandbox_test'
  | 'sandbox_result'
  // permissions (GREEN)
  | 'security_evaluated'
  | 'permission_requested'
  | 'permission_granted'
  | 'permission_denied'
  | 'permission_cancelled'
  | 'permission_expired'
  | 'permission_clarification_needed'
  // audit / misc
  | 'audit_event'
  | 'warning'
  | 'error';

/** Envelope for every event on the bus. */
export interface WaspEvent<T extends WaspEventType = WaspEventType, P = unknown> {
  event_id: string;
  type: T;
  session_id: string;
  /** who emitted the event */
  source: Actor;
  timestamp: string;
  payload: P;
}

// ---------- payloads ----------

export interface UserMessagePayload {
  text: string;
  /** 'voice' when it came through STT, 'ui' when typed/clicked */
  channel: 'voice' | 'ui';
  /** set by the voice layer / UI when the human is answering a specific permission */
  in_reply_to_permission_id?: string;
  /** STT confidence 0..1 if available */
  confidence?: number;
}

export interface AgentMessagePayload {
  from: AgentId;
  to: AgentId | 'human' | 'all';
  /** short text that will be shown and spoken */
  message: string;
  /** optional structured type, e.g. "research_request", "validation_request" */
  kind?: string;
  /** if true the voice layer should speak it */
  speak: boolean;
}

export interface AgentStateChangedPayload {
  agent: AgentId;
  /** agent-specific state string (e.g. GREEN: IDLE|MONITORING|REVIEWING|PERMISSION_REQUIRED|AUTHORIZED|DENIED|BLOCKED|WARNING) */
  state: string;
  detail?: string;
}

export type ToolRequestedPayload = ToolRequest;

export interface SecurityEvaluatedPayload {
  request_id: string;
  permission_id: string;
  evaluation: SecurityEvaluation;
}

export interface PermissionEventPayload {
  permission: PermissionRecord;
}

export interface PermissionClarificationPayload {
  permission: PermissionRecord;
  heard: string;
  decision: VoiceDecision;
  /** what WASP should say to re-ask */
  reprompt: string;
}

export interface ToolBlockedPayload {
  request: ToolRequest;
  risk_level: RiskLevel;
  reason: string;
}

export interface ToolStartedPayload {
  request_id: string;
  permission_id?: string;
  tool: string;
  operation: string;
  input: Record<string, unknown>;
}

export interface ToolFinishedPayload {
  request_id: string;
  permission_id?: string;
  tool: string;
  operation: string;
  status: 'success' | 'failure' | 'unavailable';
  /** raw, real output. never fabricated. */
  output: Record<string, unknown>;
  error?: string;
}

export interface AuditEventPayload {
  entry: AuditEntry;
}

export interface WarningPayload {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface ErrorPayload {
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

/** Map of event type -> payload type for the events GREEN produces or consumes. */
export interface WaspEventPayloads {
  user_message: UserMessagePayload;
  agent_message: AgentMessagePayload;
  agent_state_changed: AgentStateChangedPayload;
  tool_requested: ToolRequestedPayload;
  tool_started: ToolStartedPayload;
  tool_finished: ToolFinishedPayload;
  tool_blocked: ToolBlockedPayload;
  security_evaluated: SecurityEvaluatedPayload;
  permission_requested: PermissionEventPayload;
  permission_granted: PermissionEventPayload;
  permission_denied: PermissionEventPayload;
  permission_cancelled: PermissionEventPayload;
  permission_expired: PermissionEventPayload;
  permission_clarification_needed: PermissionClarificationPayload;
  audit_event: AuditEventPayload;
  warning: WarningPayload;
  error: ErrorPayload;
}

export type TypedEvent<T extends keyof WaspEventPayloads> = WaspEvent<T, WaspEventPayloads[T]>;

export type EventHandler<E extends WaspEvent = WaspEvent> = (event: E) => void | Promise<void>;
export type Unsubscribe = () => void;

/**
 * The event bus interface every agent codes against.
 * CYAN (Pablo) owns the real implementation in the hub (WebSocket/in-process).
 * Agents must NOT create their own bus; they receive one.
 */
export interface EventBus {
  publish(event: WaspEvent): void | Promise<void>;
  subscribe<T extends WaspEventType>(
    type: T | '*',
    handler: EventHandler<WaspEvent<T>>,
  ): Unsubscribe;
}
