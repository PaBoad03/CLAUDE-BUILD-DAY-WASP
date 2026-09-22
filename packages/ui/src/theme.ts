import { AGENTS, type AgentId } from '@wasp/shared-types';

/** CSS class that sets --agent and the background tint for a PC (see styles.css). */
export const THEME_CLASS: Record<AgentId, string> = {
  architect: 'theme-cyan',
  researcher: 'theme-magenta',
  operator: 'theme-orange',
  security: 'theme-green',
};

export function agentTheme(agent: AgentId): { hex: string; className: string; name: string; label: string } {
  const p = AGENTS[agent];
  return { hex: p.hex, className: THEME_CLASS[agent], name: p.name.toUpperCase(), label: `${p.name.toUpperCase()} · ${p.role.toUpperCase()}` };
}
