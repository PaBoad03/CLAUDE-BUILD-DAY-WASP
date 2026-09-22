import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/registry';
import { ToolExecutor, toSandboxState, toToolResult, labState } from '../src/executor';
import { FakeDriver } from '../src/testing/fake-driver';

function setup() {
  const driver = new FakeDriver();
  const exec = new ToolExecutor(ToolRegistry.load(), driver);
  return { driver, exec };
}

test('docker offline → unavailable, nothing executed, honest summary', async () => {
  const { driver, exec } = setup();
  driver.dockerUp = false;
  const r = await exec.execute({ request_id: 'r1', tool: 'sandbox_ping', args: { target: '127.0.0.1' } });
  assert.equal(r.status, 'unavailable');
  assert.match(r.summary, /Docker capability is unavailable/);
  assert.equal(driver.execLog.length, 0);
});

test('sandbox not created → unavailable', async () => {
  const { driver, exec } = setup();
  const r = await exec.execute({ request_id: 'r2', tool: 'sandbox_ping', args: { target: '127.0.0.1' } });
  assert.equal(r.status, 'unavailable');
  assert.equal(driver.execLog.length, 0);
});

test('docker_sandbox then ping parses packet loss and reports exact argv', async () => {
  const { exec } = setup();
  const c = await exec.execute({ request_id: 'r3', tool: 'docker_sandbox', args: {} });
  assert.equal(c.status, 'success');
  const p = await exec.execute({ request_id: 'r4', tool: 'sandbox_ping', args: { target: '127.0.0.1', count: 3 } });
  assert.equal(p.status, 'success');
  assert.deepEqual(p.command, ['ping', '-c', '3', '-W', '2', '127.0.0.1']);
  assert.equal(p.data.loss_pct, 0);
  assert.equal(p.data.packets_received, 3);
});

test('100% packet loss is a failure, not a success', async () => {
  const { driver, exec } = setup();
  await exec.execute({ request_id: 'r5', tool: 'docker_sandbox', args: {} });
  driver.responses.ping = { exit_code: 1, stdout: '4 packets transmitted, 0 received, 100% packet loss, time 3000ms', stderr: '', timed_out: false };
  const p = await exec.execute({ request_id: 'r6', tool: 'sandbox_ping', args: { target: 'wasp-target' } });
  assert.equal(p.status, 'failure');
  assert.equal(p.data.pass, false);
});

test('rejected args never reach the driver', async () => {
  const { driver, exec } = setup();
  await exec.execute({ request_id: 'r7', tool: 'docker_sandbox', args: {} });
  const execsAfterCreate = driver.execLog.length; // create probes target readiness with nc
  const r = await exec.execute({ request_id: 'r8', tool: 'sandbox_ping', args: { target: '1.1.1.1' } });
  assert.equal(r.status, 'rejected');
  assert.deepEqual(r.command, []);
  assert.equal(driver.execLog.length, execsAfterCreate);
});

test('dns, http, port, ifaces, routes all parse fake output', async () => {
  const { exec } = setup();
  await exec.execute({ request_id: 'c', tool: 'docker_sandbox', args: {} });
  const dns = await exec.execute({ request_id: 'd', tool: 'sandbox_dns', args: { name: 'wasp-target' } });
  assert.equal(dns.status, 'success');
  assert.deepEqual(dns.data.addresses, ['172.18.0.2']);
  const http = await exec.execute({ request_id: 'h', tool: 'sandbox_http', args: { url: 'http://wasp-target/' } });
  assert.equal(http.status, 'success');
  assert.equal(http.data.http_code, 200);
  const port = await exec.execute({ request_id: 'p', tool: 'sandbox_port_check', args: { host: 'wasp-target', port: 80 } });
  assert.equal(port.status, 'success');
  const ifc = await exec.execute({ request_id: 'i', tool: 'sandbox_interfaces', args: {} });
  assert.equal((ifc.data.interfaces as unknown[]).length, 2);
  const rt = await exec.execute({ request_id: 'r', tool: 'sandbox_routes', args: {} });
  assert.equal(rt.data.has_default_route, false);
});

test('sandbox_status reflects driver state', async () => {
  const { driver, exec } = setup();
  const s1 = await exec.execute({ request_id: 's1', tool: 'sandbox_status', args: {} });
  assert.equal(s1.data.container, 'absent');
  await exec.execute({ request_id: 'c', tool: 'docker_sandbox', args: {} });
  const s2 = await exec.execute({ request_id: 's2', tool: 'sandbox_status', args: {} });
  assert.equal(s2.data.container, 'running');
  assert.equal(s2.data.network, 'internal');
  driver.dockerUp = false;
  const s3 = await exec.execute({ request_id: 's3', tool: 'sandbox_status', args: {} });
  assert.equal(s3.status, 'unavailable');
});

test('mapping to the shared contract: SandboxState and ToolResult', async () => {
  const { driver, exec } = setup();
  driver.dockerUp = false;
  let s = toSandboxState(await labState(driver));
  assert.equal(s.available, false);
  assert.equal(s.status, 'OFFLINE');
  assert.match(s.message ?? '', /unavailable/);
  driver.dockerUp = true;
  await exec.execute({ request_id: 'c', tool: 'docker_sandbox', args: {} });
  s = toSandboxState(await labState(driver));
  assert.equal(s.status, 'RUNNING');
  assert.equal(s.network, 'CONTROLLED');
  assert.equal(s.target_available, true);

  const p = await exec.execute({ request_id: 'r4', tool: 'sandbox_ping', args: { target: '127.0.0.1' } });
  const t = toToolResult(p, { permission_id: 'perm_1', stub: true });
  assert.equal(t.tool_id, 'sandbox_ping');
  assert.equal(t.status, 'success');
  assert.deepEqual(t.command, ['ping', '-c', '4', '-W', '2', '127.0.0.1']);
  assert.equal(t.permission_id, 'perm_1');
  assert.equal(t.stub, true);
  assert.equal(t.error, undefined);

  driver.responses.ping = { exit_code: 1, stdout: '', stderr: 'boom', timed_out: true };
  const e = toToolResult(await exec.execute({ request_id: 'r5', tool: 'sandbox_ping', args: { target: '127.0.0.1' } }));
  assert.equal(e.status, 'failure'); // 'error' collapses to failure on the wire, with the reason in error
  assert.ok(e.error);
});
