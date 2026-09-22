import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../src/registry.js';

const reg = ToolRegistry.load();

test('registry loads schemas/tools.json with every tool having a valid risk', () => {
  assert.ok(reg.list().length >= 8);
  for (const t of reg.list()) assert.ok(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(t.risk), t.name);
});

test('risky tools are flagged requires_approval', () => {
  assert.equal(reg.get('sandbox_create')!.requires_approval, true);
  assert.equal(reg.get('sandbox_network_external')!.requires_approval, true);
  assert.equal(reg.get('sandbox_network_external')!.risk, 'HIGH');
  assert.equal(reg.get('sandbox_ping')!.requires_approval, false);
});

test('allowlisted args pass and defaults apply', () => {
  const v = reg.validate('sandbox_ping', { target: '127.0.0.1' });
  assert.deepEqual(v, { ok: true, args: { target: '127.0.0.1', count: 4 } });
});

test('off-list target is rejected', () => {
  const v = reg.validate('sandbox_ping', { target: '8.8.8.8' });
  assert.equal(v.ok, false);
  assert.match((v as { errors: string[] }).errors[0], /not in the allowlist/);
});

test('shell metacharacters are rejected even before the allowlist', () => {
  const v = reg.validate('sandbox_ping', { target: '127.0.0.1; rm -rf /' });
  assert.equal(v.ok, false);
  assert.match((v as { errors: string[] }).errors[0], /disallowed characters/);
});

test('unexpected argument keys are rejected, not ignored', () => {
  const v = reg.validate('sandbox_ping', { target: '127.0.0.1', flags: '-f' });
  assert.equal(v.ok, false);
  assert.match((v as { errors: string[] }).errors[0], /unexpected argument/);
});

test('integer bounds enforced', () => {
  assert.equal(reg.validate('sandbox_ping', { target: 'localhost', count: 99 }).ok, false);
  assert.equal(reg.validate('sandbox_ping', { target: 'localhost', count: '3' }).ok, true);
  assert.equal(reg.validate('sandbox_port_check', { host: 'wasp-target', port: 31337 }).ok, false);
});

test('unknown tool is rejected', () => {
  assert.equal(reg.validate('host_shell', { cmd: 'whoami' }).ok, false);
});
