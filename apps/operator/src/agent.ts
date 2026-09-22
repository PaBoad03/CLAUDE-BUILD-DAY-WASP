import { randomUUID } from 'node:crypto';
import {
  ToolExecutor, ToolRegistry, sandboxState,
  type AgentId, type AuditRecord, type OperatorFaceState, type PermissionDecision,
  type PermissionRequest, type SandboxState, type SandboxDriver, type ToolRequest, type ToolResult, type WaspEvent,
} from '@wasp/tools';
import { makeEvent, type Bus } from './bus.js';
import type { Speaker } from './voice.js';

export const OPERATOR: AgentId = 'operator';
const SECURITY: AgentId = 'security';
const ARCHITECT: AgentId = 'architect';

export interface OperatorOptions {
  session_id: string;
  bus: Bus;
  registry: ToolRegistry;
  driver: SandboxDriver;
  speaker: Speaker;
  /** How long to wait for GREEN before giving up. Default 120 s (a human is answering). */
  permissionTimeoutMs?: number;
  /** For UI: called on every face state change. */
  onFaceState?: (s: OperatorFaceState) => void;
  onSandboxState?: (s: SandboxState) => void;
  onResult?: (r: ToolResult) => void;
}

interface Pending {
  resolve: (d: PermissionDecision) => void;
  timer: NodeJS.Timeout;
}

/**
 * The ORANGE agent.
 *
 *   tool_requested / validation_request (to: operator)
 *     → registry lookup
 *     → permission_requested (to: security)            ALWAYS emitted, even for LOW
 *     → [requires_approval] wait for permission_granted/denied with same request_id
 *     → tool_started → execute → tool_finished (+ sandbox_* + audit_event)
 *     → validation_result if the request was a validation_request
 *
 * The agent never authorizes itself: with requires_approval=true and no
 * `permission_granted` from GREEN, nothing runs. If GREEN is offline the
 * request times out and is reported as such — never as success.
 */
export class OperatorAgent {
  private readonly executor: ToolExecutor;
  private readonly pending = new Map<string, Pending>();
  private unsubscribe: (() => void) | null = null;
  private face: OperatorFaceState = 'IDLE';
  private busy = Promise.resolve();

  constructor(private readonly o: OperatorOptions) {
    this.executor = new ToolExecutor(o.registry, o.driver);
  }

  async start() {
    this.unsubscribe = this.o.bus.subscribe((e) => this.onEvent(e));
    const state = await sandboxState(this.o.driver);
    this.o.onSandboxState?.(state);
    await this.emit('agent_started', 'broadcast', {
      agent: OPERATOR,
      capabilities: this.o.registry.list().map((t) => ({ name: t.name, risk: t.risk, requires_approval: t.requires_approval })),
      sandbox: state,
    });
    if (!state.docker_available) {
      await this.warn(`Docker capability is unavailable. I cannot validate the laboratory. (${state.last_error ?? 'no details'})`);
      this.setFace('OFFLINE');
    } else {
      this.setFace('IDLE');
    }
  }

  async stop() {
    this.unsubscribe?.();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    await this.emit('agent_finished', 'broadcast', { agent: OPERATOR });
  }

  // ─── inbound ────────────────────────────────────────────────────────────────

  private onEvent(e: WaspEvent) {
    if (e.from === OPERATOR) return;
    const forMe = e.to === OPERATOR || e.to === 'broadcast';

    if ((e.type === 'permission_granted' || e.type === 'permission_denied') && forMe) {
      const d = e.payload as PermissionDecision;
      const p = d?.request_id ? this.pending.get(d.request_id) : undefined;
      if (!p) return; // not ours, or already resolved
      if (e.from !== SECURITY) {
        // Only GREEN may decide. Anyone else spoofing a grant is ignored and reported.
        void this.warn(`Ignored ${e.type} for ${d.request_id} from "${e.from}": only security may authorize.`);
        return;
      }
      clearTimeout(p.timer);
      this.pending.delete(d.request_id);
      p.resolve({ ...d, granted: e.type === 'permission_granted' && d.granted !== false });
      return;
    }

    if ((e.type === 'tool_requested' || e.type === 'validation_request') && e.to === OPERATOR) {
      const req = normalise(e.payload, e.from);
      // Serialise: one tool at a time keeps the terminal window and TTS coherent.
      this.busy = this.busy.then(async () => { await this.handle(req, e.type === 'validation_request'); }).catch((err) => {
        void this.warn(`Internal error handling ${req.request_id}: ${(err as Error).message}`);
      });
    }
  }

  // ─── core flow ──────────────────────────────────────────────────────────────

  async handle(req: ToolRequest, isValidation: boolean): Promise<ToolResult> {
    this.setFace('PREPARING');
    const spec = this.o.registry.get(req.tool);
    const startedAt = new Date().toISOString();

    if (!spec) {
      const r = rejected(req, startedAt, `Unknown tool "${req.tool}". Nothing executed.`);
      await this.finish(req, r, isValidation, { risk: 'LOW', approval_required: false, approval_status: 'not_required' });
      return r;
    }

    // Always tell GREEN, even for LOW-risk tools: they audit everything.
    const permission: PermissionRequest = {
      request_id: req.request_id,
      tool: req.tool,
      args: req.args,
      risk: spec.risk,
      requires_approval: spec.requires_approval,
      reason: req.reason,
      requested_by: req.requested_by,
      summary: spec.description,
    };
    // Register the wait BEFORE publishing: a fast policy-based GREEN may answer
    // in the same tick, and a grant that arrives before we listen must not be lost.
    const decisionPromise = spec.requires_approval ? this.awaitDecision(req.request_id) : undefined;
    await this.emit('permission_requested', SECURITY, permission);

    let approval: AuditRecord['approval_status'] = 'not_required';
    let decision: PermissionDecision | undefined;

    if (decisionPromise) {
      this.setFace('WAITING_FOR_PERMISSION');
      await this.say(`${req.tool.replace(/_/g, ' ')} requires ${spec.risk.toLowerCase()} risk authorization. Waiting for Security.`);
      decision = await decisionPromise;
      if (!decision) {
        approval = 'timeout';
        const r = rejected(req, startedAt, 'No authorization received from Security. Nothing executed.');
        await this.say('No authorization received. I did not execute the operation.');
        await this.finish(req, r, isValidation, { risk: spec.risk, approval_required: true, approval_status: approval });
        this.setFace('ERROR');
        return r;
      }
      if (!decision.granted) {
        approval = 'denied';
        const r: ToolResult = { ...rejected(req, startedAt, `Denied by ${decision.decided_by}${decision.reason ? `: ${decision.reason}` : ''}.`), status: 'denied' };
        await this.say('Authorization denied. Operation cancelled.');
        await this.finish(req, r, isValidation, { risk: spec.risk, approval_required: true, approval_status: approval, user_authorization: decision.user_authorization });
        this.setFace('IDLE');
        return r;
      }
      approval = 'granted';
      await this.say('Authorization received.');
    }

    // ─ execute ─
    this.setFace('EXECUTING');
    await this.emit('tool_started', 'broadcast', { request_id: req.request_id, tool: req.tool, args: req.args, risk: spec.risk });
    if (req.tool === 'sandbox_create') await this.say('Starting sandbox.');
    else if (spec.requires_approval === false && req.tool !== 'sandbox_status') await this.say(`Running ${req.tool.replace(/_/g, ' ')}.`);

    const result = await this.executor.execute({ request_id: req.request_id, tool: req.tool, args: req.args });

    if (req.tool === 'sandbox_create' && result.status === 'success') {
      await this.emit('sandbox_started', 'broadcast', { request_id: req.request_id, ...result.data });
    } else if (req.tool.startsWith('sandbox_') && result.command.length) {
      await this.emit('sandbox_test', 'broadcast', { request_id: req.request_id, tool: req.tool, command: result.command });
      await this.emit('sandbox_result', 'broadcast', { request_id: req.request_id, tool: req.tool, status: result.status, summary: result.summary, data: result.data });
    }

    await this.say(result.summary);
    await this.finish(req, result, isValidation, {
      risk: spec.risk, approval_required: spec.requires_approval, approval_status: approval, user_authorization: decision?.user_authorization,
    });

    this.setFace(result.status === 'success' ? 'SUCCESS' : result.status === 'unavailable' ? 'OFFLINE' : 'ERROR');
    setTimeout(() => this.setFace(this.face === 'OFFLINE' ? 'OFFLINE' : 'IDLE'), 4000);
    return result;
  }

  private awaitDecision(request_id: string): Promise<PermissionDecision | undefined> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(request_id); resolve(undefined); }, this.o.permissionTimeoutMs ?? 120_000);
      this.pending.set(request_id, { resolve, timer });
    });
  }

  private async finish(
    req: ToolRequest,
    result: ToolResult,
    isValidation: boolean,
    a: { risk: AuditRecord['risk_level']; approval_required: boolean; approval_status: AuditRecord['approval_status']; user_authorization?: string },
  ) {
    this.o.onResult?.(result);
    await this.emit('tool_finished', 'broadcast', result);
    if (isValidation) {
      await this.emit('validation_result', req.requested_by ?? ARCHITECT, {
        request_id: req.request_id,
        tool: req.tool,
        validated: result.status === 'success',
        status: result.status,
        summary: result.summary,
        evidence: { command: result.command, exit_code: result.exit_code, data: result.data },
      });
    }
    const audit: AuditRecord = {
      timestamp: result.finished_at,
      agent: OPERATOR,
      action: req.tool,
      tool: result.command[0] ?? req.tool,
      reason: req.reason,
      input: result.args,
      result: { status: result.status, summary: result.summary, exit_code: result.exit_code, command: result.command, data: result.data },
      status: result.status,
      risk_level: a.risk,
      approval_required: a.approval_required,
      approval_status: a.approval_status,
      user_authorization: a.user_authorization,
    };
    await this.emit('audit_event', 'broadcast', audit);
    this.o.onSandboxState?.(await sandboxState(this.o.driver));
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private setFace(s: OperatorFaceState) {
    if (s === this.face) return;
    this.face = s;
    this.o.onFaceState?.(s);
    void this.emit('agent_state', 'broadcast', { agent: OPERATOR, state: s });
  }

  private async say(text: string) {
    await this.emit('agent_message', 'broadcast', { from: OPERATOR, to: ARCHITECT, message: text, spoken: true });
    await this.o.speaker.speak(OPERATOR, text);
  }

  private async warn(message: string) {
    console.warn(`🟠 WARNING: ${message}`);
    await this.emit('warning', 'broadcast', { agent: OPERATOR, message });
  }

  private emit<T>(type: WaspEvent['type'], to: AgentId | 'broadcast', payload: T) {
    return this.o.bus.publish(makeEvent(this.o.session_id, type, OPERATOR, to, payload));
  }
}

function normalise(p: unknown, from: AgentId): ToolRequest {
  const x = (p ?? {}) as Partial<ToolRequest> & { operation?: string; params?: Record<string, unknown> };
  return {
    request_id: x.request_id ?? randomUUID(),
    tool: x.tool ?? x.operation ?? '',
    args: x.args ?? x.params ?? {},
    reason: x.reason ?? '',
    requested_by: x.requested_by ?? from,
  };
}

function rejected(req: ToolRequest, started_at: string, summary: string): ToolResult {
  return {
    request_id: req.request_id, tool: req.tool, args: req.args, status: 'rejected',
    started_at, finished_at: new Date().toISOString(), command: [], exit_code: null, stdout: '', stderr: '', summary, data: {},
  };
}
