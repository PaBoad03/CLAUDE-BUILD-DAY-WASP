import type { PermissionRequest, RiskLevel, ToolDefinition } from '@wasp/shared-types';
import { RISK_ORDER, type SecurityEvaluation, type ToolPolicy } from './types';

/**
 * Tool policy registry. THIS IS DATA, NOT PROMPT.
 *
 * The model can ask for any operation it wants; this table decides the risk.
 * Unknown tools fall back to DEFAULT_POLICY (HIGH, approval required) so the
 * system fails closed.
 *
 * Tool ids match ORANGE's registry (schemas/tools.json). When ORANGE connects it
 * emits `tools_registered`; GREEN merges those definitions with
 * registerFromToolDefinitions(): it may ESCALATE a risk it already knows, never lower it.
 */
export const DEFAULT_TOOL_POLICIES: ToolPolicy[] = [
  // ---- LOW: read-only, local, informational
  { tool: 'web_research', risk_level: 'LOW', requires_approval: false, description: 'Web search / documentation lookup (MAGENTA)' },
  { tool: 'web_fetch', risk_level: 'LOW', requires_approval: false, description: 'Retrieve a public web page as untrusted data (MAGENTA)' },
  { tool: 'filesystem_read', risk_level: 'LOW', requires_approval: false, description: 'Read a file inside the project workspace' },
  { tool: 'sandbox_status', risk_level: 'LOW', requires_approval: false, description: 'Check whether Docker is available (no side effects)' },
  { tool: 'sandbox_ping', risk_level: 'LOW', requires_approval: false, description: 'ping an allowlisted target inside the sandbox' },
  { tool: 'sandbox_dns', risk_level: 'LOW', requires_approval: false, description: 'DNS resolution of allowlisted names inside the sandbox' },
  { tool: 'sandbox_interfaces', risk_level: 'LOW', requires_approval: false, description: 'Inspect network interfaces inside the sandbox' },
  { tool: 'sandbox_routes', risk_level: 'LOW', requires_approval: false, description: 'Inspect routing table inside the sandbox' },
  { tool: 'sandbox_http', risk_level: 'LOW', requires_approval: false, description: 'HTTP request to the local lab target from the sandbox' },
  { tool: 'sandbox_destroy', risk_level: 'LOW', requires_approval: false, description: 'Remove the sandbox container (lab only)', allowed_agents: ['operator'] },

  // ---- MEDIUM: creates isolated resources / controlled local network
  { tool: 'docker_sandbox', risk_level: 'MEDIUM', requires_approval: true, description: 'Create / start the isolated Linux sandbox container', allowed_agents: ['operator'] },
  { tool: 'sandbox_network', risk_level: 'MEDIUM', requires_approval: true, description: 'Enable controlled (local-only) network for the sandbox', allowed_agents: ['operator'] },
  { tool: 'sandbox_port_check', risk_level: 'MEDIUM', requires_approval: true, description: 'Controlled local port/service inspection from the sandbox', allowed_agents: ['operator'] },
  { tool: 'filesystem_write', risk_level: 'MEDIUM', requires_approval: true, description: 'Write a file inside the project workspace' },

  // ---- HIGH: leaves the sandbox / touches external systems
  { tool: 'sandbox_network_external', risk_level: 'HIGH', requires_approval: true, description: 'Give the sandbox Internet access', allowed_agents: ['operator'] },
  { tool: 'sandbox_http_external', risk_level: 'HIGH', requires_approval: true, description: 'HTTP request to an external host from the sandbox', allowed_agents: ['operator'] },

  // ---- CRITICAL: never allowed, even with a human "yes"
  { tool: 'host_shell', risk_level: 'CRITICAL', requires_approval: true, blocked: true, description: 'Arbitrary command on the host (Windows) machine' },
  { tool: 'external_scan', risk_level: 'CRITICAL', requires_approval: true, blocked: true, description: 'Scanning of hosts outside the sandbox / lab' },
  { tool: 'destructive', risk_level: 'CRITICAL', requires_approval: true, blocked: true, description: 'Destructive or irreversible operations' },
];

/** Applied when the tool name is not in the registry: fail closed. */
export const DEFAULT_POLICY: ToolPolicy = {
  tool: 'default',
  risk_level: 'HIGH',
  requires_approval: true,
  description: 'Unknown tool. Fail closed: requires human approval.',
};

/**
 * Input patterns that escalate risk regardless of the declared tool.
 * A LOW tool with `network_access: "external"` in its input is not LOW.
 */
interface Escalation {
  name: string;
  test: (req: PermissionRequest) => boolean;
  min_risk: RiskLevel;
  block?: boolean;
  reason: string;
}

const HOST_SHELL_MARKERS = /(^|[\s;&|])(powershell|cmd(\.exe)?|bash|sh|wsl|rm\s+-rf|del\s+\/|format\s|mkfs|dd\s+if=|shutdown|reboot)(\s|$)/i;
const PRIVATE_OR_LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[a-z0-9-]+(\.(local|lab|internal|test))?|wasp-[a-z0-9-]+)$/i;

const ESCALATIONS: Escalation[] = [
  {
    name: 'external_network_flag',
    test: (r) => str(r.input?.['network_access']) === 'external' || r.input?.['external'] === true || str(r.input?.['network']) === 'EXTERNAL',
    min_risk: 'HIGH',
    reason: 'input requests external network access',
  },
  {
    name: 'non_local_target',
    test: (r) => {
      const target = str(r.input?.['target']) ?? str(r.input?.['host']) ?? str(r.input?.['url']) ?? str(r.input?.['name']);
      if (!target) return false;
      const host = hostOf(target);
      return host !== null && !PRIVATE_OR_LOCAL.test(host);
    },
    min_risk: 'HIGH',
    reason: 'target is outside the local / lab network',
  },
  {
    name: 'host_shell_marker',
    test: (r) => {
      const cmd = str(r.input?.['command']) ?? str(r.input?.['cmd']) ?? '';
      return HOST_SHELL_MARKERS.test(cmd) || r.input?.['on_host'] === true;
    },
    min_risk: 'CRITICAL',
    block: true,
    reason: 'input looks like a host shell / destructive command',
  },
];

export class ToolPolicyRegistry {
  private readonly policies = new Map<string, ToolPolicy>();

  constructor(policies: ToolPolicy[] = DEFAULT_TOOL_POLICIES) {
    for (const p of policies) this.policies.set(p.tool, p);
  }

  registerPolicy(policy: ToolPolicy): void {
    this.policies.set(policy.tool, policy);
  }

  /**
   * Merge ORANGE's `tools_registered` definitions. Unknown tools are added with the declared risk;
   * known tools keep GREEN's risk if it is higher (GREEN may escalate, never lower).
   */
  registerFromToolDefinitions(tools: ToolDefinition[]): void {
    for (const t of tools) {
      const mine = this.policies.get(t.id);
      if (!mine) {
        this.policies.set(t.id, { tool: t.id, risk_level: t.risk, requires_approval: t.requires_approval || t.risk !== 'LOW', description: t.description, allowed_agents: [t.owner] });
        continue;
      }
      if (mine.blocked) continue;
      const risk = RISK_ORDER[t.risk] > RISK_ORDER[mine.risk_level] ? t.risk : mine.risk_level;
      this.policies.set(t.id, { ...mine, risk_level: risk, requires_approval: mine.requires_approval || t.requires_approval || risk !== 'LOW' });
    }
  }

  get(tool: string): ToolPolicy | undefined {
    return this.policies.get(tool);
  }

  list(): ToolPolicy[] {
    return [...this.policies.values()];
  }

  /** Pure function: request in, evaluation out. No events, no state. */
  evaluate(request: PermissionRequest): SecurityEvaluation {
    const policy = this.policies.get(request.operation) ?? DEFAULT_POLICY;
    let risk: RiskLevel = policy.risk_level;
    let approval = policy.requires_approval;
    let blocked = policy.blocked === true;
    const notes: string[] = [];

    if (policy === DEFAULT_POLICY) notes.push(`operation "${request.operation}" is not in the registry`);
    else notes.push(policy.description);

    if (policy.allowed_agents && !policy.allowed_agents.includes(request.requested_by)) {
      blocked = true;
      risk = 'CRITICAL';
      notes.push(`agent "${request.requested_by}" is not allowed to request "${request.operation}"`);
    }

    // The requester's own estimate can only raise the risk, never lower it.
    if (request.proposed_risk && RISK_ORDER[request.proposed_risk] > RISK_ORDER[risk]) {
      risk = request.proposed_risk;
      notes.push(`requester proposed ${request.proposed_risk}`);
    }

    for (const esc of ESCALATIONS) {
      let hit = false;
      try {
        hit = esc.test(request);
      } catch {
        hit = false;
      }
      if (!hit) continue;
      if (RISK_ORDER[esc.min_risk] > RISK_ORDER[risk]) risk = esc.min_risk;
      if (esc.block) blocked = true;
      notes.push(`escalated: ${esc.reason}`);
    }

    if (risk !== 'LOW') approval = true;
    if (blocked) {
      risk = 'CRITICAL';
      approval = true;
    }

    const blockedReason = blocked ? notes.filter((n) => n.startsWith('escalated') || n.includes('not allowed')).join('; ') || policy.description : undefined;

    const evaluation: SecurityEvaluation = {
      risk_level: risk,
      approval_required: approval,
      allowed: !blocked,
      rationale: notes.join('; '),
      matched_policy: policy.tool,
    };
    if (blockedReason !== undefined) evaluation.blocked_reason = blockedReason;
    return evaluation;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function hostOf(target: string): string | null {
  try {
    if (/^[a-z]+:\/\//i.test(target)) return new URL(target).hostname;
  } catch {
    return null;
  }
  // bare host / ip, maybe with port
  const m = /^([^\s:/]+)(?::\d+)?$/.exec(target.trim());
  return m?.[1] ?? null;
}
