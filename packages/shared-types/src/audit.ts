import type { Actor } from './agents.ts';
import type { PermissionStatus, RiskLevel } from './permissions.ts';

/** Status of an audited action. */
export type AuditStatus =
  | 'requested'
  | 'evaluated'
  | 'pending_approval'
  | 'granted'
  | 'denied'
  | 'cancelled'
  | 'blocked'
  | 'started'
  | 'success'
  | 'failure'
  | 'unavailable'
  | 'warning'
  | 'info';

/**
 * One audit entry (CONTEXT.md §19). Must be able to answer:
 * WHO, WHAT, WHY, WHEN, WITH WHICH TOOL, WITH WHAT INPUT,
 * WAS AUTHORIZATION REQUIRED, WAS IT GRANTED, WHAT ACTUALLY HAPPENED.
 */
export interface AuditEntry {
  audit_id: string;
  session_id: string;
  timestamp: string;
  /** WHO */
  agent: Actor;
  /** WHAT */
  action: string;
  /** WITH WHICH TOOL (empty string when no tool involved) */
  tool: string;
  /** WHY */
  reason: string;
  /** WITH WHAT INPUT */
  input: Record<string, unknown>;
  /** WHAT ACTUALLY HAPPENED */
  result: Record<string, unknown>;
  status: AuditStatus;
  risk_level: RiskLevel | 'NONE';
  approval_required: boolean;
  approval_status: PermissionStatus | 'N/A';
  /** verbatim human answer that authorized/denied, if any */
  user_authorization?: string;
  /** links to the permission / tool request that this entry belongs to */
  request_id?: string;
  permission_id?: string;
  /** id of the event that produced this entry, if any */
  source_event_id?: string;
}
