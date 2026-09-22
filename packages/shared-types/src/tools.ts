/**
 * Tool registry + execution contract. Implementation owned by Felipe/ORANGE.
 * Claude never gets a shell. Claude requests a registered tool; the app authorizes; the tool runs.
 */

import type { AgentId } from './agents';
import type { RiskLevel } from './permissions';

export interface ToolDefinition {
  id: string; // e.g. "sandbox_ping"
  description: string;
  owner: AgentId;
  risk: RiskLevel;
  requires_approval: boolean;
  /** JSON Schema for the input. Also usable as a Claude tool definition. */
  input_schema: Record<string, unknown>;
  /** Whether the tool is currently usable on the owner's machine (e.g. Docker present). */
  available: boolean;
  unavailable_reason?: string;
}

export interface ToolRequest {
  tool_id: string;
  request_id: string;
  requested_by: AgentId;
  input: Record<string, unknown>;
  /** Set once GREEN has granted (or auto-approved) the operation. */
  permission_id?: string;
}

export type ToolStatus = 'success' | 'failure' | 'unavailable' | 'denied' | 'timeout';

export interface ToolResult {
  tool_id: string;
  request_id: string;
  status: ToolStatus;
  /** Raw, real output (stdout, parsed JSON, ...). Never model-generated. */
  output?: unknown;
  error?: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  stub?: boolean;
}

export interface SandboxState {
  available: boolean; // Docker reachable on the operator machine
  status: 'OFFLINE' | 'STARTING' | 'RUNNING' | 'STOPPED' | 'ERROR';
  image?: string;
  container_id?: string;
  network: 'NONE' | 'CONTROLLED' | 'EXTERNAL';
  last_test?: ToolResult;
  message?: string;
}

/** CYAN → ORANGE: "can this exercise actually run in our lab?" */
export interface ValidationRequest {
  request_id: string;
  /** What to validate, in plain language. */
  description: string;
  /** Tool ids ORANGE is expected to use, if known. */
  tools?: string[];
}

export interface ValidationResult {
  request_id: string;
  /** true ONLY if a real test succeeded. */
  validated: boolean;
  tests: ToolResult[];
  summary: string;
  stub?: boolean;
}
