import type {
  AgentMessagePayload,
  EventBus,
  PermissionRecord,
  ToolRequest,
  TypedEvent,
  WaspEvent,
  WaspEventPayloads,
} from '@wasp/shared-types';
import { newId, nowIso } from '@wasp/shared-types';
import { AuditLog } from '@wasp/audit';
import { PermissionEngine, type PermissionEngineOptions } from './engine.ts';
import { interpretAuthorization } from './voice-authorization.ts';

/** GREEN face states (INSTRUCCIONESJUANDA.md "GREEN FACE"). */
export type SecurityState =
  | 'IDLE'
  | 'MONITORING'
  | 'REVIEWING'
  | 'PERMISSION_REQUIRED'
  | 'AUTHORIZED'
  | 'DENIED'
  | 'BLOCKED'
  | 'WARNING'
  | 'OFFLINE';

export interface SecurityAgentOptions extends Omit<PermissionEngineOptions, 'bus'> {
  bus: EventBus;
  audit?: AuditLog;
  /** ms to hold AUTHORIZED/DENIED/BLOCKED before returning to MONITORING. Default 4000. */
  settle_ms?: number;
  /** language for spoken lines */
  lang?: 'es' | 'en';
}

/**
 * GREEN — the security agent runtime.
 *
 * Listens on the shared bus, runs the PermissionEngine, keeps the audit,
 * publishes its face state and its spoken lines as agent_message events.
 *
 * It does NOT call Claude. Authorization is deterministic application logic.
 * (Claude may later be used for *explaining* a risk, never for *deciding* it.)
 *
 * Bus contract:
 *   consumes: tool_requested, user_message, tool_started, tool_finished,
 *             sandbox_result, agent_offline, session_started
 *   produces: security_evaluated, permission_*, tool_blocked, agent_message,
 *             agent_state_changed, warning, audit_event
 */
export class SecurityAgent {
  readonly engine: PermissionEngine;
  readonly audit: AuditLog;
  private readonly bus: EventBus;
  private readonly lang: 'es' | 'en';
  private readonly settleMs: number;
  private state: SecurityState = 'IDLE';
  private unsubs: Array<() => void> = [];
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly now: () => string;

  constructor(opts: SecurityAgentOptions) {
    this.bus = opts.bus;
    this.lang = opts.lang ?? 'es';
    this.settleMs = opts.settle_ms ?? 4000;
    this.now = opts.now ?? nowIso;
    const engineOpts: PermissionEngineOptions = { bus: opts.bus, lang: this.lang, now: this.now };
    if (opts.registry) engineOpts.registry = opts.registry;
    if (opts.pending_timeout_ms !== undefined) engineOpts.pending_timeout_ms = opts.pending_timeout_ms;
    this.engine = new PermissionEngine(engineOpts);
    this.audit = opts.audit ?? new AuditLog({ now: this.now });
  }

  getState(): SecurityState {
    return this.state;
  }

  start(): void {
    if (this.unsubs.length > 0) return;
    this.unsubs.push(
      this.audit.attach(this.bus),
      this.bus.subscribe('session_started', () => this.setState('MONITORING')),
      this.bus.subscribe('tool_requested', (e) => this.onToolRequested(e as TypedEvent<'tool_requested'>)),
      this.bus.subscribe('user_message', (e) => this.onUserMessage(e as TypedEvent<'user_message'>)),
      this.bus.subscribe('tool_finished', (e) => this.onToolFinished(e as TypedEvent<'tool_finished'>)),
      this.bus.subscribe('tool_started', (e) => this.onToolStarted(e as TypedEvent<'tool_started'>)),
      this.bus.subscribe('agent_offline', (e) => this.onAgentOffline(e)),
      this.bus.subscribe('permission_expired', (e) => {
        const p = (e as TypedEvent<'permission_expired'>).payload.permission;
        this.say(e.session_id, 'architect', this.t('expired', p));
        this.setState('WARNING', 'permission expired');
      }),
    );
    this.setState('MONITORING');
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.engine.dispose();
    this.setState('OFFLINE');
  }

  // ---------- handlers ----------

  private onToolRequested(e: TypedEvent<'tool_requested'>): void {
    const req = e.payload;
    this.setState('REVIEWING', `${req.agent}: ${req.tool}`);
    const record = this.engine.request(req);

    switch (record.status) {
      case 'BLOCKED':
        this.setState('BLOCKED', record.operation);
        this.say(e.session_id, req.agent, this.t('blocked', record));
        break;
      case 'PENDING':
        this.setState('PERMISSION_REQUIRED', record.operation);
        // tell the requester + architect (architect relays to the human)
        this.say(e.session_id, req.agent, this.t('required', record), 'permission_required');
        this.say(e.session_id, 'human', record.prompt_for_human, 'permission_prompt');
        break;
      case 'GRANTED':
        this.say(e.session_id, req.agent, this.t('auto_granted', record), 'permission_auto');
        this.settle();
        break;
      default:
        break;
    }
  }

  private onUserMessage(e: TypedEvent<'user_message'>): void {
    const { text, in_reply_to_permission_id } = e.payload;
    const pendingInSession = this.engine.pending(e.session_id);

    // 1. explicit reply to a permission
    let target: PermissionRecord | undefined;
    if (in_reply_to_permission_id) target = this.engine.get(in_reply_to_permission_id);
    // 2. otherwise, if exactly one permission is pending, the human is answering it
    else if (pendingInSession.length === 1) target = pendingInSession[0];

    if (!target) {
      // Several pending and no explicit target: a plain "yes"/"no" is AMBIGUOUS
      // (which one?). Only "stop" is safe to apply to all. Never decide by position.
      if (pendingInSession.length > 1) {
        const interpretation = interpretAuthorization(text);
        if (interpretation.decision === 'CANCELLED') {
          this.engine.cancelAllPending(e.session_id, text, e.payload.channel);
          this.setState('DENIED', 'all pending cancelled');
          this.say(e.session_id, 'all', this.t('cancelled_all'));
        } else {
          this.setState('PERMISSION_REQUIRED', 'ambiguous target');
          this.say(e.session_id, 'human', this.t('ambiguous_multi', pendingInSession.length), 'permission_reprompt');
        }
      }
      return; // not an authorization context: ignore (CYAN handles normal user messages)
    }

    if (target.status !== 'PENDING') return;

    const res = this.engine.decideFromTranscript(target.permission_id, text, e.payload.channel);
    if (res.ok) {
      this.afterDecision(e.session_id, res.permission);
    } else if (res.interpretation?.decision === 'AMBIGUOUS') {
      this.setState('PERMISSION_REQUIRED', 'ambiguous answer');
      // the reprompt already went out as permission_clarification_needed; also speak it
      const reprompt = this.lang === 'es'
        ? `No escuché una autorización clara. Responde sí, no o stop.`
        : `I did not hear a clear authorization. Say yes, no or stop.`;
      this.say(e.session_id, 'human', reprompt, 'permission_reprompt');
    }
  }

  private afterDecision(session_id: string, p: PermissionRecord): void {
    if (p.status === 'GRANTED') {
      this.setState('AUTHORIZED', p.operation);
      this.say(session_id, p.agent, this.t('granted', p), 'permission_granted');
    } else if (p.status === 'DENIED') {
      this.setState('DENIED', p.operation);
      this.say(session_id, p.agent, this.t('denied', p), 'permission_denied');
    } else if (p.status === 'CANCELLED') {
      this.setState('DENIED', p.operation);
      this.say(session_id, p.agent, this.t('cancelled', p), 'permission_cancelled');
    }
    this.settle();
  }

  private onToolStarted(e: TypedEvent<'tool_started'>): void {
    // Enforcement check: did anyone start a tool that was not authorized?
    const p = this.engine.getByRequest(e.payload.request_id);
    const authorized = p !== undefined && p.status === 'GRANTED';
    if (!authorized) {
      this.setState('WARNING', 'unauthorized tool start');
      this.warn(e.session_id, 'UNAUTHORIZED_TOOL_START', `tool_started for ${e.payload.tool} (${e.payload.request_id}) without a GRANTED permission`, {
        request_id: e.payload.request_id,
        tool: e.payload.tool,
        permission_status: p?.status ?? 'NONE',
      });
      this.say(e.session_id, 'all', this.t('unauthorized', e.payload.tool));
    }
  }

  private onToolFinished(e: TypedEvent<'tool_finished'>): void {
    if (e.payload.status === 'unavailable') {
      this.setState('WARNING', `${e.payload.tool} unavailable`);
      this.say(e.session_id, 'architect', this.t('unavailable', e.payload.tool), 'capability_unavailable');
      this.settle();
    } else if (e.payload.status === 'failure') {
      this.setState('WARNING', `${e.payload.tool} failed`);
      this.settle();
    }
  }

  private onAgentOffline(e: WaspEvent): void {
    const payload = (e.payload ?? {}) as { agent?: string };
    this.setState('WARNING', `${payload.agent ?? 'agent'} offline`);
    this.say(e.session_id, 'architect', this.t('offline', payload.agent ?? 'an agent'), 'agent_offline');
    this.settle();
  }

  // ---------- output ----------

  private setState(state: SecurityState, detail?: string): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
    this.state = state;
    const payload: WaspEventPayloads['agent_state_changed'] = { agent: 'security', state };
    if (detail !== undefined) payload.detail = detail;
    this.emit('agent_state_changed', '', payload);
  }

  private settle(): void {
    if (this.settleMs <= 0) return;
    this.settleTimer = setTimeout(() => {
      if (this.engine.pending().length > 0) this.setState('PERMISSION_REQUIRED');
      else this.setState('MONITORING');
    }, this.settleMs);
    (this.settleTimer as { unref?: () => void }).unref?.();
  }

  private say(session_id: string, to: AgentMessagePayload['to'], message: string, kind?: string): void {
    const payload: AgentMessagePayload = { from: 'security', to, message, speak: true };
    if (kind !== undefined) payload.kind = kind;
    this.emit('agent_message', session_id, payload);
  }

  private warn(session_id: string, code: string, message: string, detail?: Record<string, unknown>): void {
    const payload: WaspEventPayloads['warning'] = { code, message };
    if (detail !== undefined) payload.detail = detail;
    this.emit('warning', session_id, payload);
  }

  private emit<T extends keyof WaspEventPayloads>(type: T, session_id: string, payload: WaspEventPayloads[T]): void {
    const event: WaspEvent<T, WaspEventPayloads[T]> = {
      event_id: newId('evt'),
      type,
      session_id,
      source: 'security',
      timestamp: this.now(),
      payload,
    };
    void this.bus.publish(event as WaspEvent);
  }

  // ---------- spoken lines (short: detail goes on screen, not in audio) ----------

  private t(key: string, arg?: PermissionRecord | ToolRequest | string | number): string {
    const p = arg as PermissionRecord;
    const es = this.lang === 'es';
    switch (key) {
      case 'required':
        return es
          ? `Autorización humana requerida. Operación "${p.operation}", riesgo ${p.risk_level}.`
          : `Human authorization required. Operation "${p.operation}", risk ${p.risk_level}.`;
      case 'granted':
        return es ? `Autorización confirmada. ${cap(p.agent)} puede proceder.` : `Authorization confirmed. ${cap(p.agent)} may proceed.`;
      case 'denied':
        return es ? `Autorización denegada. La operación "${p.operation}" no se ejecutará.` : `Authorization denied. "${p.operation}" will not run.`;
      case 'cancelled':
        return es ? `Operación cancelada por el humano.` : `Operation cancelled by the human.`;
      case 'cancelled_all':
        return es ? `Alto recibido. Todas las operaciones pendientes fueron canceladas.` : `Stop received. All pending operations were cancelled.`;
      case 'blocked':
        return es
          ? `Operación bloqueada. "${p.operation}" es de riesgo crítico y no está permitida en este sistema.`
          : `Operation blocked. "${p.operation}" is critical risk and not permitted in this system.`;
      case 'auto_granted':
        return es ? `Riesgo bajo. "${p.operation}" puede ejecutarse sin aprobación.` : `Low risk. "${p.operation}" may run without approval.`;
      case 'expired':
        return es ? `La solicitud "${p.operation}" expiró sin respuesta.` : `Request "${p.operation}" expired without an answer.`;
      case 'unauthorized':
        return es
          ? `Alerta de seguridad: se inició la herramienta ${String(arg)} sin autorización registrada.`
          : `Security alert: tool ${String(arg)} started without a recorded authorization.`;
      case 'unavailable':
        return es
          ? `La capacidad ${String(arg)} no está disponible. La validación no puede continuar; el laboratorio permanece sin validar.`
          : `${String(arg)} capability is unavailable. Validation cannot proceed; the lab remains unvalidated.`;
      case 'offline':
        return es
          ? `${cap(String(arg))} está desconectado. Sus tareas no pueden considerarse completadas.`
          : `${cap(String(arg))} is offline. Its tasks cannot be considered complete.`;
      case 'ambiguous_multi':
        return es
          ? `Hay ${String(arg)} operaciones pendientes. Indica a cuál respondes, o di "stop" para cancelar todas.`
          : `There are ${String(arg)} pending operations. Say which one you are answering, or "stop" to cancel all.`;
      default:
        return key;
    }
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
