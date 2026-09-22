import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeHub } from '@wasp/event-bus/testing';
import type { AuditEntry } from '@wasp/shared-types';
import { AuditLog } from '../src/audit-log';
import { canMarkValidated, checkValidationClaim } from '../src/validation-guard';

const base = (over: Partial<AuditEntry> = {}): Omit<AuditEntry, 'id' | 'timestamp'> => ({
  agent: 'operator',
  action: 'sandbox_ping',
  tool: 'ping',
  reason: 'validate lab',
  input: { target: '127.0.0.1' },
  result: {},
  status: 'success',
  risk_level: 'LOW',
  approval_required: false,
  approval_status: 'AUTO_APPROVED',
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
    assert.equal(log.size(), 2);
    assert.equal(log.list({ agent: 'operator' }).length, 1);
    assert.equal(log.list({ status: 'info' })[0]!.tool, 'web_research');
    const e = log.list()[0]!;
    assert.match(e.id, /^aud_/);
    assert.equal(e.timestamp, '2026-09-21T10:00:00.000Z');
  });

  it('is append-only and de-duplicates by id', () => {
    const log = new AuditLog();
    const e = log.record(base());
    log.record(e);
    const list = log.list();
    list.pop();
    assert.equal(log.size(), 1);
  });

  it('persists JSONL to disk', () => {
    tmp = mkdtempSync(join(tmpdir(), 'wasp-audit-'));
    const file = join(tmp, 'nested', 'session.audit.jsonl');
    const log = new AuditLog({ file_path: file });
    log.record(base());
    log.record(base({ status: 'failure' }));
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]!).status, 'failure');
  });

  it('attach(hub) consumes every audit_event on the stream', async () => {
    const hub = new FakeHub('security');
    const mirrored: AuditEntry[] = [];
    const log = new AuditLog({ onEntry: (e) => mirrored.push(e) });
    const off = log.attach(hub);
    await hub.deliver('audit_event', { id: 'aud_1', timestamp: '2026-09-21T10:00:00.000Z', ...base() }, 'operator');
    await hub.deliver('warning', { message: 'not an audit event' }, 'operator');
    assert.equal(log.size(), 1);
    assert.equal(mirrored.length, 1);
    off();
    await hub.deliver('audit_event', { id: 'aud_2', timestamp: '2026-09-21T10:00:01.000Z', ...base() }, 'operator');
    assert.equal(log.size(), 1);
  });
});

describe('validation guard', () => {
  it('needs a real successful sandbox test entry', () => {
    const log = new AuditLog();
    assert.equal(canMarkValidated(log.list()), false);
    log.record(base({ status: 'failure' }));
    assert.equal(canMarkValidated(log.list()), false);
    log.record(base({ stub: true }));
    assert.equal(canMarkValidated(log.list()), false);
    log.record(base({ action: 'docker_sandbox', tool: 'docker_sandbox' }));
    assert.equal(canMarkValidated(log.list()), false);
    log.record(base());
    assert.equal(canMarkValidated(log.list()), true);
  });

  it('rejects a validated=true claim without evidence and accepts with it', () => {
    const log = new AuditLog();
    assert.equal(checkValidationClaim({ lab: { validated: true } }, log.list()).ok, false);
    assert.equal(checkValidationClaim({ lab: { validated: false } }, log.list()).ok, true);
    assert.equal(checkValidationClaim(undefined, log.list()).ok, true);
    log.record(base());
    assert.equal(checkValidationClaim({ lab: { validated: true } }, log.list()).ok, true);
  });
});
