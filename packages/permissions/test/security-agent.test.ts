import { describe, expect, it } from 'vitest';
import type { TypedEvent } from '@wasp/shared-types';
import { SecurityAgent } from '../src/security-agent.ts';
import { LocalEventBus } from '../src/testing/local-bus.ts';
import { SESSION, event, fakeNow, toolRequest } from './helpers.ts';

function setup() {
  const bus = new LocalEventBus();
  const agent = new SecurityAgent({ bus, now: fakeNow, settle_ms: 0 });
  agent.start();
  return { bus, agent };
}

const spoken = (bus: LocalEventBus) => bus.ofType('agent_message').map((e) => (e as TypedEvent<'agent_message'>).payload);

describe('SecurityAgent — permission flow end to end over the bus', () => {
  it('ORANGE requests sandbox -> GREEN asks -> human says sí -> GREEN confirms', () => {
    const { bus, agent } = setup();
    expect(agent.getState()).toBe('MONITORING');

    const req = toolRequest();
    bus.publish(event('tool_requested', req));

    expect(agent.getState()).toBe('PERMISSION_REQUIRED');
    const pending = agent.engine.pending(SESSION);
    expect(pending).toHaveLength(1);
    const lines = spoken(bus);
    expect(lines.some((l) => l.to === 'operator' && l.kind === 'permission_required')).toBe(true);
    expect(lines.some((l) => l.to === 'human' && l.kind === 'permission_prompt')).toBe(true);

    // human answers by voice (no explicit permission id: exactly one pending)
    bus.publish(event('user_message', { text: 'Sí', channel: 'voice' }, 'human'));

    expect(agent.getState()).toBe('AUTHORIZED');
    expect(agent.engine.isAuthorized(req.request_id)).toBe(true);
    expect(spoken(bus).some((l) => l.kind === 'permission_granted' && l.to === 'operator')).toBe(true);

    // audit reconstructs it
    const audit = agent.audit.list({ session_id: SESSION });
    expect(audit.map((a) => a.status)).toEqual(expect.arrayContaining(['pending_approval', 'granted']));
    const granted = audit.find((a) => a.status === 'granted')!;
    expect(granted.agent).toBe('operator');
    expect(granted.tool).toBe('docker_sandbox');
    expect(granted.user_authorization).toBe('Sí');
    expect(granted.approval_required).toBe(true);
    expect(granted.approval_status).toBe('GRANTED');
    agent.stop();
  });

  it('ambiguous answer keeps PENDING and GREEN re-asks', () => {
    const { bus, agent } = setup();
    const req = toolRequest();
    bus.publish(event('tool_requested', req));
    bus.publish(event('user_message', { text: 'está bien, supongo', channel: 'voice' }, 'human'));
    expect(agent.engine.isAuthorized(req.request_id)).toBe(false);
    expect(agent.getState()).toBe('PERMISSION_REQUIRED');
    expect(spoken(bus).some((l) => l.kind === 'permission_reprompt')).toBe(true);
    expect(bus.ofType('permission_clarification_needed')).toHaveLength(1);
    expect(agent.audit.list({ status: 'warning' })).toHaveLength(1);

    bus.publish(event('user_message', { text: 'no', channel: 'voice' }, 'human'));
    expect(agent.getState()).toBe('DENIED');
    expect(agent.engine.isAuthorized(req.request_id)).toBe(false);
    agent.stop();
  });

  it('explicit in_reply_to_permission_id targets the right permission when several are pending', () => {
    const { bus, agent } = setup();
    const a = toolRequest({ operation: 'create_sandbox' });
    const b = toolRequest({ tool: 'sandbox_network', operation: 'enable_network' });
    bus.publish(event('tool_requested', a));
    bus.publish(event('tool_requested', b));
    const pb = agent.engine.getByRequest(b.request_id)!;
    bus.publish(event('user_message', { text: 'yes', channel: 'ui', in_reply_to_permission_id: pb.permission_id }, 'human'));
    expect(agent.engine.isAuthorized(b.request_id)).toBe(true);
    expect(agent.engine.isAuthorized(a.request_id)).toBe(false);
    agent.stop();
  });

  it('"stop" with several pending cancels all of them', () => {
    const { bus, agent } = setup();
    bus.publish(event('tool_requested', toolRequest()));
    bus.publish(event('tool_requested', toolRequest({ tool: 'sandbox_network', operation: 'enable_network' })));
    bus.publish(event('user_message', { text: 'stop', channel: 'voice' }, 'human'));
    expect(agent.engine.pending(SESSION)).toHaveLength(0);
    expect(bus.ofType('permission_cancelled')).toHaveLength(2);
    agent.stop();
  });

  it('a plain "yes" with several pending does NOT authorize anything', () => {
    const { bus, agent } = setup();
    const a = toolRequest();
    const b = toolRequest({ tool: 'sandbox_network', operation: 'enable_network' });
    bus.publish(event('tool_requested', a));
    bus.publish(event('tool_requested', b));
    bus.publish(event('user_message', { text: 'sí', channel: 'voice' }, 'human'));
    // ambiguous which one: engine must not have granted either
    expect(agent.engine.isAuthorized(a.request_id)).toBe(false);
    expect(agent.engine.isAuthorized(b.request_id)).toBe(false);
    agent.stop();
  });

  it('unrelated user messages are ignored when nothing is pending', () => {
    const { bus, agent } = setup();
    bus.publish(event('user_message', { text: 'WASP, créame un workshop de red', channel: 'voice' }, 'human'));
    expect(agent.engine.list()).toHaveLength(0);
    expect(agent.getState()).toBe('MONITORING');
    agent.stop();
  });

  it('CRITICAL request is BLOCKED and announced', () => {
    const { bus, agent } = setup();
    const req = toolRequest({ tool: 'host_shell', operation: 'Get-ChildItem C:\\Users' });
    bus.publish(event('tool_requested', req));
    expect(agent.getState()).toBe('BLOCKED');
    expect(bus.ofType('tool_blocked')).toHaveLength(1);
    expect(agent.audit.list({ status: 'blocked' })).toHaveLength(1);
    // even a human yes cannot unblock it
    bus.publish(event('user_message', { text: 'sí', channel: 'voice' }, 'human'));
    expect(agent.engine.isAuthorized(req.request_id)).toBe(false);
    agent.stop();
  });
});

describe('SecurityAgent — enforcement & failure honesty', () => {
  it('flags tool_started without a GRANTED permission', () => {
    const { bus, agent } = setup();
    const req = toolRequest();
    bus.publish(event('tool_requested', req)); // PENDING
    bus.publish(event('tool_started', { request_id: req.request_id, tool: req.tool, operation: req.operation, input: req.input }));
    expect(agent.getState()).toBe('WARNING');
    const w = bus.ofType('warning');
    expect(w).toHaveLength(1);
    expect((w[0] as TypedEvent<'warning'>).payload.code).toBe('UNAUTHORIZED_TOOL_START');
    expect(agent.audit.list({ status: 'warning' }).some((a) => a.action === 'UNAUTHORIZED_TOOL_START')).toBe(true);
    agent.stop();
  });

  it('flags tool_started for a request GREEN never saw', () => {
    const { bus, agent } = setup();
    bus.publish(event('tool_started', { request_id: 'req_ghost', tool: 'docker_sandbox', operation: 'create_sandbox', input: {} }));
    expect(bus.ofType('warning')).toHaveLength(1);
    agent.stop();
  });

  it('does not flag an authorized tool start', () => {
    const { bus, agent } = setup();
    const req = toolRequest({ tool: 'sandbox_ping', input: { target: '127.0.0.1' } });
    bus.publish(event('tool_requested', req));
    bus.publish(event('tool_started', { request_id: req.request_id, tool: req.tool, operation: req.operation, input: req.input }));
    expect(bus.ofType('warning')).toHaveLength(0);
    agent.stop();
  });

  it('announces an unavailable capability (Docker offline) and audits it', () => {
    const { bus, agent } = setup();
    bus.publish(
      event('tool_finished', {
        request_id: 'req_x',
        tool: 'docker_sandbox',
        operation: 'create_sandbox',
        status: 'unavailable',
        output: {},
        error: 'docker daemon not reachable',
      }),
    );
    expect(agent.getState()).toBe('WARNING');
    const line = spoken(bus).find((l) => l.kind === 'capability_unavailable');
    expect(line?.to).toBe('architect');
    expect(line?.message).toMatch(/no está disponible|unavailable/);
    expect(agent.audit.list({ status: 'unavailable' })).toHaveLength(1);
    agent.stop();
  });

  it('announces an offline agent', () => {
    const { bus, agent } = setup();
    bus.publish(event('agent_offline', { agent: 'researcher', reason: 'websocket closed' }, 'system'));
    expect(agent.getState()).toBe('WARNING');
    expect(spoken(bus).some((l) => l.kind === 'agent_offline' && /Researcher/.test(l.message))).toBe(true);
    agent.stop();
  });

  it('stop() goes OFFLINE and detaches', () => {
    const { bus, agent } = setup();
    agent.stop();
    expect(agent.getState()).toBe('OFFLINE');
    bus.publish(event('tool_requested', toolRequest()));
    expect(agent.engine.list()).toHaveLength(0);
  });
});
