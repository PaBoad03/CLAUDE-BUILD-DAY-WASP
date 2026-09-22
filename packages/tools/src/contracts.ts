/**
 * WASP shared contracts — LOCAL MIRROR.
 *
 * These types belong in `packages/shared-types` (owner: Pablo / CYAN).
 * They are mirrored here so ORANGE can build without blocking on the hub.
 * When shared-types lands, delete this file and import from there; the
 * shapes follow CONTEXT.md §6, §13 and §19 so the swap should be mechanical.
 */

export type AgentId =
  | 'architect'
  | 'researcher'
  | 'operator'
  | 'security'
  | 'hub'
  | 'human';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** CONTEXT.md §13 plus the two request/response pairs ORANGE needs. */
export type EventType =
  | 'session_started'
  | 'user_message'
  | 'agent_started'
  | 'agent_message'
  | 'agent_finished'
  | 'research_started'
  | 'research_result'
  | 'tool_requested'
  | 'permission_requested'
  | 'permission_granted'
  | 'permission_denied'
  | 'tool_started'
  | 'tool_finished'
  | 'sandbox_started'
  | 'sandbox_test'
  | 'sandbox_result'
  | 'validation_request'
  | 'validation_result'
  | 'audit_event'
  | 'agent_state'
  | 'warning'
  | 'error'
  | 'session_completed';

export interface WaspEvent<T = unknown> {
  event_id: string;
  session_id: string;
  timestamp: string;
  type: EventType;
  from: AgentId;
  to: AgentId | 'broadcast';
  payload: T;
}

/** Sent to ORANGE by CYAN/MAGENTA as `tool_requested` or `validation_request`. */
export interface ToolRequest {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  requested_by: AgentId;
}

/** Sent by ORANGE to GREEN as `permission_requested`. */
export interface PermissionRequest {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  requires_approval: boolean;
  reason: string;
  requested_by: AgentId;
  /** Human-readable line for TTS / UI, e.g. "Create isolated sandbox". */
  summary: string;
}

/** Sent by GREEN to ORANGE as `permission_granted` / `permission_denied`. */
export interface PermissionDecision {
  request_id: string;
  granted: boolean;
  decided_by: 'human' | 'policy';
  reason?: string;
  /** Verbatim human utterance when decided_by === 'human' (for audit). */
  user_authorization?: string;
}

export type ToolStatus =
  | 'success'      // ran, and the test passed
  | 'failure'      // ran, and the test failed (e.g. 100% packet loss)
  | 'error'        // could not run to completion (timeout, docker error)
  | 'unavailable'  // capability missing (Docker offline, sandbox not created)
  | 'denied'       // GREEN/human said no
  | 'rejected';    // never reached execution: unknown tool / bad args / no approval

export interface ToolResult {
  request_id: string;
  tool: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  started_at: string;
  finished_at: string;
  /** Exact argv executed, or [] when nothing ran. Never fabricated. */
  command: string[];
  exit_code: number | null;
  stdout: string;
  stderr: string;
  /** One line suitable for TTS and the RESULT window. */
  summary: string;
  /** Parsed, tool-specific facts (packet loss, http code, ...). */
  data: Record<string, unknown>;
}

/** CONTEXT.md §19. */
export interface AuditRecord {
  timestamp: string;
  agent: AgentId;
  action: string;
  tool: string;
  reason: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  status: ToolStatus;
  risk_level: RiskLevel;
  approval_required: boolean;
  approval_status: 'not_required' | 'pending' | 'granted' | 'denied' | 'timeout';
  user_authorization?: string;
}

export interface SandboxState {
  docker_available: boolean;
  docker_version?: string;
  container: 'absent' | 'running' | 'stopped' | 'unknown';
  network: 'none' | 'internal' | 'external';
  target_available: boolean;
  last_error?: string;
  updated_at: string;
}

/** ORANGE face states (INSTRUCCIONESFELIPE.md). */
export type OperatorFaceState =
  | 'IDLE'
  | 'LISTENING'
  | 'PREPARING'
  | 'WAITING_FOR_PERMISSION'
  | 'EXECUTING'
  | 'SUCCESS'
  | 'ERROR'
  | 'OFFLINE';
