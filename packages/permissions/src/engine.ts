import type {
  DecisionSource,
  EventBus,
  PermissionRecord,
  PermissionStatus,
  SecurityEvaluation,
  ToolRequest,
  WaspEvent,
  WaspEventPayloads,
  WaspEventType,
} from '@wasp/shared-types';
import { newId, nowIso } from '@wasp/shared-types';
import { ToolPolicyRegistry } from './policies.ts';
import { interpretAuthorization, repromptFor, type VoiceInterpretation } from './voice-authorization.ts';

/**
 * PermissionEngine — the authorization boundary.
 *
 *   THE MODEL PROPOSES.        -> ToolRequest arrives (from any agent)
 *   THE APPLICATION AUTHORIZES -> this class
 *   THE TOOL EXECUTES.         -> ORANGE, only after isAuthorized(request_id)
 *   THE SYSTEM OBSERVES.       -> tool_started / tool_finished events
 *   THE AUDIT RECORDS.         -> @wasp/audit listens to everything above
 *
 * Invariants enforced here (tested in test/engine.test.ts):
 *  - Only a human decision (source voice|ui) can move PENDING -> GRANTED.
 *  - BLOCKED can never become GRANTED.
 *  - A decision on a non-PENDING permission is rejected.
 *  - Ambiguous speech never grants.
 *  - isAuthorized() is the only truth ORANGE should consult before executing.
 */

export interface PermissionEngineOptions {
  bus: EventBus;
  registry?: ToolPolicyRegistry;
  /** ms before a PENDING permission expires. 0 = never. Default 0 (demo: humans are slow). */
  pending_timeout_ms?: number;
  lang?: 'es' | 'en';
  now?: () => string;
}

export interface DecisionResult {
  ok: boolean;
  permission: PermissionRecord;
  interpretation?: VoiceInterpretation;
  error?: string;
}

export class PermissionEngine {
  readonly registry: ToolPolicyRegistry;
  private readonly bus: EventBus;
  private readonly lang: 'es' | 'en';
  private readonly now: () => string;
  private readonly timeoutMs: number;
  private readonly permissions = new Map<string, PermissionRecord>();
  private readonly byRequest = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: PermissionEngineOptions) {
    this.bus = opts.bus;
    this.registry = opts.registry ?? new ToolPolicyRegistry();
    this.lang = opts.lang ?? 'es';
    this.now = opts.now ?? nowIso;
    this.timeoutMs = opts.pending_timeout_ms ?? 0;
  }

  // ---------- read side ----------

  evaluate(request: ToolRequest): SecurityEvaluation {
    return this.registry.evaluate(request);
  }

  get(permission_id: string): PermissionRecord | undefined {
    return this.permissions.get(permission_id);
  }

  getByRequest(request_id: string): PermissionRecord | undefined {
    const pid = this.byRequest.get(request_id);
    return pid ? this.permissions.get(pid) : undefined;
  }

  list(session_id?: string): PermissionRecord[] {
    const all = [...this.permissions.values()];
    return session_id ? all.filter((p) => p.session_id === session_id) : all;
  }

  pending(session_id?: string): PermissionRecord[] {
    return this.list(session_id).filter((p) => p.status === 'PENDING');
  }

  /** The gate. ORANGE must call this right before executing. */
  isAuthorized(request_id: string): boolean {
    const p = this.getByRequest(request_id);
    return p !== undefined && p.status === 'GRANTED';
  }

  // ---------- write side ----------

  /**
   * Register a tool request. Evaluates risk, creates the PermissionRecord and
   * emits security_evaluated + (permission_requested | permission_granted | tool_blocked).
   *
   * Idempotent per request_id.
   */
  request(req: ToolRequest): PermissionRecord {
    const existing = this.getByRequest(req.request_id);
    if (existing) return existing;

    const evaluation = this.evaluate(req);
    const ts = this.now();

    let status: PermissionStatus;
    if (!evaluation.allowed) status = 'BLOCKED';
    else if (evaluation.approval_required) status = 'PENDING';
    else status = 'GRANTED';

    const record: PermissionRecord = {
      permission_id: newId('perm'),
      request_id: req.request_id,
      session_id: req.session_id,
      agent: req.agent,
      tool: req.tool,
      operation: req.operation,
      input: req.input,
      reason: req.reason,
      risk_level: evaluation.risk_level,
      approval_required: evaluation.approval_required,
      status,
      requested_at: ts,
      prompt_for_human: this.promptFor(req, evaluation),
    };

    if (status === 'GRANTED') {
      record.decided_at = ts;
      record.decided_by = 'policy';
      record.decision_source = 'policy';
    } else if (status === 'BLOCKED') {
      record.decided_at = ts;
      record.decided_by = 'policy';
      record.decision_source = 'policy';
    }

    this.permissions.set(record.permission_id, record);
    this.byRequest.set(req.request_id, record.permission_id);

    this.emit('security_evaluated', req.session_id, {
      request_id: req.request_id,
      permission_id: record.permission_id,
      evaluation,
    });

    if (status === 'BLOCKED') {
      this.emit('tool_blocked', req.session_id, {
        request: req,
        risk_level: evaluation.risk_level,
        reason: evaluation.blocked_reason ?? evaluation.rationale,
      });
    } else if (status === 'PENDING') {
      this.emit('permission_requested', req.session_id, { permission: snapshot(record) });
      this.armTimeout(record);
    } else {
      this.emit('permission_granted', req.session_id, { permission: snapshot(record) });
    }

    return snapshot(record);
  }

  /**
   * Apply a HUMAN decision. `source` must be 'voice' or 'ui'.
   * Agents / policy / model must never call this with a forged source; the
   * hub should only route human channels here.
   */
  decide(
    permission_id: string,
    decision: 'GRANTED' | 'DENIED' | 'CANCELLED',
    source: Extract<DecisionSource, 'voice' | 'ui'>,
    transcript: string,
  ): DecisionResult {
    const record = this.permissions.get(permission_id);
    if (!record) {
      return { ok: false, permission: missing(permission_id), error: 'unknown permission_id' };
    }
    if (record.status !== 'PENDING') {
      return { ok: false, permission: snapshot(record), error: `permission is ${record.status}, not PENDING` };
    }
    if (source !== 'voice' && source !== 'ui') {
      return { ok: false, permission: snapshot(record), error: 'only human sources (voice|ui) may decide' };
    }

    this.disarmTimeout(permission_id);
    record.status = decision;
    record.decided_at = this.now();
    record.decided_by = 'human';
    record.decision_source = source;
    record.decision_transcript = transcript;

    const type: WaspEventType =
      decision === 'GRANTED' ? 'permission_granted' : decision === 'DENIED' ? 'permission_denied' : 'permission_cancelled';
    this.emit(type, record.session_id, { permission: snapshot(record) });
    return { ok: true, permission: snapshot(record) };
  }

  /**
   * Interpret a transcript and, if unambiguous, decide. If ambiguous, emits
   * permission_clarification_needed and leaves the permission PENDING.
   */
  decideFromTranscript(permission_id: string, transcript: string, source: 'voice' | 'ui' = 'voice'): DecisionResult {
    const record = this.permissions.get(permission_id);
    if (!record) {
      return { ok: false, permission: missing(permission_id), error: 'unknown permission_id' };
    }
    const interpretation = interpretAuthorization(transcript);

    if (interpretation.decision === 'AMBIGUOUS') {
      if (record.status === 'PENDING') {
        this.emit('permission_clarification_needed', record.session_id, {
          permission: snapshot(record),
          heard: transcript,
          decision: 'AMBIGUOUS',
          reprompt: repromptFor(record.operation, this.lang),
        });
      }
      return { ok: false, permission: snapshot(record), interpretation, error: 'ambiguous authorization' };
    }

    const map = { AUTHORIZED: 'GRANTED', DENIED: 'DENIED', CANCELLED: 'CANCELLED' } as const;
    const result = this.decide(permission_id, map[interpretation.decision], source, transcript);
    return { ...result, interpretation };
  }

  /** Human said "stop" with no specific permission: cancel everything pending in the session. */
  cancelAllPending(session_id: string, transcript: string, source: 'voice' | 'ui' = 'voice'): PermissionRecord[] {
    return this.pending(session_id).map((p) => this.decide(p.permission_id, 'CANCELLED', source, transcript).permission);
  }

  expire(permission_id: string): DecisionResult {
    const record = this.permissions.get(permission_id);
    if (!record) return { ok: false, permission: missing(permission_id), error: 'unknown permission_id' };
    if (record.status !== 'PENDING') return { ok: false, permission: snapshot(record), error: `permission is ${record.status}` };
    this.disarmTimeout(permission_id);
    record.status = 'EXPIRED';
    record.decided_at = this.now();
    record.decided_by = 'system';
    record.decision_source = 'timeout';
    this.emit('permission_expired', record.session_id, { permission: snapshot(record) });
    return { ok: true, permission: snapshot(record) };
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ---------- internals ----------

  private promptFor(req: ToolRequest, ev: SecurityEvaluation): string {
    const who = req.agent.toUpperCase();
    return this.lang === 'es'
      ? `${who} solicita "${req.operation}" con la herramienta ${req.tool}. Riesgo ${ev.risk_level}. Motivo: ${req.reason}. ¿Autorizas? Responde sí, no o stop.`
      : `${who} requests "${req.operation}" using ${req.tool}. Risk ${ev.risk_level}. Reason: ${req.reason}. Do you authorize? Say yes, no or stop.`;
  }

  private armTimeout(record: PermissionRecord): void {
    if (this.timeoutMs <= 0) return;
    const t = setTimeout(() => this.expire(record.permission_id), this.timeoutMs);
    // don't keep the process alive just for this
    (t as { unref?: () => void }).unref?.();
    this.timers.set(record.permission_id, t);
  }

  private disarmTimeout(permission_id: string): void {
    const t = this.timers.get(permission_id);
    if (t) clearTimeout(t);
    this.timers.delete(permission_id);
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
}

function snapshot(p: PermissionRecord): PermissionRecord {
  return { ...p, input: { ...p.input } };
}

function missing(permission_id: string): PermissionRecord {
  return {
    permission_id,
    request_id: '',
    session_id: '',
    agent: 'security',
    tool: '',
    operation: '',
    input: {},
    reason: '',
    risk_level: 'CRITICAL',
    approval_required: true,
    status: 'BLOCKED',
    requested_at: '',
    prompt_for_human: '',
  };
}
