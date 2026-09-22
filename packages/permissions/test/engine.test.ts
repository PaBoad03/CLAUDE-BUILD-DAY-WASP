import { describe, expect, it } from 'vitest';
import { PermissionEngine } from '../src/engine.ts';
import { LocalEventBus } from '../src/testing/local-bus.ts';
import { SESSION, fakeNow, toolRequest } from './helpers.ts';

function setup(opts: { timeout?: number } = {}) {
  const bus = new LocalEventBus();
  const engineOpts = { bus, now: fakeNow, ...(opts.timeout !== undefined ? { pending_timeout_ms: opts.timeout } : {}) };
  const engine = new PermissionEngine(engineOpts);
  return { bus, engine };
}

describe('PermissionEngine.request', () => {
  it('MEDIUM tool -> PENDING + permission_requested + security_evaluated', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest());
    expect(p.status).toBe('PENDING');
    expect(p.risk_level).toBe('MEDIUM');
    expect(engine.isAuthorized(p.request_id)).toBe(false);
    expect(bus.ofType('security_evaluated')).toHaveLength(1);
    expect(bus.ofType('permission_requested')).toHaveLength(1);
    expect(p.prompt_for_human).toContain('create_sandbox');
  });

  it('LOW tool -> GRANTED by policy, no human needed', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest({ tool: 'sandbox_ping', input: { target: '127.0.0.1' } }));
    expect(p.status).toBe('GRANTED');
    expect(p.decided_by).toBe('policy');
    expect(engine.isAuthorized(p.request_id)).toBe(true);
    expect(bus.ofType('permission_granted')).toHaveLength(1);
    expect(bus.ofType('permission_requested')).toHaveLength(0);
  });

  it('CRITICAL tool -> BLOCKED + tool_blocked, and can never be granted', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest({ tool: 'host_shell', operation: 'Get-Process' }));
    expect(p.status).toBe('BLOCKED');
    expect(bus.ofType('tool_blocked')).toHaveLength(1);
    const r = engine.decide(p.permission_id, 'GRANTED', 'ui', 'yes');
    expect(r.ok).toBe(false);
    expect(engine.get(p.permission_id)?.status).toBe('BLOCKED');
    expect(engine.isAuthorized(p.request_id)).toBe(false);
    const r2 = engine.decideFromTranscript(p.permission_id, 'sí');
    expect(r2.ok).toBe(false);
    expect(engine.isAuthorized(p.request_id)).toBe(false);
  });

  it('is idempotent per request_id', () => {
    const { bus, engine } = setup();
    const req = toolRequest();
    const a = engine.request(req);
    const b = engine.request(req);
    expect(a.permission_id).toBe(b.permission_id);
    expect(bus.ofType('permission_requested')).toHaveLength(1);
  });
});

describe('PermissionEngine.decide — only humans, only once', () => {
  it('human "yes" via voice grants and emits permission_granted', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest());
    const r = engine.decideFromTranscript(p.permission_id, 'Sí, procede');
    expect(r.ok).toBe(true);
    expect(r.permission.status).toBe('GRANTED');
    expect(r.permission.decided_by).toBe('human');
    expect(r.permission.decision_source).toBe('voice');
    expect(r.permission.decision_transcript).toBe('Sí, procede');
    expect(engine.isAuthorized(p.request_id)).toBe(true);
    expect(bus.ofType('permission_granted')).toHaveLength(1);
  });

  it('human "no" denies', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest());
    const r = engine.decideFromTranscript(p.permission_id, 'no');
    expect(r.permission.status).toBe('DENIED');
    expect(engine.isAuthorized(p.request_id)).toBe(false);
    expect(bus.ofType('permission_denied')).toHaveLength(1);
  });

  it('human "stop" cancels', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest());
    const r = engine.decideFromTranscript(p.permission_id, 'stop');
    expect(r.permission.status).toBe('CANCELLED');
    expect(bus.ofType('permission_cancelled')).toHaveLength(1);
  });

  it('ambiguous speech leaves it PENDING and asks again', () => {
    const { bus, engine } = setup();
    const p = engine.request(toolRequest());
    const r = engine.decideFromTranscript(p.permission_id, 'do what you think');
    expect(r.ok).toBe(false);
    expect(engine.get(p.permission_id)?.status).toBe('PENDING');
    expect(engine.isAuthorized(p.request_id)).toBe(false);
    const clar = bus.ofType('permission_clarification_needed');
    expect(clar).toHaveLength(1);
    expect((clar[0]!.payload as { reprompt: string }).reprompt).toContain('create_sandbox');
  });

  it('a decision cannot be changed once made (no re-grant after deny)', () => {
    const { engine } = setup();
    const p = engine.request(toolRequest());
    engine.decide(p.permission_id, 'DENIED', 'ui', 'no');
    const r = engine.decide(p.permission_id, 'GRANTED', 'ui', 'yes');
    expect(r.ok).toBe(false);
    expect(engine.isAuthorized(p.request_id)).toBe(false);
  });

  it('rejects non-human decision sources', () => {
    const { engine } = setup();
    const p = engine.request(toolRequest());
    // @ts-expect-error — deliberately violating the type to simulate a forged caller
    const r = engine.decide(p.permission_id, 'GRANTED', 'policy', 'model said so');
    expect(r.ok).toBe(false);
    expect(engine.isAuthorized(p.request_id)).toBe(false);
  });

  it('unknown permission ids are rejected', () => {
    const { engine } = setup();
    const r = engine.decide('perm_nope', 'GRANTED', 'ui', 'yes');
    expect(r.ok).toBe(false);
    expect(engine.isAuthorized('req_nope')).toBe(false);
  });

  it('cancelAllPending cancels every PENDING permission in the session', () => {
    const { engine } = setup();
    engine.request(toolRequest());
    engine.request(toolRequest({ tool: 'sandbox_network', operation: 'enable_network' }));
    engine.request(toolRequest({ session_id: 'other' }));
    const cancelled = engine.cancelAllPending(SESSION, 'stop');
    expect(cancelled).toHaveLength(2);
    expect(engine.pending(SESSION)).toHaveLength(0);
    expect(engine.pending('other')).toHaveLength(1);
  });
});

describe('PermissionEngine timeouts', () => {
  it('expires PENDING permissions after the timeout', async () => {
    const { bus, engine } = setup({ timeout: 20 });
    const p = engine.request(toolRequest());
    await new Promise((r) => setTimeout(r, 60));
    expect(engine.get(p.permission_id)?.status).toBe('EXPIRED');
    expect(bus.ofType('permission_expired')).toHaveLength(1);
    const r = engine.decide(p.permission_id, 'GRANTED', 'ui', 'yes');
    expect(r.ok).toBe(false);
    engine.dispose();
  });
});
