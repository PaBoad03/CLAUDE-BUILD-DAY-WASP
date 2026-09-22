import { nowIso, type HumanDecision, type PermissionDecision, type PermissionEvaluation, type PermissionRequest, type PermissionStatus } from '@wasp/shared-types';
import { ToolPolicyRegistry } from './policies';
import { interpretAuthorization, repromptFor, type VoiceInterpretation } from './voice-authorization';
import type { SecurityEvaluation, SecurityRecord } from './types';

/**
 * PermissionEngine — the authorization boundary. Pure application logic, no I/O:
 * it returns what happened and which shared-contract payloads to emit; SecurityAgent puts them on the hub.
 *
 *   THE MODEL PROPOSES.        -> PermissionRequest arrives (from any agent)
 *   THE APPLICATION AUTHORIZES -> this class
 *   THE TOOL EXECUTES.         -> ORANGE, only after permission_granted
 *   THE SYSTEM OBSERVES.       -> tool_started / tool_finished events
 *   THE AUDIT RECORDS.         -> audit_event (hub persists) + @wasp/audit
 *
 * Invariants (tested in test/engine.test.ts):
 *  - Only a human decision (YES via voice/ui/cli) can move AWAITING_HUMAN -> GRANTED.
 *  - BLOCKED can never become GRANTED.
 *  - A decision on a non-pending permission is rejected.
 *  - Ambiguous speech never grants.
 *  - LOW risk is AUTO_APPROVED by policy and still recorded.
 */

export interface PermissionEngineOptions {
  registry?: ToolPolicyRegistry;
  lang?: 'es' | 'en';
  now?: () => string;
}

export type RequestOutcome = 'BLOCKED' | 'AWAITING_HUMAN' | 'AUTO_APPROVED' | 'DUPLICATE';

export interface RequestResult {
  outcome: RequestOutcome;
  record: SecurityRecord;
  /** BLOCKED (as permission_denied) or AUTO_APPROVED (as permission_granted). */
  decision?: PermissionDecision;
  /** AWAITING_HUMAN: what CYAN must ask the human (permission_required). */
  required?: PermissionEvaluation;
}

export interface DecisionResult {
  ok: boolean;
  record: SecurityRecord | undefined;
  decision?: PermissionDecision;
  interpretation?: VoiceInterpretation;
  /** Set when the answer was ambiguous: what to say to re-ask (permission_clarification_needed). */
  clarification?: { permission_id: string; human_prompt: string };
  error?: string;
}

const GRANTING: PermissionStatus[] = ['GRANTED', 'AUTO_APPROVED'];

export class PermissionEngine {
  readonly registry: ToolPolicyRegistry;
  private readonly lang: 'es' | 'en';
  private readonly now: () => string;
  private readonly records = new Map<string, SecurityRecord>();

  constructor(opts: PermissionEngineOptions = {}) {
    this.registry = opts.registry ?? new ToolPolicyRegistry();
    this.lang = opts.lang ?? 'es';
    this.now = opts.now ?? nowIso;
  }

  // ---------- read side ----------

  evaluate(request: PermissionRequest): SecurityEvaluation {
    return this.registry.evaluate(request);
  }

  get(permission_id: string): SecurityRecord | undefined {
    const r = this.records.get(permission_id);
    return r ? snapshot(r) : undefined;
  }

  list(): SecurityRecord[] {
    return [...this.records.values()].map(snapshot);
  }

  pending(): SecurityRecord[] {
    return this.list().filter((p) => p.status === 'AWAITING_HUMAN');
  }

  /** The gate. A tool may run only if its permission is GRANTED (human) or AUTO_APPROVED (LOW policy). */
  isAuthorized(permission_id: string): boolean {
    const p = this.records.get(permission_id);
    return p !== undefined && GRANTING.includes(p.status);
  }

  // ---------- write side ----------

  /** Register a request. Evaluates risk and decides whether a human is needed. Idempotent per permission_id. */
  request(req: PermissionRequest): RequestResult {
    const existing = this.records.get(req.permission_id);
    if (existing) return { outcome: 'DUPLICATE', record: snapshot(existing) };

    const evaluation = this.evaluate(req);
    const ts = this.now();
    const status: PermissionStatus = !evaluation.allowed ? 'BLOCKED' : evaluation.approval_required ? 'AWAITING_HUMAN' : 'AUTO_APPROVED';
    const human_prompt = this.promptFor(req, evaluation);

    const record: SecurityRecord = {
      ...req,
      status,
      risk: evaluation.risk_level,
      approval_required: evaluation.approval_required,
      human_prompt,
      rationale: evaluation.rationale,
      requested_at: ts,
      evaluation,
    };
    if (status !== 'AWAITING_HUMAN') {
      record.decided_at = ts;
      record.decided_by = 'security';
    }
    this.records.set(req.permission_id, record);

    if (status === 'BLOCKED') {
      return { outcome: 'BLOCKED', record: snapshot(record), decision: this.toDecision(record, evaluation.blocked_reason ?? evaluation.rationale) };
    }
    if (status === 'AUTO_APPROVED') {
      return { outcome: 'AUTO_APPROVED', record: snapshot(record), decision: this.toDecision(record, evaluation.rationale) };
    }
    return {
      outcome: 'AWAITING_HUMAN',
      record: snapshot(record),
      required: { permission_id: req.permission_id, operation: req.operation, risk: evaluation.risk_level, approval_required: true, human_prompt, rationale: evaluation.rationale },
    };
  }

  /**
   * Apply a HUMAN decision (already interpreted as YES / NO / STOP).
   * Only AWAITING_HUMAN permissions can be decided; BLOCKED never changes.
   */
  decide(permission_id: string, decision: Exclude<HumanDecision, 'AMBIGUOUS'>, raw: string, channel: string): DecisionResult {
    const record = this.records.get(permission_id);
    if (!record) return { ok: false, record: undefined, error: 'unknown permission_id' };
    if (record.status !== 'AWAITING_HUMAN') return { ok: false, record: snapshot(record), error: `permission is ${record.status}, not AWAITING_HUMAN` };

    record.status = decision === 'YES' ? 'GRANTED' : decision === 'NO' ? 'DENIED' : 'CANCELLED';
    record.decided_at = this.now();
    record.decided_by = 'human';
    record.human_raw = raw;
    record.rationale = `${record.evaluation.rationale}; human said "${raw}" via ${channel}`;
    return { ok: true, record: snapshot(record), decision: this.toDecision(record, record.rationale) };
  }

  /**
   * Interpret a transcript and, if unambiguous, decide. If ambiguous, returns a clarification prompt
   * and leaves the permission AWAITING_HUMAN. `explicit` (a UI button) is trusted only when the raw
   * text itself is ambiguous and the channel is 'ui'.
   */
  decideFromTranscript(permission_id: string, raw: string, channel: string, explicit?: HumanDecision): DecisionResult {
    const record = this.records.get(permission_id);
    if (!record) return { ok: false, record: undefined, error: 'unknown permission_id' };
    const interpretation = interpretAuthorization(raw);
    let final: HumanDecision = interpretation.decision;
    if (final === 'AMBIGUOUS' && channel === 'ui' && explicit && explicit !== 'AMBIGUOUS') final = explicit;

    if (final === 'AMBIGUOUS') {
      const clarification = record.status === 'AWAITING_HUMAN' ? { permission_id, human_prompt: repromptFor(record.operation, this.lang) } : undefined;
      return { ok: false, record: snapshot(record), interpretation, clarification, error: 'ambiguous authorization' };
    }
    return { ...this.decide(permission_id, final, raw, channel), interpretation };
  }

  /** Human said "stop" with no specific permission: cancel everything pending. */
  cancelAllPending(raw: string, channel: string): PermissionDecision[] {
    return this.pending()
      .map((p) => this.decide(p.permission_id, 'STOP', raw, channel).decision)
      .filter((d): d is PermissionDecision => d !== undefined);
  }

  /** Nobody answered in time. */
  expire(permission_id: string): DecisionResult {
    const record = this.records.get(permission_id);
    if (!record) return { ok: false, record: undefined, error: 'unknown permission_id' };
    if (record.status !== 'AWAITING_HUMAN') return { ok: false, record: snapshot(record), error: `permission is ${record.status}` };
    record.status = 'EXPIRED';
    record.decided_at = this.now();
    record.decided_by = 'security';
    record.rationale = 'timeout: no human answer';
    return { ok: true, record: snapshot(record), decision: this.toDecision(record, record.rationale) };
  }

  // ---------- internals ----------

  private toDecision(r: SecurityRecord, rationale: string): PermissionDecision {
    return {
      permission_id: r.permission_id,
      operation: r.operation,
      requested_by: r.requested_by,
      status: r.status,
      risk: r.risk ?? r.evaluation.risk_level,
      approval_required: r.approval_required ?? true,
      decided_by: r.decided_by ?? 'security',
      human_raw: r.human_raw,
      rationale,
      decided_at: r.decided_at ?? this.now(),
    };
  }

  private promptFor(req: PermissionRequest, ev: SecurityEvaluation): string {
    const who = req.requested_by.toUpperCase();
    return this.lang === 'es'
      ? `${who} solicita "${req.operation}". Riesgo ${ev.risk_level}. Motivo: ${req.reason}. ¿Autorizas? Responde sí, no o stop.`
      : `${who} requests "${req.operation}". Risk ${ev.risk_level}. Reason: ${req.reason}. Do you authorize? Say yes, no or stop.`;
  }
}

function snapshot(p: SecurityRecord): SecurityRecord {
  return { ...p, input: p.input ? { ...p.input } : undefined, evaluation: { ...p.evaluation } };
}
