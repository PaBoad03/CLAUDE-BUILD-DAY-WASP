/**
 * WASP agent identities. Colors are functional identifiers (CONTEXT.md §30).
 */

export const AGENT_IDS = ['architect', 'researcher', 'operator', 'security'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/** Anything that can appear in `from` / `to` on an event. */
export type Participant = AgentId | 'hub' | 'human' | 'all';

export type AgentColor = 'cyan' | 'magenta' | 'orange' | 'green';

export interface AgentProfile {
  id: AgentId;
  color: AgentColor;
  /** Hex used consistently across face, borders, glow, event lines. */
  hex: string;
  /** Spoken/displayed name. */
  name: string;
  role: string;
  developer: string;
}

export const AGENTS: Record<AgentId, AgentProfile> = {
  architect: {
    id: 'architect',
    color: 'cyan',
    hex: '#00F0FF',
    name: 'Cyan',
    role: 'Architect / Orchestrator',
    developer: 'Pablo',
  },
  researcher: {
    id: 'researcher',
    color: 'magenta',
    hex: '#FF2BD6',
    name: 'Magenta',
    role: 'Researcher / Knowledge',
    developer: 'Andrea',
  },
  operator: {
    id: 'operator',
    color: 'orange',
    hex: '#FF7A00',
    name: 'Orange',
    role: 'Operator / Sandbox',
    developer: 'Felipe',
  },
  security: {
    id: 'security',
    color: 'green',
    hex: '#39FF14',
    name: 'Green',
    role: 'Security / Auditor',
    developer: 'Juanda',
  },
};

/**
 * How an agent is connected. `stub` means a fake responder from apps/hub/src/stubs.ts:
 * its results are NOT real and must never be reported as such.
 */
export type AgentMode = 'real' | 'stub';

export type ConnectionStatus = 'online' | 'offline';

export interface AgentRegistration {
  agent: AgentId;
  mode: AgentMode;
  /** Free-form: hostname, version, capabilities. */
  meta?: Record<string, unknown>;
}

export interface AgentPresence extends AgentRegistration {
  status: ConnectionStatus;
  connected_at?: string;
  disconnected_at?: string;
}

/**
 * Face/UI states. Superset of every agent's list so one shared face component works for all.
 * Each agent uses the subset that makes sense for it.
 */
export type FaceState =
  | 'IDLE'
  | 'LISTENING'
  | 'THINKING'
  | 'RESEARCHING'
  | 'ANALYZING'
  | 'PREPARING'
  | 'COMMUNICATING'
  | 'SENDING'
  | 'MONITORING'
  | 'REVIEWING'
  | 'WAITING_FOR_PERMISSION'
  | 'PERMISSION_REQUIRED'
  | 'AUTHORIZED'
  | 'DENIED'
  | 'BLOCKED'
  | 'EXECUTING'
  | 'SUCCESS'
  | 'COMPLETE'
  | 'WARNING'
  | 'ERROR'
  | 'OFFLINE';
