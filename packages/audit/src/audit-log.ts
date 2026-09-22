import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HubClient } from '@wasp/event-bus';
import { newId, nowIso, type AuditEntry } from '@wasp/shared-types';

export interface AuditLogOptions {
  /** append-only JSONL file. optional; memory-only when omitted. The hub already persists audit/<session>.jsonl. */
  file_path?: string;
  now?: () => string;
  /** called for each new entry (e.g. UI refresh) */
  onEntry?: (entry: AuditEntry) => void;
}

export interface AuditFilter {
  agent?: string;
  tool?: string;
  action?: string;
  status?: AuditEntry['status'];
  correlation_id?: string;
}

type PartialEntry = Omit<AuditEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string };

/**
 * GREEN's local, append-only view of the audit stream.
 *
 * The hub is the source of truth: every `audit_event` on the bus is persisted by the hub
 * and kept in SharedContext.audit. This log CONSUMES that stream (attach(hub)) so GREEN can
 * query it (WHO / WHAT / WHY / WHEN / TOOL / AUTHORIZATION / RESULT) and run the validation
 * guard. It never re-emits; entries recorded here directly (record()) are local only.
 */
export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private readonly seen = new Set<string>();
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
    const entry: AuditEntry = { ...partial, id: partial.id ?? newId('aud'), timestamp: partial.timestamp ?? this.now() };
    if (this.seen.has(entry.id)) return entry;
    this.seen.add(entry.id);
    this.entries.push(entry);
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(entry) + '\n', 'utf8');
    this.onEntry?.(entry);
    return entry;
  }

  list(filter: AuditFilter = {}): AuditEntry[] {
    return this.entries.filter(
      (e) =>
        (filter.agent === undefined || e.agent === filter.agent) &&
        (filter.tool === undefined || e.tool === filter.tool) &&
        (filter.action === undefined || e.action === filter.action) &&
        (filter.status === undefined || e.status === filter.status) &&
        (filter.correlation_id === undefined || e.correlation_id === filter.correlation_id),
    );
  }

  size(): number {
    return this.entries.length;
  }

  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join('\n');
  }

  /** Consume every `audit_event` on the hub stream (including the ones GREEN itself emits). */
  attach(hub: Pick<HubClient, 'onAny'>): () => void {
    return hub.onAny((e) => {
      if (e.type === 'audit_event') this.record(e.payload);
    });
  }
}
