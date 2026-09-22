import type { AgentId } from './agents.ts';

/** Risk classification (CONTEXT.md §10, INSTRUCCIONESJUANDA.md "PERMISSION MODEL"). */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Lifecycle of a permission.
 *
 *  NOT_REQUIRED  policy says the tool may run without a human (LOW risk).
 *  PENDING       waiting for the human.
 *  GRANTED       human said yes (or policy auto-granted a NOT_REQUIRED tool).
 *  DENIED        human said no.
 *  CANCELLED     human said stop / cancel.
 *  EXPIRED       nobody answered in time.
 *  BLOCKED       policy forbids the operation regardless of human input (CRITICAL).
 */
export type PermissionStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'GRANTED'
  | 'DENIED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'BLOCKED';

/** Where a decision came from. Only `human` decisions can grant a PENDING permission. */
export type DecisionSource = 'voice' | 'ui' | 'policy' | 'timeout' | 'system';

/**
 * What an agent sends when it wants to run a tool.
 * ORANGE / MAGENTA / CYAN produce this. GREEN evaluates it.
 */
export interface ToolRequest {
  request_id: string;
  session_id: string;
  /** agent asking for the tool */
  agent: AgentId;
  /** tool registry key, e.g. "docker_sandbox", "sandbox_ping", "web_research" */
  tool: string;
  /** human readable operation, e.g. "create_sandbox", "ping 127.0.0.1" */
  operation: string;
  /** structured input the tool will receive */
  input: Record<string, unknown>;
  /** why the agent wants to do this (goes to audit + spoken to the human) */
  reason: string;
  timestamp: string;
}

/** Result of GREEN's risk evaluation of a ToolRequest. Pure data, no side effects. */
export interface SecurityEvaluation {
  risk_level: RiskLevel;
  approval_required: boolean;
  /** false => BLOCKED, the tool must never run even with a human "yes" */
  allowed: boolean;
  rationale: string;
  blocked_reason?: string;
  /** policy key that matched, or "default" when the tool is unknown */
  matched_policy: string;
}

/** Central permission record. Lives in shared context `permissions[]`. */
export interface PermissionRecord {
  permission_id: string;
  request_id: string;
  session_id: string;
  agent: AgentId;
  tool: string;
  operation: string;
  input: Record<string, unknown>;
  reason: string;
  risk_level: RiskLevel;
  approval_required: boolean;
  status: PermissionStatus;
  requested_at: string;
  decided_at?: string;
  decided_by?: 'human' | 'policy' | 'system';
  decision_source?: DecisionSource;
  /** verbatim transcript / button label that produced the decision */
  decision_transcript?: string;
  /** text the human should hear when asked */
  prompt_for_human: string;
}

/** Tool policy entry. The registry is data, not prompt. */
export interface ToolPolicy {
  tool: string;
  risk_level: RiskLevel;
  requires_approval: boolean;
  /** if true, the tool is never allowed (CRITICAL destructive / host shell) */
  blocked?: boolean;
  description: string;
  /** which agents may request it; undefined = any agent */
  allowed_agents?: AgentId[];
}

/** Outcome of interpreting a human utterance as an authorization answer. */
export type VoiceDecision = 'AUTHORIZED' | 'DENIED' | 'CANCELLED' | 'AMBIGUOUS';
