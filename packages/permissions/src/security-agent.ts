import type { HubClient } from '@wasp/event-bus';
import type { AuditEntry, HumanAuthorization, Participant, PermissionDecision, PermissionRequest, WaspEvent } from '@wasp/shared-types';
import { AuditLog, canMarkValidated } from '@wasp/audit';
import { PermissionEngine, type PermissionEngineOptions } from './engine';
import { interpretAuthorization } from './voice-authorization';
import type { SecurityRecord, SecurityState } from './types';

/** What the agent needs from the hub. `HubClient` and `FakeHub` (tests) both satisfy it. */
export type HubLike = Pick<HubClient, 'agent' | 'onMine' | 'on' | 'onAny' | 'emit' | 'say' | 'setState' | 'audit'>;

export interface SecurityAgentOptions extends PermissionEngineOptions {
  hub: HubLike;
  audit?: AuditLog;
  /** ms before an AWAITING_HUMAN permission expires. 0 = never (live demo: humans are slow). Default 0. */
  pending_timeout_ms?: number;
  /** ms to hold AUTHORIZED/DENIED/BLOCKED on the face before returning to MONITORING. Default 4000. */
  settle_ms?: number;
  log?: (msg: string) => void;
}

/**
 * GREEN — the security agent runtime, wired to the WASP HUB.
 *
 * consumes: permission_requested (to: security), user_authorization, user_message, tools_registered,
 *           tool_started, tool_finished, validation_result, workshop_updated, agent_offline
 * produces: permission_required, permission_granted, permission_denied, permission_cancelled,
 *           permission_clarification_needed, agent_message, agent_state, warning, audit_event
 *
 * It does NOT call Claude. Authorization is deterministic application logic.
 * The hub only accepts permission_* decisions from `security`, so this process IS the boundary.
 */
export class SecurityAgent {
  readonly engine: PermissionEngine;
  readonly audit: AuditLog;
  private readonly hub: HubLike;
  private readonly lang: 'es' | 'en';
  private readonly settleMs: number;
  private readonly timeoutMs: number;
  private readonly log: (m: string) => void;
  private state: SecurityState = 'IDLE';
  private offs: Array<() => void> = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** tool_id → whether GREEN considers it approval-requiring (from tools_registered + policies). */
  private started = 0;

  constructor(opts: SecurityAgentOptions) {
    this.hub = opts.hub;
    this.lang = opts.lang ?? 'es';
    this.settleMs = opts.settle_ms ?? 4000;
    this.timeoutMs = opts.pending_timeout_ms ?? 0;
    this.log = opts.log ?? (() => {});
    this.engine = new PermissionEngine({ registry: opts.registry, lang: this.lang, now: opts.now });
    this.audit = opts.audit ?? new AuditLog();
  }

  getState(): SecurityState {
    return this.state;
  }

  start(): void {
    if (this.offs.length) return;
    this.offs.push(
      this.audit.attach(this.hub),
      this.hub.onMine('permission_requested', (e) => this.onPermissionRequested(e)),
      this.hub.on('user_authorization', (e) => this.onUserAuthorization(e.payload)),
      this.hub.on('user_message', (e) => this.onUserMessage(e.payload.text, e.payload.channel)),
      this.hub.on('tools_registered', (e) => {
        this.engine.registry.registerFromToolDefinitions(e.payload.tools);
        this.log(`tools_registered: ${e.payload.tools.length} tools merged into the policy registry`);
      }),
      this.hub.on('tool_started', (e) => this.onToolStarted(e.payload)),
      this.hub.on('tool_finished', (e) => this.onToolFinished(e.payload.tool_id, e.payload.status, e.payload.error)),
      this.hub.on('validation_result', (e) => this.onValidationResult(e)),
      this.hub.on('workshop_updated', (e) => this.onWorkshopUpdated(e.payload.workshop.lab.validated)),
      this.hub.on('agent_offline', (e) => this.onAgentOffline(e.payload.agent)),
    );
    this.setState('MONITORING');
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.settleTimer) clearTimeout(this.settleTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.setState('OFFLINE');
  }

  // ------------------------------------------------------------------ permission_requested

  private onPermissionRequested(evt: WaspEvent<'permission_requested'>): void {
    // The hub guarantees evt.from is the registered socket; a payload claiming another requester is a red flag.
    const req: PermissionRequest = evt.payload.requested_by === evt.from || evt.from === 'human' || evt.from === 'hub' ? evt.payload : { ...evt.payload, requested_by: evt.from as PermissionRequest['requested_by'] };
    if (req !== evt.payload) this.warn('REQUESTER_MISMATCH', `permission_requested from "${evt.from}" claimed requested_by "${evt.payload.requested_by}"`, { permission_id: req.permission_id });

    this.setState('REVIEWING', `${req.requested_by}: ${req.operation}`);
    const res = this.engine.request(req);
    const corr = { correlation_id: req.permission_id };

    switch (res.outcome) {
      case 'DUPLICATE':
        return;
      case 'BLOCKED': {
        this.setState('BLOCKED', req.operation);
        this.hub.emit('permission_denied', res.decision!, { to: 'all', ...corr });
        this.hub.say(req.requested_by, this.t('blocked', res.record), 'permission_blocked');
        this.recordAudit(req, res.record, 'denied', res.decision!.rationale ?? 'blocked by policy');
        this.settle();
        return;
      }
      case 'AWAITING_HUMAN': {
        this.setState('PERMISSION_REQUIRED', req.operation);
        this.hub.emit('permission_required', res.required!, { to: 'architect', ...corr });
        this.hub.say('architect', this.t('required', res.record), 'permission_required');
        this.recordAudit(req, res.record, 'info', 'human authorization required');
        this.armTimeout(req.permission_id);
        return;
      }
      case 'AUTO_APPROVED': {
        this.hub.emit('permission_granted', res.decision!, { to: 'all', ...corr });
        this.hub.say(req.requested_by, this.t('auto_granted', res.record), 'permission_auto', undefined, false);
        this.recordAudit(req, res.record, 'success', 'low risk, auto-approved by policy');
        // Not worth a face flash: straight back to watching (or to the human question still pending).
        this.setState(this.engine.pending().length ? 'PERMISSION_REQUIRED' : 'MONITORING');
        return;
      }
    }
  }

  // ------------------------------------------------------------------ human answers

  private onUserAuthorization(a: HumanAuthorization): void {
    const rec = this.engine.get(a.permission_id);
    if (!rec) {
      this.warn('UNKNOWN_PERMISSION', `user_authorization for unknown permission ${a.permission_id}`, { raw: a.raw });
      return;
    }
    if (rec.status !== 'AWAITING_HUMAN') return; // already decided; a late/duplicate answer changes nothing
    this.applyTranscript(rec.permission_id, a.raw, a.channel, a.decision);
  }

  /** The human may just say "sí" to WASP. If exactly one permission is pending, that is the answer. */
  private onUserMessage(text: string, channel: string): void {
    const pending = this.engine.pending();
    if (pending.length === 0) return;
    const it = interpretAuthorization(text);
    if (it.decision === 'AMBIGUOUS') return; // a normal sentence; CYAN handles it
    if (it.decision === 'STOP') {
      const cancelled = this.engine.cancelAllPending(text, channel);
      for (const d of cancelled) this.hub.emit('permission_cancelled', d, { to: 'all', correlation_id: d.permission_id });
      this.setState('DENIED', 'all pending cancelled');
      this.hub.say('all', this.t('cancelled_all'), 'permission_cancelled');
      for (const d of cancelled) this.recordDecision(d);
      this.settle();
      return;
    }
    if (pending.length > 1) {
      // Which one? Never decide by position.
      this.setState('PERMISSION_REQUIRED', 'ambiguous target');
      this.hub.emit('permission_clarification_needed', { permission_id: pending[0]!.permission_id, human_prompt: this.t('ambiguous_multi', pending.length) }, { to: 'architect' });
      this.hub.say('architect', this.t('ambiguous_multi', pending.length), 'permission_reprompt');
      return;
    }
    this.applyTranscript(pending[0]!.permission_id, text, channel);
  }

  private applyTranscript(permission_id: string, raw: string, channel: string, explicit?: HumanAuthorization['decision']): void {
    const res = this.engine.decideFromTranscript(permission_id, raw, channel, explicit);
    if (!res.ok) {
      if (res.clarification) {
        this.setState('PERMISSION_REQUIRED', 'ambiguous answer');
        this.hub.emit('permission_clarification_needed', res.clarification, { to: 'architect', correlation_id: permission_id });
        this.hub.say('architect', res.clarification.human_prompt, 'permission_reprompt');
        this.hub.audit({ action: 'ambiguous_authorization', tool: res.record?.operation, reason: `heard "${raw}" — not accepted as authorization (${res.interpretation?.reason})`, input: { heard: raw, channel }, status: 'info', risk_level: res.record?.risk, approval_required: true, approval_status: 'AWAITING_HUMAN', user_authorization: raw, correlation_id: permission_id });
      }
      return;
    }
    const d = res.decision!;
    this.disarmTimeout(permission_id);
    const type = d.status === 'GRANTED' ? 'permission_granted' : d.status === 'DENIED' ? 'permission_denied' : 'permission_cancelled';
    this.hub.emit(type, d, { to: 'all', correlation_id: permission_id });
    this.setState(d.status === 'GRANTED' ? 'AUTHORIZED' : 'DENIED', d.operation);
    this.hub.say('all', this.t(d.status === 'GRANTED' ? 'granted' : d.status === 'DENIED' ? 'denied' : 'cancelled', res.record!), type);
    this.recordDecision(d);
    this.settle();
  }

  // ------------------------------------------------------------------ enforcement & honesty

  private onToolStarted(p: { tool_id: string; request_id: string; permission_id?: string }): void {
    this.started++;
    const policy = this.engine.registry.get(p.tool_id);
    const needsApproval = policy ? policy.requires_approval || policy.risk_level !== 'LOW' : true; // unknown tool: fail closed
    const rec = p.permission_id ? this.engine.get(p.permission_id) : undefined;
    // A LOW tool whose specific request GREEN escalated (e.g. external target) must also wait.
    const escalated = rec !== undefined && rec.status === 'AWAITING_HUMAN';
    if (!needsApproval && !escalated) return;
    if (rec && this.engine.isAuthorized(rec.permission_id)) return;
    this.setState('WARNING', 'unauthorized tool start');
    this.warn('UNAUTHORIZED_TOOL_START', `tool_started for ${p.tool_id} (${p.request_id}) without a GRANTED permission`, { request_id: p.request_id, tool_id: p.tool_id, permission_id: p.permission_id, permission_status: rec?.status ?? 'NONE' });
    this.hub.say('all', this.t('unauthorized', p.tool_id), 'security_alert');
  }

  private onToolFinished(tool_id: string, status: string, error?: string): void {
    if (status === 'unavailable') {
      this.setState('WARNING', `${tool_id} unavailable`);
      this.hub.say('architect', this.t('unavailable', tool_id), 'capability_unavailable');
      this.settle();
    } else if (status === 'failure' || status === 'timeout') {
      this.setState('WARNING', `${tool_id} ${status}${error ? `: ${error.slice(0, 40)}` : ''}`);
      this.settle();
    }
  }

  /** Adversarial cross-check: a validation_result claiming success must be backed by real tests. */
  private onValidationResult(e: WaspEvent<'validation_result'>): void {
    const v = e.payload;
    if (!v.validated) return;
    const realSuccess = v.tests.some((t) => t.status === 'success' && !t.stub);
    if (e.from !== 'operator' || v.stub || !realSuccess) {
      this.setState('WARNING', 'validation claim without evidence');
      this.warn('VALIDATION_CLAIM_WITHOUT_EVIDENCE', `validation_result from "${e.from}" claims validated=true ${v.stub ? '(stub)' : 'without a real successful test'}`, { request_id: v.request_id, from: e.from, stub: v.stub ?? false, tests: v.tests.length });
      this.hub.say('architect', this.t('claim_rejected'), 'security_alert');
      this.settle();
    }
  }

  private onWorkshopUpdated(validated: boolean): void {
    if (!validated) return;
    if (!canMarkValidated(this.audit.list())) {
      this.setState('WARNING', 'lab.validated without evidence');
      this.warn('VALIDATION_CLAIM_WITHOUT_EVIDENCE', 'workshop_updated claims lab.validated=true but the audit has no successful real sandbox test', {});
      this.hub.say('architect', this.t('claim_rejected'), 'security_alert');
      this.settle();
    }
  }

  private onAgentOffline(agent: string): void {
    if (agent === 'security') return;
    this.setState('WARNING', `${agent} offline`);
    this.hub.say('architect', this.t('offline', agent), 'agent_offline');
    this.settle();
  }

  // ------------------------------------------------------------------ timeouts

  private armTimeout(permission_id: string): void {
    if (this.timeoutMs <= 0) return;
    const t = setTimeout(() => {
      this.timers.delete(permission_id);
      const res = this.engine.expire(permission_id);
      if (!res.ok || !res.decision) return;
      this.hub.emit('permission_cancelled', res.decision, { to: 'all', correlation_id: permission_id });
      this.hub.say('architect', this.t('expired', res.record!), 'permission_expired');
      this.setState('WARNING', 'permission expired');
      this.recordDecision(res.decision);
      this.settle();
    }, this.timeoutMs);
    (t as { unref?: () => void }).unref?.();
    this.timers.set(permission_id, t);
  }

  private disarmTimeout(permission_id: string): void {
    const t = this.timers.get(permission_id);
    if (t) clearTimeout(t);
    this.timers.delete(permission_id);
  }

  // ------------------------------------------------------------------ output helpers

  private setState(state: SecurityState, detail?: string): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    this.state = state;
    this.hub.setState(state, detail);
  }

  /** Hold the current face (AUTHORIZED / DENIED / WARNING...) for a moment, then go back to watching. */
  private settle(): void {
    if (this.settleMs <= 0) return;
    this.settleTimer = setTimeout(() => this.setState(this.engine.pending().length ? 'PERMISSION_REQUIRED' : 'MONITORING'), this.settleMs);
    (this.settleTimer as { unref?: () => void }).unref?.();
  }

  private warn(code: string, message: string, detail: Record<string, unknown>): void {
    this.log(`WARNING ${code}: ${message}`);
    this.hub.emit('warning', { message: `${code}: ${message}`, detail });
    this.hub.audit({ action: code, reason: message, input: detail, status: 'failure', approval_required: false });
  }

  private recordAudit(req: PermissionRequest, rec: SecurityRecord, status: AuditEntry['status'], reason: string): void {
    this.hub.audit({
      action: `evaluate_permission: ${req.operation}`,
      tool: req.operation,
      reason,
      input: { requested_by: req.requested_by, reason: req.reason, ...(req.input ?? {}) },
      result: { evaluation: rec.evaluation },
      status,
      risk_level: rec.risk,
      approval_required: rec.approval_required ?? true,
      approval_status: rec.status,
      correlation_id: req.permission_id,
    });
  }

  private recordDecision(d: PermissionDecision): void {
    this.hub.audit({
      action: `record_permission: ${d.operation}`,
      tool: d.operation,
      reason: d.rationale,
      result: { decided_by: d.decided_by },
      status: d.status === 'GRANTED' ? 'success' : d.status === 'DENIED' ? 'denied' : 'cancelled',
      risk_level: d.risk,
      approval_required: d.approval_required,
      approval_status: d.status,
      user_authorization: d.human_raw,
      correlation_id: d.permission_id,
    });
  }

  // ------------------------------------------------------------------ spoken lines (short: detail goes on screen)

  private t(key: string, arg?: SecurityRecord | string | number): string {
    const p = arg as SecurityRecord;
    const es = this.lang === 'es';
    switch (key) {
      case 'required':
        return es ? `Autorización humana requerida. Operación "${p.operation}", riesgo ${p.risk}.` : `Human authorization required. Operation "${p.operation}", risk ${p.risk}.`;
      case 'granted':
        return es ? `Autorización confirmada. ${cap(p.requested_by)} puede proceder.` : `Authorization confirmed. ${cap(p.requested_by)} may proceed.`;
      case 'denied':
        return es ? `Autorización denegada. La operación "${p.operation}" no se ejecutará.` : `Authorization denied. "${p.operation}" will not run.`;
      case 'cancelled':
        return es ? `Operación cancelada por el humano.` : `Operation cancelled by the human.`;
      case 'cancelled_all':
        return es ? `Alto recibido. Todas las operaciones pendientes fueron canceladas.` : `Stop received. All pending operations were cancelled.`;
      case 'blocked':
        return es ? `Operación bloqueada. "${p.operation}" es de riesgo crítico y no está permitida en este sistema.` : `Operation blocked. "${p.operation}" is critical risk and not permitted in this system.`;
      case 'auto_granted':
        return es ? `Riesgo bajo. "${p.operation}" puede ejecutarse sin aprobación.` : `Low risk. "${p.operation}" may run without approval.`;
      case 'expired':
        return es ? `La solicitud "${p.operation}" expiró sin respuesta.` : `Request "${p.operation}" expired without an answer.`;
      case 'unauthorized':
        return es ? `Alerta de seguridad: se inició la herramienta ${String(arg)} sin autorización registrada.` : `Security alert: tool ${String(arg)} started without a recorded authorization.`;
      case 'unavailable':
        return es
          ? `La capacidad ${String(arg)} no está disponible. La validación no puede continuar; el laboratorio permanece sin validar.`
          : `${String(arg)} capability is unavailable. Validation cannot proceed; the lab remains unvalidated.`;
      case 'offline':
        return es ? `${cap(String(arg))} está desconectado. Sus tareas no pueden considerarse completadas.` : `${cap(String(arg))} is offline. Its tasks cannot be considered complete.`;
      case 'ambiguous_multi':
        return es
          ? `Hay ${String(arg)} operaciones pendientes. Indica a cuál respondes, o di "stop" para cancelar todas.`
          : `There are ${String(arg)} pending operations. Say which one you are answering, or "stop" to cancel all.`;
      case 'claim_rejected':
        return es ? `Alerta de seguridad: se afirma que el laboratorio está validado sin evidencia real. Reclamo rechazado.` : `Security alert: the laboratory is claimed validated without real evidence. Claim rejected.`;
      default:
        return key;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type { Participant };
