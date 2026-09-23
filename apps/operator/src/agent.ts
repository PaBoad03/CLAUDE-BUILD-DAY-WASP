/**
 * ORANGE — the operator agent, wired to the WASP HUB through @wasp/event-bus.
 *
 *   validation_request / tool_requested (to: operator)
 *     → registry lookup (unknown tool / off-list args → rejected, nothing runs)
 *     → permission_requested (to: security)      ALWAYS, even for LOW risk (GREEN audits everything)
 *     → [requires_approval] wait for permission_granted from GREEN; denied/cancelled/offline → nothing runs
 *     → tool_started → docker exec fixed argv → sandbox_test / sandbox_result / tool_finished + audit_event
 *     → validation_result (validated only if every real test succeeded)
 *
 * The agent never authorizes itself. If GREEN is offline, approval-requiring tools do not run
 * and the result says so. If Docker is offline, results are `unavailable`, never `success`.
 */

import type { HubClient } from '@wasp/event-bus';
import { AgentUnavailableError, RequestTimeoutError } from '@wasp/event-bus';
import { newId, type AuditEntry, type PermissionDecision, type PermissionRequest, type RiskLevel, type ToolRequest, type ToolResult, type ValidationRequest } from '@wasp/shared-types';
import { ToolExecutor, ToolRegistry, labState, toSandboxState, toToolResult, type SandboxDriver, type ToolSpec } from '@wasp/tools';

/** What the agent needs from the hub. `HubClient` and `FakeHub` (tests) both satisfy it. */
export type HubLike = Pick<HubClient, 'agent' | 'onMine' | 'on' | 'emit' | 'say' | 'setState' | 'audit' | 'request' | 'isOnline'>;

export interface OperatorOptions {
  hub: HubLike;
  registry: ToolRegistry;
  driver: SandboxDriver;
  /** How long to wait for GREEN + the human. Default 120 s. */
  permissionTimeoutMs?: number;
  /** true when running against the FakeDriver: every result is marked stub and can never validate the lab. */
  stub?: boolean;
  log?: (msg: string) => void;
}

interface PlanStep {
  tool_id: string;
  input: Record<string, unknown>;
}

/** What "validate the lab" means when CYAN does not name tools: create the sandbox, then the safe tests. */
export const DEFAULT_VALIDATION_PLAN: PlanStep[] = [
  { tool_id: 'docker_sandbox', input: {} },
  { tool_id: 'sandbox_ping', input: { target: '127.0.0.1' } },
  { tool_id: 'sandbox_dns', input: { name: 'wasp-target' } },
  { tool_id: 'sandbox_http', input: { url: 'http://wasp-target/' } },
  { tool_id: 'sandbox_routes', input: {} },
];

const DEFAULT_INPUTS: Record<string, Record<string, unknown>> = Object.fromEntries(DEFAULT_VALIDATION_PLAN.map((s) => [s.tool_id, s.input]));

export class OperatorAgent {
  private readonly hub: HubLike;
  private readonly executor: ToolExecutor;
  private readonly log: (m: string) => void;
  private queue: Promise<unknown> = Promise.resolve();
  private offs: Array<() => void> = [];
  private dockerAvailable = false;

  constructor(private readonly o: OperatorOptions) {
    this.hub = o.hub;
    this.executor = new ToolExecutor(o.registry, o.driver);
    this.log = o.log ?? (() => {});
  }

  async start(): Promise<void> {
    const lab = await labState(this.o.driver);
    this.dockerAvailable = lab.docker_available;
    this.hub.emit('tools_registered', { tools: this.o.registry.toToolDefinitions({ available: lab.docker_available, unavailable_reason: lab.last_error }) });
    this.hub.emit('sandbox_state', toSandboxState(lab));
    if (!lab.docker_available) {
      this.hub.setState('ERROR', 'Docker unavailable');
      this.hub.say('architect', `La capacidad de Docker no está disponible. No puedo validar el laboratorio.${this.o.stub ? ' [stub]' : ''}`, 'capability_unavailable');
      this.hub.emit('warning', { message: `Docker capability is unavailable: ${lab.last_error ?? 'unknown error'}` });
    } else {
      this.hub.setState('IDLE', `Docker ${lab.docker_version}`);
    }
    this.offs.push(
      this.hub.onMine('validation_request', (evt) => this.enqueue(() => this.validate(evt.payload, evt.from, evt.correlation_id))),
      this.hub.onMine('tool_requested', (evt) => this.enqueue(() => this.runTool(evt.payload)).then(() => undefined)),
    );
    this.log(`operator ready (docker ${lab.docker_available ? lab.docker_version : 'OFFLINE'}, ${this.o.registry.list().length} tools)`);
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.hub.setState('OFFLINE');
  }

  /** Serialise work: one tool at a time keeps the terminal window and the spoken lines coherent. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch((err) => {
      this.log(`internal error: ${(err as Error).message}`);
      this.hub.emit('error', { message: `operator internal error: ${(err as Error).message}` });
    });
    return next;
  }

  // ------------------------------------------------------------------ validation (CYAN → ORANGE)

  async validate(req: ValidationRequest, from: HubLike['agent'] | 'hub' | 'human' | 'all', correlation_id?: string): Promise<void> {
    const to = from === 'all' || from === 'hub' || from === 'human' ? 'architect' : from;
    const corr = correlation_id ?? req.request_id;
    const reply = (validated: boolean, tests: ToolResult[], summary: string) =>
      this.hub.emit(
        'validation_result',
        { request_id: req.request_id, validated, tests, summary, verifies_research_ids: validated ? req.research_ids : undefined, stub: this.o.stub || undefined },
        { to, correlation_id: corr },
      );

    this.hub.setState('PREPARING', req.description.slice(0, 60));
    const lab = await labState(this.o.driver);
    this.dockerAvailable = lab.docker_available;
    if (!lab.docker_available) {
      this.hub.setState('ERROR', 'Docker unavailable');
      const msg = `La capacidad de Docker no está disponible. No puedo validar el laboratorio.${this.o.stub ? ' [stub]' : ''}`;
      this.hub.say(to, msg, 'validation_unavailable');
      this.hub.emit('sandbox_state', toSandboxState(lab));
      reply(false, [], `${msg} (${lab.last_error ?? 'no details'})`);
      return;
    }

    const plan: PlanStep[] = req.tools?.length ? req.tools.map((tool_id) => ({ tool_id, input: DEFAULT_INPUTS[tool_id] ?? {} })) : DEFAULT_VALIDATION_PLAN;
    const needsApproval = plan.some((s) => this.o.registry.get(s.tool_id)?.requires_approval);
    this.hub.say(to, needsApproval ? 'Puedo probarlo en el sandbox aislado. Crearlo requiere autorización de Seguridad.' : 'Puedo probarlo en el sandbox aislado.', 'ack');

    const tests: ToolResult[] = [];
    for (const step of plan) {
      const result = await this.runTool({ tool_id: step.tool_id, request_id: newId('tool'), requested_by: to === 'architect' || to === 'researcher' ? to : 'architect', input: step.input, reason: req.description });
      tests.push(result);
      if (result.status !== 'success') break; // honest: stop at the first thing that did not work
    }

    const real = tests.filter((t) => t.tool_id !== 'docker_sandbox' && t.tool_id !== 'sandbox_status');
    const validated = tests.length > 0 && tests.every((t) => t.status === 'success') && real.length > 0 && !this.o.stub;
    const last = tests[tests.length - 1];
    const summary = validated
      ? `Laboratorio validado: ${real.length} prueba${real.length === 1 ? '' : 's'} real${real.length === 1 ? '' : 'es'} superada${real.length === 1 ? '' : 's'} dentro del sandbox aislado (${real.map((t) => t.tool_id).join(', ')}).`
      : this.o.stub && tests.every((t) => t.status === 'success')
        ? `Docker simulado: ${tests.length} pasos corrieron, pero nada real se ejecutó. Laboratorio NO validado. [stub]`
        : `Laboratorio NO validado: ${last ? `${last.tool_id} → ${last.status}${last.summary ? ` (${last.summary})` : ''}` : 'ninguna prueba corrió'}.`;

    this.hub.setState(validated ? 'SUCCESS' : 'WARNING', validated ? 'lab validated' : 'lab not validated');
    this.hub.say(to, validated ? `Laboratorio validado. ${real.length} pruebas superadas en el sandbox.` : summary, validated ? 'validation_complete' : 'validation_failed');
    reply(validated, tests, summary);
  }

  // ------------------------------------------------------------------ one tool (permission → execute → report)

  async runTool(req: ToolRequest): Promise<ToolResult> {
    const spec = this.o.registry.get(req.tool_id);
    const started_at = new Date().toISOString();
    if (!spec) {
      return this.finish(req, rejected(req, started_at, `Herramienta desconocida "${req.tool_id}". Nada se ejecutó.`, this.o.stub), { risk: 'LOW', approval_required: false });
    }

    // Ask GREEN. Always — LOW tools do not wait for the answer, but GREEN sees and audits every request.
    const permission_id = newId('perm');
    const permission: PermissionRequest = {
      permission_id,
      requested_by: 'operator',
      operation: req.tool_id,
      reason: req.reason ?? spec.description,
      proposed_risk: spec.risk,
      input: { ...req.input, request_id: req.request_id, on_behalf_of: req.requested_by },
    };

    let decision: PermissionDecision | undefined;
    if (spec.requires_approval) {
      this.hub.setState('WAITING_FOR_PERMISSION', req.tool_id);
      if (!this.hub.isOnline('security')) {
        const r = rejected(req, started_at, 'Seguridad está desconectada. No puedo obtener autorización, así que nada se ejecutó.', this.o.stub);
        this.hub.say('architect', 'Seguridad está desconectada. No puedo obtener autorización para esta operación, así que no la ejecutaré.', 'security_offline');
        return this.finish(req, r, { risk: spec.risk, approval_required: true, approval_status: 'PENDING' });
      }
      this.hub.say('security', `Seguridad, necesito autorización para ${req.tool_id === 'docker_sandbox' ? 'crear el sandbox aislado' : req.tool_id === 'sandbox_network_external' ? 'darle red externa al sandbox' : req.tool_id}.`, 'permission_request');
      let answer;
      try {
        answer = await this.hub.request('permission_requested', permission, {
          to: 'security',
          expect: ['permission_granted', 'permission_denied', 'permission_cancelled'],
          correlation_id: permission_id,
          timeoutMs: this.o.permissionTimeoutMs ?? 120_000,
        });
      } catch (err) {
        const why = err instanceof AgentUnavailableError ? 'Seguridad se desconectó antes de responder' : err instanceof RequestTimeoutError ? 'No llegó ninguna autorización a tiempo' : (err as Error).message;
        const r = rejected(req, started_at, `${why}. Nada se ejecutó.`, this.o.stub);
        this.hub.say('architect', `${why}. No ejecuté ${req.tool_id}.`, 'permission_timeout');
        this.hub.setState('ERROR', 'no authorization');
        return this.finish(req, r, { risk: spec.risk, approval_required: true, approval_status: 'PENDING' });
      }
      decision = answer.payload;
      if (answer.type !== 'permission_granted') {
        const r: ToolResult = { ...rejected(req, started_at, `Autorización ${decision.status === 'CANCELLED' ? 'cancelada' : 'denegada'} por ${decision.decided_by === 'human' ? 'el humano' : 'Seguridad'}. Nada se ejecutó.`, this.o.stub), status: 'denied' };
        this.hub.say('architect', decision.status === 'CANCELLED' ? 'Operación cancelada. No se ejecutó nada.' : 'Autorización denegada. No se ejecutó nada.', 'permission_denied');
        this.hub.setState('IDLE');
        return this.finish(req, r, { risk: decision.risk, approval_required: true, approval_status: decision.status, human_raw: decision.human_raw, permission_id });
      }
      this.hub.say('architect', 'Autorización recibida. Iniciando el sandbox.', 'authorized');
    } else {
      this.hub.emit('permission_requested', permission, { to: 'security', correlation_id: permission_id });
    }

    // Execute — fixed argv through the allowlisted executor. Claude never gets a shell.
    this.hub.setState('EXECUTING', req.tool_id);
    this.hub.emit('tool_started', { tool_id: req.tool_id, request_id: req.request_id, permission_id }, { correlation_id: req.request_id });
    const exec = await this.executor.execute({ request_id: req.request_id, tool: req.tool_id, args: req.input ?? {} });
    if (exec.command.length) this.hub.emit('sandbox_test', { request_id: req.request_id, command: exec.command.join(' ') }, { correlation_id: req.request_id });
    const result = toToolResult(exec, { permission_id, stub: this.o.stub });

    const lab = await labState(this.o.driver);
    this.dockerAvailable = lab.docker_available;
    if (req.tool_id === 'docker_sandbox' && result.status === 'success') this.hub.emit('sandbox_started', toSandboxState(lab, result));
    else if (exec.command.length) this.hub.emit('sandbox_result', result, { correlation_id: req.request_id });
    this.hub.emit('sandbox_state', toSandboxState(lab, exec.command.length ? result : undefined));

    if (req.tool_id !== 'sandbox_status') this.hub.say('architect', `${result.summary}${this.o.stub ? ' [stub]' : ''}`, 'tool_result');
    this.hub.setState(result.status === 'success' ? 'SUCCESS' : result.status === 'unavailable' ? 'ERROR' : 'WARNING', `${req.tool_id}: ${result.status}`);
    return this.finish(req, result, { risk: spec.risk, approval_required: spec.requires_approval, approval_status: decision?.status ?? (spec.requires_approval ? 'PENDING' : undefined), human_raw: decision?.human_raw, permission_id });
  }

  // ------------------------------------------------------------------ report + audit

  private finish(req: ToolRequest, result: ToolResult, a: { risk: RiskLevel; approval_required: boolean; approval_status?: AuditEntry['approval_status']; human_raw?: string; permission_id?: string }): ToolResult {
    this.hub.emit('tool_finished', result, { correlation_id: req.request_id });
    this.hub.audit({
      action: req.tool_id,
      tool: result.command?.[0] ?? req.tool_id,
      reason: req.reason,
      input: { ...(result.input ?? req.input), requested_by: req.requested_by },
      result: { status: result.status, summary: result.summary, exit_code: result.exit_code, command: result.command },
      status: auditStatus(result.status),
      risk_level: a.risk,
      approval_required: a.approval_required,
      approval_status: a.approval_status,
      user_authorization: a.human_raw,
      correlation_id: a.permission_id ?? req.request_id,
      stub: this.o.stub || undefined,
    });
    this.log(`${req.tool_id} → ${result.status}: ${result.summary ?? ''}`);
    return result;
  }
}

function rejected(req: ToolRequest, started_at: string, summary: string, stub?: boolean): ToolResult {
  const finished_at = new Date().toISOString();
  return { tool_id: req.tool_id, request_id: req.request_id, status: 'rejected', error: summary, summary, command: [], exit_code: null, input: req.input, started_at, finished_at, duration_ms: Math.max(0, Date.parse(finished_at) - Date.parse(started_at)), stub: stub || undefined };
}

function auditStatus(s: ToolResult['status']): AuditEntry['status'] {
  switch (s) {
    case 'success':
      return 'success';
    case 'unavailable':
      return 'unavailable';
    case 'denied':
    case 'rejected':
      return 'denied';
    default:
      return 'failure';
  }
}

export type { ToolSpec };
