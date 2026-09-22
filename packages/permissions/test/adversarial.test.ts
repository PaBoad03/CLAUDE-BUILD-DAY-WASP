/**
 * ADVERSARIAL TESTS — "IMPORTANT TEST" from INSTRUCCIONESJUANDA.md and CONTEXT.md §20/§21.
 *
 * Disable Docker. Ask WASP: "Create and validate the network workshop."
 * WASP must NOT claim success. lab.validated must remain false.
 *
 * These replay, over a FakeHub, the exact event shapes the real ORANGE agent emits
 * (apps/operator/src/agent.ts) and assert what GREEN + the validation guard guarantee,
 * independent of how CYAN builds the WorkshopSpec. The hub reducer is tested separately
 * (apps/hub/src/reducer.test.ts) and enforces the same rule on the shared context.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeHub } from '@wasp/event-bus/testing';
import { emptyWorkshop, nowIso, type AuditEntry, type ToolResult } from '@wasp/shared-types';
import { canMarkValidated, checkValidationClaim } from '@wasp/audit';
import { SecurityAgent } from '../src/security-agent';

const toolResult = (tool_id: string, status: ToolResult['status'], extra: Partial<ToolResult> = {}): ToolResult => ({ tool_id, request_id: `tool_${tool_id}`, status, started_at: nowIso(), finished_at: nowIso(), duration_ms: 1, ...extra });
const orangeAudit = (action: string, status: AuditEntry['status'], extra: Partial<AuditEntry> = {}): AuditEntry => ({ id: `aud_${Math.random()}`, timestamp: nowIso(), agent: 'operator', action, tool: action === 'sandbox_ping' ? 'ping' : action, status, approval_required: false, ...extra });

describe('ADVERSARIAL: Docker offline, user asks to create AND validate', () => {
  it('lab.validated must stay false and GREEN must say validation cannot proceed', async () => {
    const hub = new FakeHub('security');
    const green = new SecurityAgent({ hub, settle_ms: 0 });
    green.start();

    await hub.deliver('user_message', { text: 'WASP, crea y valida el workshop de reconocimiento de red', channel: 'voice' }, 'human');
    // ORANGE (Docker down) as it really behaves:
    await hub.deliver('sandbox_state', { available: false, status: 'OFFLINE', network: 'NONE', message: 'Docker capability is unavailable' }, 'operator');
    await hub.deliver('tool_finished', toolResult('docker_sandbox', 'unavailable', { error: 'error during connect: docker daemon is not running' }), 'operator');
    await hub.deliver('audit_event', orangeAudit('docker_sandbox', 'unavailable', { risk_level: 'MEDIUM', approval_required: true }), 'operator');
    await hub.deliver('validation_result', { request_id: 'v1', validated: false, tests: [], summary: 'Docker capability is unavailable. I cannot validate the laboratory.' }, 'operator', 'architect');

    // GREEN spoke to CYAN about it
    const warning = hub.ofType('agent_message').find((m) => m.payload.intent === 'capability_unavailable');
    assert.ok(warning);
    assert.equal(warning!.to, 'architect');
    assert.match(warning!.payload.message, /docker_sandbox.*no está disponible/i);

    // Nobody may mark validated
    assert.equal(canMarkValidated(green.audit.list()), false);
    const claim = checkValidationClaim({ ...emptyWorkshop(), lab: { description: 'x', validated: true } }, green.audit.list());
    assert.equal(claim.ok, false);
    assert.match(claim.message, /rejected/i);
    assert.equal(checkValidationClaim(emptyWorkshop(), green.audit.list()).ok, true);

    // The audit can answer WHAT ACTUALLY HAPPENED
    const unavailable = green.audit.list({ status: 'unavailable' });
    assert.equal(unavailable.length, 1);
    assert.equal(unavailable[0].action, 'docker_sandbox');
    green.stop();
  });

  it('a validation_result that claims validated=true without a real successful test is rejected loudly', async () => {
    const hub = new FakeHub('security');
    const green = new SecurityAgent({ hub, settle_ms: 0 });
    green.start();
    // stub operator claims success
    await hub.deliver('validation_result', { request_id: 'v2', validated: true, stub: true, tests: [toolResult('sandbox_ping', 'success', { stub: true })], summary: 'stub says ok' }, 'operator', 'architect');
    // someone who is not the operator claims success
    await hub.deliver('validation_result', { request_id: 'v3', validated: true, tests: [toolResult('sandbox_ping', 'success')], summary: 'trust me' }, 'researcher', 'architect');
    // validated with only failed tests
    await hub.deliver('validation_result', { request_id: 'v4', validated: true, tests: [toolResult('sandbox_ping', 'failure')], summary: '?' }, 'operator', 'architect');
    const alerts = hub.ofType('warning').filter((w) => /VALIDATION_CLAIM_WITHOUT_EVIDENCE/.test(w.payload.message));
    assert.equal(alerts.length, 3);
    assert.equal(green.getState(), 'WARNING');

    // a real one passes silently
    await hub.deliver('validation_result', { request_id: 'v5', validated: true, tests: [toolResult('sandbox_ping', 'success')], summary: 'ok' }, 'operator', 'architect');
    assert.equal(hub.ofType('warning').length, 3);
    green.stop();
  });

  it('a workshop_updated claiming lab.validated=true without audit evidence is flagged; with evidence it is not', async () => {
    const hub = new FakeHub('security');
    const green = new SecurityAgent({ hub, settle_ms: 0 });
    green.start();
    const ws = { ...emptyWorkshop(), lab: { description: 'lab', validated: true } };
    await hub.deliver('workshop_updated', { workshop: ws, changed: ['lab'] }, 'architect');
    assert.equal(hub.ofType('warning').length, 1);

    // research FOUND is never evidence; a stub sandbox success is never evidence
    await hub.deliver('audit_event', orangeAudit('sandbox_ping', 'success', { stub: true }), 'operator');
    assert.equal(canMarkValidated(green.audit.list()), false);
    // sandbox creation alone is not evidence that the exercise works
    await hub.deliver('audit_event', orangeAudit('docker_sandbox', 'success'), 'operator');
    assert.equal(canMarkValidated(green.audit.list()), false);
    // a real successful sandbox test IS evidence
    await hub.deliver('audit_event', orangeAudit('sandbox_ping', 'success'), 'operator');
    assert.equal(canMarkValidated(green.audit.list()), true);
    await hub.deliver('workshop_updated', { workshop: ws, changed: ['lab'] }, 'architect');
    assert.equal(hub.ofType('warning').length, 1);
    green.stop();
  });

  it('a failed sandbox test is not evidence', () => {
    assert.equal(canMarkValidated([orangeAudit('sandbox_ping', 'failure')]), false);
    assert.equal(canMarkValidated([orangeAudit('sandbox_dns', 'success')]), true);
  });
});
