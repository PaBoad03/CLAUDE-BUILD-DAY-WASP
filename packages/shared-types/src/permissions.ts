/**
 * Permission model. Engine owned by Juanda/GREEN (packages/permissions, apps/security).
 * These are the wire shapes every agent agrees on.
 *
 * THE MODEL PROPOSES. THE APPLICATION AUTHORIZES. THE TOOL EXECUTES. (CONTEXT.md §9)
 */

import type { AgentId } from './agents';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PermissionStatus =
  | 'PENDING' // requested, GREEN has not evaluated yet
  | 'AUTO_APPROVED' // GREEN decided no human approval needed (LOW risk)
  | 'AWAITING_HUMAN' // GREEN says a human must decide
  | 'GRANTED'
  | 'DENIED'
  | 'CANCELLED' // human said STOP / CANCEL
  | 'EXPIRED' // nobody answered in time
  | 'BLOCKED'; // policy forbids it regardless of human input (CRITICAL: host shell, destructive...)

/** Sent by any agent that wants to do something risky. */
export interface PermissionRequest {
  /** Unique per request; every later event about it carries the same id. */
  permission_id: string;
  requested_by: AgentId;
  /** Tool/operation id from the tool registry, e.g. "docker_sandbox", "sandbox_network". */
  operation: string;
  /** Human-readable reason, will be spoken to the human. */
  reason: string;
  /** Requester's own risk estimate. GREEN may override. */
  proposed_risk?: RiskLevel;
  input?: Record<string, unknown>;
}

/** GREEN's evaluation of a request. */
export interface PermissionEvaluation {
  permission_id: string;
  operation: string;
  risk: RiskLevel;
  approval_required: boolean;
  /** Text CYAN should say to the human when asking. */
  human_prompt: string;
  rationale?: string;
}

/** What the human actually said, as interpreted by the voice/UI layer. */
export type HumanDecision = 'YES' | 'NO' | 'STOP' | 'AMBIGUOUS';

export interface HumanAuthorization {
  permission_id: string;
  decision: HumanDecision;
  /** Raw transcript or UI action, for audit. */
  raw: string;
  /** 'voice' | 'ui' | 'cli' */
  channel: string;
}

/** Final, recorded decision. Only GREEN emits this. */
export interface PermissionDecision {
  permission_id: string;
  operation: string;
  requested_by: AgentId;
  status: PermissionStatus;
  risk: RiskLevel;
  approval_required: boolean;
  decided_by: 'security' | 'human';
  human_raw?: string;
  /** Why GREEN decided this way (policy matched, escalation, timeout, blocked...). */
  rationale?: string;
  decided_at: string;
}

/** Full record kept in shared context. */
export interface PermissionRecord extends PermissionRequest {
  status: PermissionStatus;
  risk?: RiskLevel;
  approval_required?: boolean;
  human_prompt?: string;
  decided_by?: 'security' | 'human';
  human_raw?: string;
  rationale?: string;
  requested_at: string;
  decided_at?: string;
}
