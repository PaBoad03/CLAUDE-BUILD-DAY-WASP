import type { AgentMessagePayload } from './events.ts';
import type { AuditEntry } from './audit.ts';
import type { PermissionRecord } from './permissions.ts';

/** Research result (owned by MAGENTA, shape from INSTRUCCIONESANDREA.md). */
export type VerificationStatus = 'FOUND' | 'VERIFIED' | 'CONTRADICTED' | 'UNKNOWN';

export interface ResearchResult {
  source: string;
  title: string;
  claim: string;
  procedure: string;
  verification_status: VerificationStatus;
  evidence: string;
  confidence: 'low' | 'medium' | 'high' | string;
}

/** Workshop spec (owned by CYAN, shape from CONTEXT.md §18). */
export interface WorkshopSpec {
  title: string;
  level: string;
  duration_minutes: number;
  objectives: string[];
  agenda: string[];
  concepts: string[];
  challenges: string[];
  tools: string[];
  prerequisites: string[];
  network_dependencies: string[];
  risks: string[];
  fallbacks: string[];
  research: ResearchResult[];
  lab: {
    description: string;
    /** MUST stay false until a real sandbox validation succeeded (see @wasp/audit canMarkValidated) */
    validated: boolean;
  };
}

/** Sandbox state (owned by ORANGE). */
export interface SandboxState {
  available: boolean;
  status: 'OFFLINE' | 'STARTING' | 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNKNOWN';
  image?: string;
  network: 'NONE' | 'CONTROLLED' | 'EXTERNAL' | 'UNKNOWN';
  last_error?: string;
}

/** Tool availability as reported by ORANGE. */
export interface ToolAvailability {
  tool: string;
  available: boolean;
  detail?: string;
}

export interface AgentMessageRecord extends AgentMessagePayload {
  event_id: string;
  timestamp: string;
}

export interface Decision {
  timestamp: string;
  agent: string;
  decision: string;
  rationale: string;
}

/**
 * The shared context (CONTEXT.md §6). The HUB is authoritative.
 * Each agent reads it and writes only to its own sections through events.
 *
 *   architect  -> user_request, current_task, workshop, decisions, current_state
 *   researcher -> research
 *   operator   -> tools, sandbox
 *   security   -> permissions, audit
 *   everyone   -> agent_messages (via agent_message events)
 */
export interface SharedContext {
  session_id: string;
  user_request: string;
  current_task: string;
  workshop: Partial<WorkshopSpec>;
  research: ResearchResult[];
  tools: ToolAvailability[];
  permissions: PermissionRecord[];
  sandbox: SandboxState;
  agent_messages: AgentMessageRecord[];
  decisions: Decision[];
  audit: AuditEntry[];
  current_state: string;
}

export function createEmptyContext(session_id: string): SharedContext {
  return {
    session_id,
    user_request: '',
    current_task: '',
    workshop: {},
    research: [],
    tools: [],
    permissions: [],
    sandbox: { available: false, status: 'UNKNOWN', network: 'UNKNOWN' },
    agent_messages: [],
    decisions: [],
    audit: [],
    current_state: 'IDLE',
  };
}
