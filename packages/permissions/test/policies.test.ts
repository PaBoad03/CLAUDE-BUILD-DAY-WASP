import { describe, expect, it } from 'vitest';
import { ToolPolicyRegistry } from '../src/policies.ts';
import { toolRequest } from './helpers.ts';

const reg = new ToolPolicyRegistry();

describe('ToolPolicyRegistry.evaluate', () => {
  it('LOW tools need no approval', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'sandbox_ping', operation: 'ping 127.0.0.1', input: { target: '127.0.0.1' } }));
    expect(ev.risk_level).toBe('LOW');
    expect(ev.approval_required).toBe(false);
    expect(ev.allowed).toBe(true);
  });

  it('docker_sandbox is MEDIUM and needs approval', () => {
    const ev = reg.evaluate(toolRequest());
    expect(ev.risk_level).toBe('MEDIUM');
    expect(ev.approval_required).toBe(true);
    expect(ev.allowed).toBe(true);
  });

  it('unknown tools fail closed: HIGH + approval', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'totally_new_tool' }));
    expect(ev.risk_level).toBe('HIGH');
    expect(ev.approval_required).toBe(true);
    expect(ev.allowed).toBe(true);
    expect(ev.matched_policy).toBe('default');
  });

  it('host_shell is CRITICAL and blocked even though it "requires approval"', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'host_shell', operation: 'dir C:\\' }));
    expect(ev.risk_level).toBe('CRITICAL');
    expect(ev.allowed).toBe(false);
    expect(ev.blocked_reason).toBeTruthy();
  });

  it('escalates a LOW tool to HIGH when input asks for external network', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'sandbox_ping', input: { target: '127.0.0.1', network_access: 'external' } }));
    expect(ev.risk_level).toBe('HIGH');
    expect(ev.approval_required).toBe(true);
  });

  it('escalates when the target is a public host', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'sandbox_ping', input: { target: '8.8.8.8' } }));
    expect(ev.risk_level).toBe('HIGH');
    const ev2 = reg.evaluate(toolRequest({ tool: 'sandbox_http_local', input: { url: 'https://example.com/x' } }));
    expect(ev2.risk_level).toBe('HIGH');
  });

  it('keeps private / lab targets at declared risk', () => {
    for (const target of ['127.0.0.1', 'localhost', '192.168.1.10', '10.0.0.5', 'target.lab', 'http://localhost:8080/health']) {
      const ev = reg.evaluate(toolRequest({ tool: 'sandbox_ping', input: { target } }));
      expect(ev.risk_level, target).toBe('LOW');
    }
  });

  it('blocks host-shell-looking commands smuggled into any tool input', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'sandbox_ping', input: { command: 'powershell -c Remove-Item -Recurse C:\\' } }));
    expect(ev.allowed).toBe(false);
    expect(ev.risk_level).toBe('CRITICAL');
    const ev2 = reg.evaluate(toolRequest({ tool: 'sandbox_dns', input: { cmd: 'rm -rf /' } }));
    expect(ev2.allowed).toBe(false);
    const ev3 = reg.evaluate(toolRequest({ tool: 'sandbox_dns', input: { on_host: true } }));
    expect(ev3.allowed).toBe(false);
  });

  it('blocks a tool requested by an agent that is not allowed to use it', () => {
    const ev = reg.evaluate(toolRequest({ tool: 'docker_sandbox', agent: 'researcher' }));
    expect(ev.allowed).toBe(false);
    expect(ev.rationale).toContain('not allowed');
  });

  it('supports registering new policies (ORANGE can add tools)', () => {
    const r = new ToolPolicyRegistry();
    r.registerPolicy({ tool: 'sandbox_traceroute', risk_level: 'LOW', requires_approval: false, description: 'traceroute inside sandbox' });
    const ev = r.evaluate(toolRequest({ tool: 'sandbox_traceroute', input: { target: '127.0.0.1' } }));
    expect(ev.risk_level).toBe('LOW');
    expect(ev.approval_required).toBe(false);
  });
});
