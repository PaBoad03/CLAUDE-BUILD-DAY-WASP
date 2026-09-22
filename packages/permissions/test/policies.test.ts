import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PermissionRequest } from '@wasp/shared-types';
import { ToolPolicyRegistry } from '../src/policies';

let n = 0;
export function req(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return { permission_id: `perm_${++n}`, requested_by: 'operator', operation: 'docker_sandbox', reason: 'validate the network workshop lab', proposed_risk: 'MEDIUM', input: { network: 'CONTROLLED' }, ...over };
}

const reg = new ToolPolicyRegistry();

describe('ToolPolicyRegistry.evaluate', () => {
  it('LOW tools need no approval', () => {
    const ev = reg.evaluate(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '127.0.0.1' } }));
    assert.equal(ev.risk_level, 'LOW');
    assert.equal(ev.approval_required, false);
    assert.equal(ev.allowed, true);
  });

  it('docker_sandbox is MEDIUM and needs approval', () => {
    const ev = reg.evaluate(req());
    assert.equal(ev.risk_level, 'MEDIUM');
    assert.equal(ev.approval_required, true);
    assert.equal(ev.allowed, true);
  });

  it('unknown tools fail closed: HIGH + approval', () => {
    const ev = reg.evaluate(req({ operation: 'totally_new_tool', proposed_risk: undefined }));
    assert.equal(ev.risk_level, 'HIGH');
    assert.equal(ev.approval_required, true);
    assert.equal(ev.allowed, true);
    assert.equal(ev.matched_policy, 'default');
  });

  it('host_shell is CRITICAL and blocked even though it "requires approval"', () => {
    const ev = reg.evaluate(req({ operation: 'host_shell' }));
    assert.equal(ev.risk_level, 'CRITICAL');
    assert.equal(ev.allowed, false);
    assert.ok(ev.blocked_reason);
  });

  it('the requester can raise its own risk estimate but never lower it', () => {
    assert.equal(reg.evaluate(req({ operation: 'sandbox_ping', proposed_risk: 'HIGH', input: { target: '127.0.0.1' } })).risk_level, 'HIGH');
    assert.equal(reg.evaluate(req({ operation: 'docker_sandbox', proposed_risk: 'LOW' })).risk_level, 'MEDIUM');
  });

  it('escalates a LOW tool to HIGH when input asks for external network', () => {
    const ev = reg.evaluate(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '127.0.0.1', network_access: 'external' } }));
    assert.equal(ev.risk_level, 'HIGH');
    assert.equal(ev.approval_required, true);
  });

  it('escalates when the target is a public host', () => {
    assert.equal(reg.evaluate(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '8.8.8.8' } })).risk_level, 'HIGH');
    assert.equal(reg.evaluate(req({ operation: 'sandbox_http', proposed_risk: 'LOW', input: { url: 'https://example.com/x' } })).risk_level, 'HIGH');
  });

  it('keeps private / lab targets at declared risk', () => {
    for (const target of ['127.0.0.1', 'localhost', '192.168.1.10', '10.0.0.5', 'target.lab', 'wasp-target', 'http://localhost:8080/health', 'http://wasp-target/']) {
      const ev = reg.evaluate(req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target } }));
      assert.equal(ev.risk_level, 'LOW', target);
    }
  });

  it('blocks host-shell-looking commands smuggled into any tool input', () => {
    assert.equal(reg.evaluate(req({ operation: 'sandbox_ping', input: { command: 'powershell -c Remove-Item -Recurse C:\\' } })).allowed, false);
    assert.equal(reg.evaluate(req({ operation: 'sandbox_dns', input: { cmd: 'rm -rf /' } })).allowed, false);
    assert.equal(reg.evaluate(req({ operation: 'sandbox_dns', input: { on_host: true } })).allowed, false);
  });

  it('blocks a tool requested by an agent that is not allowed to use it', () => {
    const ev = reg.evaluate(req({ operation: 'docker_sandbox', requested_by: 'researcher' }));
    assert.equal(ev.allowed, false);
    assert.match(ev.rationale, /not allowed/);
  });

  it('merges ORANGE tools_registered: adds unknown tools, escalates but never lowers known ones', () => {
    const r = new ToolPolicyRegistry();
    r.registerFromToolDefinitions([
      { id: 'sandbox_traceroute', description: 'traceroute inside sandbox', owner: 'operator', risk: 'LOW', requires_approval: false, input_schema: {}, available: true },
      { id: 'docker_sandbox', description: 'create sandbox', owner: 'operator', risk: 'LOW', requires_approval: false, input_schema: {}, available: true }, // ORANGE says LOW: ignored
      { id: 'sandbox_port_check', description: 'nc', owner: 'operator', risk: 'HIGH', requires_approval: true, input_schema: {}, available: true }, // ORANGE says HIGH: escalated
      { id: 'host_shell', description: 'shell', owner: 'operator', risk: 'LOW', requires_approval: false, input_schema: {}, available: true }, // blocked stays blocked
    ]);
    assert.equal(r.evaluate(req({ operation: 'sandbox_traceroute', proposed_risk: 'LOW', input: { target: '127.0.0.1' } })).risk_level, 'LOW');
    assert.equal(r.evaluate(req({ operation: 'docker_sandbox' })).risk_level, 'MEDIUM');
    assert.equal(r.evaluate(req({ operation: 'sandbox_port_check', input: { host: 'wasp-target', port: 80 } })).risk_level, 'HIGH');
    assert.equal(r.evaluate(req({ operation: 'host_shell' })).allowed, false);
  });
});
