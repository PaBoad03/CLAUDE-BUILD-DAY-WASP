import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AuditLog } from '../src/audit-log.ts';
import { canMarkValidated, checkValidationClaim } from '../src/validation-guard.ts';
import type { AuditEntry } from '@wasp/shared-types';

const base = (over: Partial<AuditEntry> = {}): Omit<AuditEntry, 'audit_id' | 'timestamp'> => ({
  session_id: 's1',
  agent: 'operator',
  action: 'ping 127.0.0.1',
  tool: 'sandbox_ping',
  reason: 'validate lab',
  input: { target: '127.0.0.1' },
  result: {},
  status: 'success',
  risk_level: 'LOW',
  approval_required: false,
  approval_status: 'GRANTED',
  ...over,
});

let tmp: string | undefined;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

describe('AuditLog', () => {
  it('records with id + timestamp and filters', () => {
    const log = new AuditLog({ now: () => '2026-09-21T10:00:00.000Z' });
    log.record(base());
    log.record(base({ agent: 'researcher', tool: 'web_research', status: 'info' }));
    expect(log.size()).toBe(2);
    expect(log.list({ agent: 'operator' })).toHaveLength(1);
    expect(log.list({ status: 'info' })[0]!.tool).toBe('web_research');
    const e = log.list()[0]!;
    expect(e.audit_id).toMatch(/^aud_/);
    expect(e.timestamp).toBe('2026-09-21T10:00:00.000Z');
  });

  it('is append-only: list() returns copies of an immutable sequence', () => {
    const log = new AuditLog();
    log.record(base());
    const before = log.toJSONL();
    const list = log.list();
    list.pop();
    expect(log.size()).toBe(1);
    expect(log.toJSONL()).toBe(before);
  });

  it('persists JSONL to disk', () => {
    tmp = mkdtempSync(join(tmpdir(), 'wasp-audit-'));
    const file = join(tmp, 'nested', 'session.audit.jsonl');
    const log = new AuditLog({ file_path: file });
    log.record(base());
    log.record(base({ status: 'failure' }));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!).status).toBe('failure');
  });

  it('calls onEntry so the hub can mirror into SharedContext.audit', () => {
    const mirrored: AuditEntry[] = [];
    const log = new AuditLog({ onEntry: (e) => mirrored.push(e) });
    log.record(base());
    expect(mirrored).toHaveLength(1);
  });
});

describe('validation guard', () => {
  it('needs a successful sandbox entry for the same session', () => {
    const log = new AuditLog();
    expect(canMarkValidated(log.list(), 's1')).toBe(false);
    log.record(base({ status: 'failure' }));
    expect(canMarkValidated(log.list(), 's1')).toBe(false);
    log.record(base({ session_id: 's2' }));
    expect(canMarkValidated(log.list(), 's1')).toBe(false);
    log.record(base());
    expect(canMarkValidated(log.list(), 's1')).toBe(true);
  });

  it('rejects a validated=true claim without evidence and accepts with it', () => {
    const log = new AuditLog();
    expect(checkValidationClaim({ lab: { validated: true } }, log.list(), 's1').ok).toBe(false);
    expect(checkValidationClaim({ lab: { validated: false } }, log.list(), 's1').ok).toBe(true);
    expect(checkValidationClaim(undefined, log.list(), 's1').ok).toBe(true);
    log.record(base());
    expect(checkValidationClaim({ lab: { validated: true } }, log.list(), 's1').ok).toBe(true);
  });
});
