import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeHub } from '@wasp/event-bus/testing';
import { newId, nowIso, type PermissionDecision, type PermissionRequest, type ToolResult, type ValidationResult } from '@wasp/shared-types';
import { FakeDriver, ToolRegistry } from '@wasp/tools';
import { OperatorAgent } from '../src/agent';

/** A GREEN that answers every permission_requested the way the test says. */
function green(hub: FakeHub, answer: 'grant' | 'deny' | 'cancel' | 'silent' | ((req: PermissionRequest) => 'grant' | 'deny' | 'cancel' | 'silent')) {
  hub.responder = (evt) => {
    if (evt.type !== 'permission_requested') return;
    const req = evt.payload;
    const a = typeof answer === 'function' ? answer(req) : answer;
    if (a === 'silent') return;
    const status = a === 'grant' ? 'GRANTED' : a === 'deny' ? 'DENIED' : 'CANCELLED';
    const d: PermissionDecision = { permission_id: req.permission_id, operation: req.operation, requested_by: req.requested_by, status, risk: req.proposed_risk ?? 'MEDIUM', approval_required: true, decided_by: 'human', human_raw: a === 'grant' ? 'yes' : 'no', decided_at: nowIso() };
    return hub.from('security', a === 'grant' ? 'permission_granted' : a === 'deny' ? 'permission_denied' : 'permission_cancelled', d, { correlation_id: req.permission_id });
  };
}

async function setup(opts: { docker?: boolean; timeoutMs?: number; stub?: boolean } = {}) {
  const hub = new FakeHub('operator');
  const driver = new FakeDriver();
  driver.dockerUp = opts.docker ?? true;
  const agent = new OperatorAgent({ hub, registry: ToolRegistry.load(), driver, permissionTimeoutMs: opts.timeoutMs ?? 200, stub: opts.stub });
  await agent.start();
  return { hub, driver, agent };
}

function toolRequest(hub: FakeHub, tool_id: string, input: Record<string, unknown> = {}) {
  const request_id = newId('tool');
  return { request_id, done: hub.deliver('tool_requested', { tool_id, request_id, requested_by: 'architect', input, reason: 'test' }, 'architect', 'operator') };
}

const lastFinished = (hub: FakeHub, request_id: string): ToolResult => hub.ofType('tool_finished').find((e) => e.payload.request_id === request_id)!.payload;

test('start: registers tools + sandbox_state, face IDLE when Docker is up', async () => {
  const { hub } = await setup();
  const reg = hub.ofType('tools_registered')[0].payload.tools;
  assert.ok(reg.length >= 8);
  assert.equal(reg.find((t) => t.id === 'docker_sandbox')!.requires_approval, true);
  assert.equal(hub.ofType('sandbox_state')[0].payload.available, true);
  assert.deepEqual(hub.states(), ['IDLE']);
});

test('Docker offline: honest sandbox_state OFFLINE, warning, face ERROR, validation_result validated=false', async () => {
  const { hub } = await setup({ docker: false });
  assert.equal(hub.ofType('sandbox_state')[0].payload.status, 'OFFLINE');
  assert.ok(hub.ofType('warning').length >= 1);
  assert.ok(hub.states().includes('ERROR'));
  assert.ok(hub.said().some((m) => /Docker capability is unavailable/.test(m)));
  await hub.deliver('validation_request', { request_id: 'v1', description: 'ping inside sandbox' }, 'architect', 'operator', 'v1');
  const vr = hub.ofType('validation_result')[0];
  assert.equal(vr.payload.validated, false);
  assert.equal(vr.correlation_id, 'v1');
  assert.equal(vr.to, 'architect');
  assert.match(vr.payload.summary, /unavailable/);
  assert.equal(hub.ofType('tool_started').length, 0);
});

test('LOW tool: permission_requested goes to security but execution does not wait for an answer', async () => {
  const { hub, driver } = await setup();
  green(hub, 'silent');
  driver.sandbox = 'running';
  driver.networks = ['wasp-lab'];
  const { request_id, done } = toolRequest(hub, 'sandbox_ping', { target: '127.0.0.1' });
  await done;
  const r = lastFinished(hub, request_id);
  assert.equal(r.status, 'success');
  assert.deepEqual(r.command, ['ping', '-c', '4', '-W', '2', '127.0.0.1']);
  const perm = hub.ofType('permission_requested')[0];
  assert.equal(perm.to, 'security');
  assert.equal(perm.payload.proposed_risk, 'LOW');
  assert.ok(hub.ofType('tool_started').length === 1);
  assert.ok(hub.ofType('sandbox_test').length === 1);
  assert.ok(hub.ofType('sandbox_result').length === 1);
  const audit = hub.ofType('audit_event').at(-1)!.payload;
  assert.equal(audit.status, 'success');
  assert.equal(audit.approval_required, false);
});

test('MEDIUM tool without permission_granted never executes (times out, honest result)', async () => {
  const { hub, driver } = await setup({ timeoutMs: 60 });
  green(hub, 'silent');
  const { request_id, done } = toolRequest(hub, 'docker_sandbox');
  await done;
  const r = lastFinished(hub, request_id);
  assert.equal(r.status, 'rejected');
  assert.equal(driver.sandbox, 'absent');
  assert.equal(hub.ofType('tool_started').length, 0);
  assert.match(r.error ?? '', /No authorization/);
  assert.equal(hub.ofType('audit_event').at(-1)!.payload.approval_status, 'PENDING');
});

test('MEDIUM tool executes only after GREEN grants; permission_id travels with tool_started and the audit', async () => {
  const { hub, driver } = await setup();
  green(hub, 'grant');
  const { request_id, done } = toolRequest(hub, 'docker_sandbox');
  await done;
  const r = lastFinished(hub, request_id);
  assert.equal(r.status, 'success');
  assert.equal(driver.sandbox, 'running');
  const perm = hub.ofType('permission_requested')[0].payload;
  assert.equal(hub.ofType('tool_started')[0].payload.permission_id, perm.permission_id);
  assert.equal(r.permission_id, perm.permission_id);
  assert.equal(hub.ofType('sandbox_started').length, 1);
  const audit = hub.ofType('audit_event').at(-1)!.payload;
  assert.equal(audit.approval_status, 'GRANTED');
  assert.equal(audit.user_authorization, 'yes');
  assert.ok(hub.states().includes('WAITING_FOR_PERMISSION'));
});

test('permission_denied → status denied, nothing runs', async () => {
  const { hub, driver } = await setup();
  green(hub, 'deny');
  const { request_id, done } = toolRequest(hub, 'docker_sandbox');
  await done;
  assert.equal(lastFinished(hub, request_id).status, 'denied');
  assert.equal(driver.sandbox, 'absent');
  assert.equal(hub.ofType('tool_started').length, 0);
  assert.equal(hub.ofType('audit_event').at(-1)!.payload.status, 'denied');
});

test('GREEN offline → approval-requiring tool is not executed and CYAN is told', async () => {
  const { hub, driver } = await setup();
  hub.online.delete('security');
  const { request_id, done } = toolRequest(hub, 'docker_sandbox');
  await done;
  const r = lastFinished(hub, request_id);
  assert.equal(r.status, 'rejected');
  assert.match(r.error ?? '', /Security agent is offline/);
  assert.equal(driver.sandbox, 'absent');
  assert.ok(hub.said().some((m) => /Security is offline/.test(m)));
});

test('unknown tool and off-list args are rejected with no execution', async () => {
  const { hub, driver } = await setup();
  green(hub, 'grant');
  driver.sandbox = 'running';
  const a = toolRequest(hub, 'host_shell', { cmd: 'whoami' });
  await a.done;
  assert.equal(lastFinished(hub, a.request_id).status, 'rejected');
  const b = toolRequest(hub, 'sandbox_ping', { target: '8.8.8.8' });
  await b.done;
  assert.equal(lastFinished(hub, b.request_id).status, 'rejected');
  assert.equal(driver.execLog.length, 0);
});

test('requests addressed to other agents are ignored', async () => {
  const { hub, driver } = await setup();
  driver.sandbox = 'running';
  await hub.deliver('tool_requested', { tool_id: 'sandbox_ping', request_id: 'x', requested_by: 'architect', input: { target: '127.0.0.1' } }, 'architect', 'researcher');
  await hub.settle();
  assert.equal(driver.execLog.length, 0);
  assert.equal(hub.ofType('tool_started').length, 0);
});

test('validation_request: full default plan, validated=true only when every real test passed', async () => {
  const { hub, driver } = await setup();
  green(hub, 'grant');
  await hub.deliver('validation_request', { request_id: 'v1', description: 'ping + dns inside an isolated container', research_ids: ['res1'] }, 'architect', 'operator', 'v1');
  const vr = hub.ofType('validation_result')[0].payload as ValidationResult;
  assert.equal(vr.validated, true);
  assert.deepEqual(vr.tests.map((t) => t.tool_id), ['docker_sandbox', 'sandbox_ping', 'sandbox_dns', 'sandbox_http', 'sandbox_routes']);
  assert.ok(vr.tests.every((t) => t.status === 'success'));
  assert.deepEqual(vr.verifies_research_ids, ['res1']);
  assert.equal(driver.sandbox, 'running');
  // exactly one human-approval round trip (docker_sandbox); the LOW tests were only announced
  assert.equal(hub.ofType('permission_requested').length, 5);
  assert.ok(hub.states().at(-1) === 'SUCCESS');
});

test('validation_request: a failing test stops the plan and validated=false with the reason', async () => {
  const { hub, driver } = await setup();
  green(hub, 'grant');
  driver.responses.ping = { exit_code: 1, stdout: '4 packets transmitted, 0 received, 100% packet loss', stderr: '', timed_out: false };
  await hub.deliver('validation_request', { request_id: 'v2', description: 'x' }, 'architect', 'operator');
  const vr = hub.ofType('validation_result')[0].payload as ValidationResult;
  assert.equal(vr.validated, false);
  assert.deepEqual(vr.tests.map((t) => t.tool_id), ['docker_sandbox', 'sandbox_ping']);
  assert.match(vr.summary, /sandbox_ping → failure/);
  assert.equal(vr.verifies_research_ids, undefined);
});

test('validation_request: denied sandbox → validated=false, no tests executed', async () => {
  const { hub, driver } = await setup();
  green(hub, 'deny');
  await hub.deliver('validation_request', { request_id: 'v3', description: 'x' }, 'architect', 'operator');
  const vr = hub.ofType('validation_result')[0].payload as ValidationResult;
  assert.equal(vr.validated, false);
  assert.equal(vr.tests[0].status, 'denied');
  assert.equal(driver.execLog.length, 0);
});

test('stub mode (fake Docker): everything is marked stub and the lab is never validated', async () => {
  const { hub } = await setup({ stub: true });
  green(hub, 'grant');
  await hub.deliver('validation_request', { request_id: 'v4', description: 'x', tools: ['docker_sandbox', 'sandbox_ping'] }, 'architect', 'operator');
  const vr = hub.ofType('validation_result')[0].payload as ValidationResult;
  assert.equal(vr.validated, false);
  assert.equal(vr.stub, true);
  assert.ok(vr.tests.every((t) => t.stub === true));
  assert.match(vr.summary, /\[stub\]/);
  assert.ok(hub.ofType('audit_event').every((e) => e.payload.stub === true));
});
