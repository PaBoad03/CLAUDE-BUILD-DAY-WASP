import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionEngine } from '../src/engine';
import { req } from './policies.test';

describe('PermissionEngine.request', () => {
  it('MEDIUM tool -> AWAITING_HUMAN with a human prompt (permission_required)', () => {
    const e = new PermissionEngine();
    const r = e.request(req());
    assert.equal(r.outcome, 'AWAITING_HUMAN');
    assert.equal(r.record.status, 'AWAITING_HUMAN');
    assert.equal(r.record.risk, 'MEDIUM');
    assert.equal(e.isAuthorized(r.record.permission_id), false);
    assert.match(r.required!.human_prompt, /docker_sandbox/);
    assert.equal(r.required!.approval_required, true);
    assert.equal(r.decision, undefined);
  });

  it('LOW tool -> AUTO_APPROVED by policy (permission_granted, decided_by security)', () => {
    const e = new PermissionEngine();
    const r = e.request(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '127.0.0.1' } }));
    assert.equal(r.outcome, 'AUTO_APPROVED');
    assert.equal(r.decision!.status, 'AUTO_APPROVED');
    assert.equal(r.decision!.decided_by, 'security');
    assert.equal(e.isAuthorized(r.record.permission_id), true);
  });

  it('CRITICAL tool -> BLOCKED (permission_denied) and can never be granted', () => {
    const e = new PermissionEngine();
    const r = e.request(req({ operation: 'host_shell' }));
    assert.equal(r.outcome, 'BLOCKED');
    assert.equal(r.decision!.status, 'BLOCKED');
    const d1 = e.decide(r.record.permission_id, 'YES', 'yes', 'ui');
    assert.equal(d1.ok, false);
    const d2 = e.decideFromTranscript(r.record.permission_id, 'sí', 'voice');
    assert.equal(d2.ok, false);
    assert.equal(d2.clarification, undefined); // nothing to clarify: it is blocked, not pending
    assert.equal(e.get(r.record.permission_id)!.status, 'BLOCKED');
    assert.equal(e.isAuthorized(r.record.permission_id), false);
  });

  it('is idempotent per permission_id', () => {
    const e = new PermissionEngine();
    const p = req();
    const a = e.request(p);
    const b = e.request(p);
    assert.equal(b.outcome, 'DUPLICATE');
    assert.equal(a.record.permission_id, b.record.permission_id);
    assert.equal(e.list().length, 1);
  });
});

describe('PermissionEngine.decide — only humans, only once', () => {
  it('human "sí, procede" via voice grants (permission_granted, decided_by human, raw kept for audit)', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    const r = e.decideFromTranscript(p.permission_id, 'Sí, procede', 'voice');
    assert.equal(r.ok, true);
    assert.equal(r.decision!.status, 'GRANTED');
    assert.equal(r.decision!.decided_by, 'human');
    assert.equal(r.decision!.human_raw, 'Sí, procede');
    assert.equal(e.isAuthorized(p.permission_id), true);
  });

  it('human "no" denies', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    const r = e.decideFromTranscript(p.permission_id, 'no', 'voice');
    assert.equal(r.decision!.status, 'DENIED');
    assert.equal(e.isAuthorized(p.permission_id), false);
  });

  it('human "stop" cancels', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    assert.equal(e.decideFromTranscript(p.permission_id, 'stop', 'voice').decision!.status, 'CANCELLED');
  });

  it('ambiguous speech leaves it AWAITING_HUMAN and returns a clarification prompt', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    const r = e.decideFromTranscript(p.permission_id, 'do what you think', 'voice');
    assert.equal(r.ok, false);
    assert.equal(e.get(p.permission_id)!.status, 'AWAITING_HUMAN');
    assert.equal(e.isAuthorized(p.permission_id), false);
    assert.match(r.clarification!.human_prompt, /docker_sandbox/);
  });

  it('a UI button is trusted when its label is not a phrase; a voice "decision" field is not', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    // voice bridge claims YES but the transcript is ambiguous → still ambiguous
    assert.equal(e.decideFromTranscript(p.permission_id, 'hmm', 'voice', 'YES').ok, false);
    // UI button with an odd label but explicit decision → accepted
    assert.equal(e.decideFromTranscript(p.permission_id, 'APPROVE ✔', 'ui', 'YES').decision!.status, 'GRANTED');
  });

  it('a decision cannot be changed once made (no re-grant after deny)', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    e.decide(p.permission_id, 'NO', 'no', 'ui');
    assert.equal(e.decide(p.permission_id, 'YES', 'yes', 'ui').ok, false);
    assert.equal(e.isAuthorized(p.permission_id), false);
  });

  it('unknown permission ids are rejected', () => {
    const e = new PermissionEngine();
    assert.equal(e.decide('perm_nope', 'YES', 'yes', 'ui').ok, false);
    assert.equal(e.isAuthorized('perm_nope'), false);
  });

  it('cancelAllPending cancels every AWAITING_HUMAN permission', () => {
    const e = new PermissionEngine();
    e.request(req());
    e.request(req({ operation: 'sandbox_network' }));
    e.request(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '127.0.0.1' } })); // auto-approved, untouched
    const cancelled = e.cancelAllPending('stop', 'voice');
    assert.equal(cancelled.length, 2);
    assert.equal(e.pending().length, 0);
    assert.equal(e.list().filter((p) => p.status === 'AUTO_APPROVED').length, 1);
  });

  it('expire moves AWAITING_HUMAN to EXPIRED and nothing can grant it afterwards', () => {
    const e = new PermissionEngine();
    const p = e.request(req()).record;
    const r = e.expire(p.permission_id);
    assert.equal(r.decision!.status, 'EXPIRED');
    assert.equal(r.decision!.decided_by, 'security');
    assert.equal(e.decide(p.permission_id, 'YES', 'yes', 'ui').ok, false);
  });
});
