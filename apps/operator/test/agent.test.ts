import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, type PermissionDecision, type PermissionRequest, type ToolResult, type WaspEvent } from '@wasp/tools';
import { FakeDriver } from '../../../packages/tools/test/fake-driver.js';
import { InMemoryBus, makeEvent } from '../src/bus.js';
import { OperatorAgent } from '../src/agent.js';
import type { Speaker } from '../src/voice.js';

const SESSION = 'test-session';

class SilentSpeaker implements Speaker {
  spoken: string[] = [];
  async speak(_a: string, t: string) { this.spoken.push(t); }
}

async function setup(opts: { docker?: boolean; timeoutMs?: number } = {}) {
  const bus = new InMemoryBus();
  const driver = new FakeDriver();
  driver.dockerUp = opts.docker ?? true;
  const speaker = new SilentSpeaker();
  const agent = new OperatorAgent({ session_id: SESSION, bus, registry: ToolRegistry.load(), driver, speaker, permissionTimeoutMs: opts.timeoutMs ?? 200 });
  await agent.start();
  await tick();
  return { bus, driver, speaker, agent };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

function request(bus: InMemoryBus, tool: string, args: Record<string, unknown> = {}, type: 'tool_requested' | 'validation_request' = 'tool_requested') {
  const request_id = `req-${tool}-${Math.random().toString(36).slice(2, 7)}`;
  const finished = new Promise<ToolResult>((res) => {
    const un = bus.subscribe((e) => { if (e.type === 'tool_finished' && (e.payload as ToolResult).request_id === request_id) { un(); res(e.payload as ToolResult); } });
  });
  void bus.publish(makeEvent(SESSION, type, 'architect', 'operator', { request_id, tool, args, reason: 'test', requested_by: 'architect' }));
  return { request_id, finished };
}

const types = (bus: InMemoryBus) => bus.log.map((e) => e.type);

test('LOW tool: permission_requested is emitted to security but execution does not wait', async () => {
  const { bus, driver } = await setup();
  driver.sandbox = 'running'; driver.networks = ['wasp-lab'];
  const r = await request(bus, 'sandbox_ping', { target: '127.0.0.1' }).finished;
  assert.equal(r.status, 'success');
  const perm = bus.log.find((e) => e.type === 'permission_requested')!;
  assert.equal(perm.to, 'security');
  assert.equal((perm.payload as PermissionRequest).requires_approval, false);
  assert.ok(types(bus).includes('tool_started'));
  assert.ok(types(bus).includes('audit_event'));
});

test('MEDIUM tool without permission_granted never executes (times out)', async () => {
  const { bus, driver } = await setup({ timeoutMs: 100 });
  const r = await request(bus, 'sandbox_create').finished;
  assert.equal(r.status, 'rejected');
  assert.equal(driver.sandbox, 'absent');
  assert.ok(!types(bus).includes('tool_started'));
  const audit = bus.log.filter((e) => e.type === 'audit_event').at(-1)!.payload as { approval_status: string };
  assert.equal(audit.approval_status, 'timeout');
});

test('MEDIUM tool executes only after GREEN grants with matching request_id', async () => {
  const { bus, driver } = await setup();
  const { request_id, finished } = request(bus, 'sandbox_create');
  await tick();
  assert.equal(driver.sandbox, 'absent', 'must not have started before grant');
  const d: PermissionDecision = { request_id, granted: true, decided_by: 'human', user_authorization: 'yes' };
  await bus.publish(makeEvent(SESSION, 'permission_granted', 'security', 'operator', d));
  const r = await finished;
  assert.equal(r.status, 'success');
  assert.equal(driver.sandbox, 'running');
  assert.ok(types(bus).includes('sandbox_started'));
  const audit = bus.log.filter((e) => e.type === 'audit_event').at(-1)!.payload as { approval_status: string; user_authorization: string };
  assert.equal(audit.approval_status, 'granted');
  assert.equal(audit.user_authorization, 'yes');
});

test('permission_denied → status denied, nothing runs', async () => {
  const { bus, driver } = await setup();
  const { request_id, finished } = request(bus, 'sandbox_create');
  await tick();
  await bus.publish(makeEvent(SESSION, 'permission_denied', 'security', 'operator', { request_id, granted: false, decided_by: 'human', user_authorization: 'no' }));
  const r = await finished;
  assert.equal(r.status, 'denied');
  assert.equal(driver.sandbox, 'absent');
});

test('a grant from anyone other than security is ignored', async () => {
  const { bus, driver } = await setup({ timeoutMs: 150 });
  const { request_id, finished } = request(bus, 'sandbox_create');
  await tick();
  // architect tries to self-authorize
  await bus.publish(makeEvent(SESSION, 'permission_granted', 'architect', 'operator', { request_id, granted: true, decided_by: 'policy' }));
  const r = await finished;
  assert.equal(r.status, 'rejected');
  assert.equal(driver.sandbox, 'absent');
  assert.ok(types(bus).includes('warning'));
});

test('a grant with a different request_id does not unlock a pending request', async () => {
  const { bus, driver } = await setup({ timeoutMs: 150 });
  const { finished } = request(bus, 'sandbox_create');
  await tick();
  await bus.publish(makeEvent(SESSION, 'permission_granted', 'security', 'operator', { request_id: 'someone-elses', granted: true, decided_by: 'human' }));
  const r = await finished;
  assert.equal(r.status, 'rejected');
  assert.equal(driver.sandbox, 'absent');
});

test('Docker offline: agent_started reports it, warning emitted, tools return unavailable, face OFFLINE', async () => {
  const bus = new InMemoryBus();
  const driver = new FakeDriver(); driver.dockerUp = false;
  const faces: string[] = [];
  const agent = new OperatorAgent({ session_id: SESSION, bus, registry: ToolRegistry.load(), driver, speaker: new SilentSpeaker(), onFaceState: (s) => faces.push(s) });
  await agent.start(); await tick();
  const started = bus.log.find((e) => e.type === 'agent_started')!.payload as { sandbox: { docker_available: boolean } };
  assert.equal(started.sandbox.docker_available, false);
  assert.ok(types(bus).includes('warning'));
  assert.ok(faces.includes('OFFLINE'));
  const r = await request(bus, 'sandbox_ping', { target: '127.0.0.1' }).finished;
  assert.equal(r.status, 'unavailable');
  assert.match(r.summary, /Docker capability is unavailable/);
});

test('validation_request produces validation_result with validated=false when the test fails', async () => {
  const { bus, driver } = await setup();
  driver.sandbox = 'running'; driver.networks = ['wasp-lab'];
  driver.responses.curl = { exit_code: 7, stdout: '000 0.000', stderr: 'curl: (7) Failed to connect', timed_out: false };
  const { request_id, finished } = request(bus, 'sandbox_http', { url: 'http://wasp-target/' }, 'validation_request');
  await finished;
  const vr = bus.log.find((e) => e.type === 'validation_result')!;
  assert.equal(vr.to, 'architect');
  const p = vr.payload as { request_id: string; validated: boolean; status: string };
  assert.equal(p.request_id, request_id);
  assert.equal(p.validated, false);
  assert.equal(p.status, 'failure');
});

test('unknown tool and off-list args are rejected with no execution', async () => {
  const { bus, driver } = await setup();
  driver.sandbox = 'running';
  const a = await request(bus, 'host_shell', { cmd: 'whoami' }).finished;
  assert.equal(a.status, 'rejected');
  const b = await request(bus, 'sandbox_ping', { target: '8.8.8.8' }).finished;
  assert.equal(b.status, 'rejected');
  assert.equal(driver.execLog.length, 0);
});

test('requests addressed to other agents are ignored', async () => {
  const { bus, driver } = await setup();
  driver.sandbox = 'running';
  await bus.publish(makeEvent(SESSION, 'tool_requested', 'architect', 'researcher', { request_id: 'x', tool: 'sandbox_ping', args: { target: '127.0.0.1' }, reason: '', requested_by: 'architect' }));
  await tick(); await tick();
  assert.equal(driver.execLog.length, 0);
  assert.ok(!types(bus).includes('tool_started'));
});
