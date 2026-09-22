/**
 * GREEN-internal types. Everything on the wire uses @wasp/shared-types
 * (PermissionRequest, PermissionEvaluation, PermissionDecision, HumanAuthorization, RiskLevel).
 * These extend / complement them; they never redefine the shared shapes.
 */

import type { AgentId, PermissionRecord, RiskLevel } from '@wasp/shared-types';

export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Tool policy entry. The registry is data, not prompt. */
export interface ToolPolicy {
  /** operation / tool id, e.g. "docker_sandbox", "sandbox_ping" */
  tool: string;
  risk_level: RiskLevel;
  requires_approval: boolean;
  /** if true, the tool is never allowed (CRITICAL destructive / host shell) — not even with a human "yes" */
  blocked?: boolean;
  description: string;
  /** which agents may request it; undefined = any agent */
  allowed_agents?: AgentId[];
}

/** Result of GREEN's risk evaluation of a PermissionRequest. Pure data, no side effects. */
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

/** GREEN's view of a permission: the shared record plus its evaluation. */
export interface SecurityRecord extends PermissionRecord {
  evaluation: SecurityEvaluation;
}

/** GREEN face states (INSTRUCCIONESJUANDA.md). Subset of the shared FaceState. */
export type SecurityState = 'IDLE' | 'MONITORING' | 'REVIEWING' | 'PERMISSION_REQUIRED' | 'AUTHORIZED' | 'DENIED' | 'BLOCKED' | 'WARNING' | 'OFFLINE';
