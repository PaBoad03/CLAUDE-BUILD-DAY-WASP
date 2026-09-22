import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  AuditEntry,
  AuditStatus,
  EventBus,
  PermissionRecord,
  TypedEvent,
  WaspEvent,
  WaspEventType,
} from '@wasp/shared-types';
import { newId, nowIso } from '@wasp/shared-types';

export interface AuditLogOptions {
  /** append-only JSONL file. optional; memory-only when omitted. */
  file_path?: string;
  now?: () => string;
  /** called for each new entry (e.g. hub pushes it into SharedContext.audit) */
  onEntry?: (entry: AuditEntry) => void;
}

export interface AuditFilter {
  session_id?: string;
  agent?: string;
  tool?: string;
  status?: AuditStatus;
  request_id?: string;
}

type PartialEntry = Omit<AuditEntry, 'audit_id' | 'timestamp'> & { timestamp?: string };

/**
 * Append-only audit log.
 *
 * Two ways to feed it:
 *  1. record(entry)         — explicit
 *  2. attach(bus)           — derive entries from bus events automatically
 *
 * Entries are never mutated or deleted.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly now: () => string;
  private readonly filePath: string | undefined;
  private readonly onEntry: ((e: AuditEntry) => void) | undefined;

  constructor(opts: AuditLogOptions = {}) {
    this.now = opts.now ?? nowIso;
    this.filePath = opts.file_path;
    this.onEntry = opts.onEntry;
    if (this.filePath) mkdirSync(dirname(this.filePath), { recursive: true });
  }

  record(partial: PartialEntry): AuditEntry {
    const entry: AuditEntry = {
      ...partial,
      audit_id: newId('aud'),
      timestamp: partial.timestamp ?? this.now(),
    };
    this.entries.push(entry);
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    this.onEntry?.(entry);
    return entry;
  }

  list(filter: AuditFilter = {}): AuditEntry[] {
    return this.entries.filter(
      (e) =>
        (filter.session_id === undefined || e.session_id === filter.session_id) &&
        (filter.agent === undefined || e.agent === filter.agent) &&
        (filter.tool === undefined || e.tool === filter.tool) &&
        (filter.status === undefined || e.status === filter.status) &&
        (filter.request_id === undefined || e.request_id === filter.request_id),
    );
  }

  size(): number {
    return this.entries.length;
  }

  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }

  /**
   * Subscribe to the bus and derive audit entries from meaningful events.
   * Returns an unsubscribe function.
   */
  attach(bus: EventBus): () => void {
    const unsubs = [
      bus.subscribe('permission_requested', (e) => this.fromPermission(e as TypedEvent<'permission_requested'>, 'pending_approval', 'permission_requested')),
      bus.subscribe('permission_granted', (e) => this.fromPermission(e as TypedEvent<'permission_granted'>, 'granted', 'permission_granted')),
      bus.subscribe('permission_denied', (e) => this.fromPermission(e as TypedEvent<'permission_denied'>, 'denied', 'permission_denied')),
      bus.subscribe('permission_cancelled', (e) => this.fromPermission(e as TypedEvent<'permission_cancelled'>, 'cancelled', 'permission_cancelled')),
      bus.subscribe('permission_expired', (e) => this.fromPermission(e as TypedEvent<'permission_expired'>, 'cancelled', 'permission_expired')),
      bus.subscribe('permission_clarification_needed', (e) => {
        const ev = e as TypedEvent<'permission_clarification_needed'>;
        const p = ev.payload.permission;
        this.record({
          session_id: ev.session_id,
          agent: 'human',
          action: 'ambiguous_authorization',
          tool: p.tool,
          reason: `heard "${ev.payload.heard}" — not accepted as authorization`,
          input: { heard: ev.payload.heard },
          result: { decision: ev.payload.decision, reprompt: ev.payload.reprompt },
          status: 'warning',
          risk_level: p.risk_level,
          approval_required: p.approval_required,
          approval_status: p.status,
          user_authorization: ev.payload.heard,
          request_id: p.request_id,
          permission_id: p.permission_id,
          source_event_id: ev.event_id,
        });
      }),
      bus.subscribe('tool_blocked', (e) => {
        const ev = e as TypedEvent<'tool_blocked'>;
        const r = ev.payload.request;
        this.record({
          session_id: ev.session_id,
          agent: r.agent,
          action: r.operation,
          tool: r.tool,
          reason: r.reason,
          input: r.input,
          result: { blocked_reason: ev.payload.reason },
          status: 'blocked',
          risk_level: ev.payload.risk_level,
          approval_required: true,
          approval_status: 'BLOCKED',
          request_id: r.request_id,
          source_event_id: ev.event_id,
        });
      }),
      bus.subscribe('tool_started', (e) => {
        const ev = e as TypedEvent<'tool_started'>;
        const p = ev.payload;
        const entry: PartialEntry = {
          session_id: ev.session_id,
          agent: ev.source,
          action: p.operation,
          tool: p.tool,
          reason: 'tool execution started',
          input: p.input,
          result: {},
          status: 'started',
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          request_id: p.request_id,
          source_event_id: ev.event_id,
        };
        if (p.permission_id !== undefined) entry.permission_id = p.permission_id;
        this.record(entry);
      }),
      bus.subscribe('tool_finished', (e) => {
        const ev = e as TypedEvent<'tool_finished'>;
        const p = ev.payload;
        const result: Record<string, unknown> = { ...p.output };
        if (p.error !== undefined) result['error'] = p.error;
        const entry: PartialEntry = {
          session_id: ev.session_id,
          agent: ev.source,
          action: p.operation,
          tool: p.tool,
          reason: 'tool execution finished',
          input: {},
          result,
          status: p.status,
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          request_id: p.request_id,
          source_event_id: ev.event_id,
        };
        if (p.permission_id !== undefined) entry.permission_id = p.permission_id;
        this.record(entry);
      }),
      bus.subscribe('sandbox_result', (e) => {
        const ev = e as WaspEvent<'sandbox_result', Record<string, unknown>>;
        const payload = (ev.payload ?? {}) as Record<string, unknown>;
        const status = normalizeStatus(payload['status']);
        this.record({
          session_id: ev.session_id,
          agent: ev.source,
          action: String(payload['test'] ?? payload['operation'] ?? 'sandbox_result'),
          tool: String(payload['tool'] ?? 'sandbox'),
          reason: 'sandbox test result',
          input: (payload['input'] as Record<string, unknown>) ?? {},
          result: payload,
          status,
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          ...(typeof payload['request_id'] === 'string' ? { request_id: payload['request_id'] } : {}),
          source_event_id: ev.event_id,
        });
      }),
      bus.subscribe('agent_offline', (e) => {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        this.record({
          session_id: e.session_id,
          agent: e.source,
          action: 'agent_offline',
          tool: '',
          reason: String(payload['reason'] ?? 'agent disconnected'),
          input: {},
          result: payload,
          status: 'warning',
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          source_event_id: e.event_id,
        });
      }),
      bus.subscribe('warning', (e) => {
        const ev = e as TypedEvent<'warning'>;
        this.record({
          session_id: ev.session_id,
          agent: ev.source,
          action: ev.payload.code,
          tool: '',
          reason: ev.payload.message,
          input: {},
          result: ev.payload.detail ?? {},
          status: 'warning',
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          source_event_id: ev.event_id,
        });
      }),
      bus.subscribe('error', (e) => {
        const ev = e as TypedEvent<'error'>;
        this.record({
          session_id: ev.session_id,
          agent: ev.source,
          action: ev.payload.code,
          tool: '',
          reason: ev.payload.message,
          input: {},
          result: ev.payload.detail ?? {},
          status: 'failure',
          risk_level: 'NONE',
          approval_required: false,
          approval_status: 'N/A',
          source_event_id: ev.event_id,
        });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }

  private fromPermission(
    ev: WaspEvent<WaspEventType, { permission: PermissionRecord }>,
    status: AuditStatus,
    action: string,
  ): void {
    const p = ev.payload.permission;
    const entry: PartialEntry = {
      session_id: ev.session_id,
      agent: p.agent,
      action: `${action}: ${p.operation}`,
      tool: p.tool,
      reason: p.reason,
      input: p.input,
      result: {
        decided_by: p.decided_by ?? null,
        decision_source: p.decision_source ?? null,
      },
      status,
      risk_level: p.risk_level,
      approval_required: p.approval_required,
      approval_status: p.status,
      request_id: p.request_id,
      permission_id: p.permission_id,
      source_event_id: ev.event_id,
    };
    if (p.decision_transcript !== undefined) entry.user_authorization = p.decision_transcript;
    this.record(entry);
  }
}

function normalizeStatus(v: unknown): AuditStatus {
  const s = String(v ?? '').toLowerCase();
  if (s === 'success' || s === 'pass' || s === 'passed' || s === 'ok') return 'success';
  if (s === 'unavailable' || s === 'offline') return 'unavailable';
  if (s === 'failure' || s === 'fail' || s === 'failed' || s === 'error') return 'failure';
  return 'info';
}
