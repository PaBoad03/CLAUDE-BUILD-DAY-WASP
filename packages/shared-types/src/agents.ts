/**
 * WASP agent identities.
 *
 * These ids are used in every event, message, permission and audit entry.
 * Colors are functional identifiers (see CONTEXT.md §30).
 */
export type AgentId = 'architect' | 'researcher' | 'operator' | 'security';

/** Who can originate an event. `human` = the person in the loop, `system` = hub/infra. */
export type Actor = AgentId | 'human' | 'system';

export type AgentColor = 'cyan' | 'magenta' | 'orange' | 'green';

export const AGENTS: Record<AgentId, { color: AgentColor; label: string; developer: string }> = {
  architect: { color: 'cyan', label: 'CYAN / ARCHITECT', developer: 'Pablo' },
  researcher: { color: 'magenta', label: 'MAGENTA / RESEARCHER', developer: 'Andrea' },
  operator: { color: 'orange', label: 'ORANGE / OPERATOR', developer: 'Felipe' },
  security: { color: 'green', label: 'GREEN / SECURITY', developer: 'Juanda' },
};

export const AGENT_IDS: readonly AgentId[] = ['architect', 'researcher', 'operator', 'security'];

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}
