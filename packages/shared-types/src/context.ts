/**
 * Shared context — the single source of truth, held by the WASP HUB (CONTEXT.md §6).
 * An agent must NEVER treat its local memory as authoritative.
 */

import type { AgentId, AgentPresence, FaceState } from './agents';
import type { AuditEntry } from './audit';
import type { PermissionRecord } from './permissions';
import type { ResearchResult } from './research';
import type { SandboxState, ToolDefinition } from './tools';
import type { WorkshopSpec } from './workshop';

export type SessionState =
  | 'IDLE'
  | 'RECEIVED_REQUEST'
  | 'PLANNING'
  | 'RESEARCHING'
  | 'VALIDATING'
  | 'WAITING_FOR_PERMISSION'
  | 'EXECUTING'
  | 'SYNTHESIZING'
  | 'COMPLETED'
  | 'FAILED';

export interface AgentMessageRecord {
  id: string;
  from: string;
  to: string;
  /** Short intent label: research_request, validation_request, permission_required, ... */
  type: string;
  message: string;
  timestamp: string;
  /** Whether it was/should be spoken aloud. */
  spoken: boolean;
}

export interface Decision {
  id: string;
  timestamp: string;
  agent: AgentId;
  decision: string;
  rationale?: string;
}

export interface SharedContext {
  session_id: string;
  started_at: string;
  user_request: string;
  current_task: string;
  current_state: SessionState;

  workshop: WorkshopSpec;
  research: ResearchResult[];
  tools: ToolDefinition[];
  permissions: PermissionRecord[];
  sandbox: SandboxState;
  agent_messages: AgentMessageRecord[];
  decisions: Decision[];
  audit: AuditEntry[];

  agents: Record<AgentId, AgentPresence>;
  agent_states: Record<AgentId, FaceState>;

  /** Final answer WASP gives the human, once produced. */
  final_response?: string;
  /** Monotonic counter, bumped by the hub on every change. */
  revision: number;
}
