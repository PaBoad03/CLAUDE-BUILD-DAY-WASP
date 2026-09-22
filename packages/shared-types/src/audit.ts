/**
 * Audit entry (CONTEXT.md §19). Must answer WHO / WHAT / WHY / WHEN / WITH WHICH TOOL /
 * WAS AUTHORIZATION REQUIRED / WAS IT GRANTED / WHAT ACTUALLY HAPPENED.
 * Recorded by Juanda/GREEN, but ANY agent may emit `audit_event`.
 */

import type { Participant } from './agents';
import type { RiskLevel, PermissionStatus } from './permissions';

export interface AuditEntry {
  id: string;
  timestamp: string;
  agent: Participant;
  action: string;
  tool?: string;
  reason?: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: 'success' | 'failure' | 'denied' | 'cancelled' | 'unavailable' | 'info';
  risk_level?: RiskLevel;
  approval_required: boolean;
  approval_status?: PermissionStatus;
  user_authorization?: string;
  /** Link back to the event/permission/tool request that caused this. */
  correlation_id?: string;
  stub?: boolean;
}
