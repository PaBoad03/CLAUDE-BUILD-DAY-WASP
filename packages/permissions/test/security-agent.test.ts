import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FakeHub } from '@wasp/event-bus/testing';
import { SecurityAgent } from '../src/security-agent';
import { req } from './policies.test';

function setup(opts: { timeout?: number } = {}) {
  const hub = new FakeHub('security');
  const agent = new SecurityAgent({ hub, settle_ms: 0, pending_timeout_ms: opts.timeout });
  agent.start();
  return { hub, agent };
}

const intents = (hub: FakeHub) => hub.ofType('agent_message').map((e) => e.payload.intent);

describe('SecurityAgent — permission flow end to end over the hub', () => {
  it('ORANGE requests sandbox -> GREEN asks CYAN -> human says sí -> permission_granted + audit', async () => {
    const { hub, agent } = setup();
    assert.equal(agent.getState(), 'MONITORING');

    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security', r.permission_id);
    assert.equal(agent.getState(), 'PERMISSION_REQUIRED');
    const required = hub.ofType('permission_required')[0];
    assert.equal(required.to, 'architect');
    assert.equal(required.correlation_id, r.permission_id);
    assert.equal(required.payload.risk, 'MEDIUM');
    assert.match(required.payload.human_prompt, /docker_sandbox/);
    assert.ok(intents(hub).includes('permission_required'));

    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'AMBIGUOUS', raw: 'Sí', channel: 'voice' }, 'architect', 'security', r.permission_id);
    assert.equal(agent.getState(), 'AUTHORIZED');
    const granted = hub.ofType('permission_granted')[0];
    assert.equal(granted.correlation_id, r.permission_id);
    assert.equal(granted.payload.status, 'GRANTED');
    assert.equal(granted.payload.decided_by, 'human');
    assert.equal(granted.payload.human_raw, 'Sí');
    assert.equal(agent.engine.isAuthorized(r.permission_id), true);

    // audit reconstructs it (the agent's own audit_events flow back through the hub stream)
    const audit = agent.audit.list({ correlation_id: r.permission_id });
    assert.ok(audit.some((a) => a.approval_status === 'AWAITING_HUMAN'));
    const rec = audit.find((a) => a.approval_status === 'GRANTED')!;
    assert.equal(rec.user_authorization, 'Sí');
    assert.equal(rec.approval_required, true);
    assert.equal(rec.agent, 'security');
    agent.stop();
  });

  it('ambiguous answer keeps AWAITING_HUMAN and GREEN asks again (permission_clarification_needed)', async () => {
    const { hub, agent } = setup();
    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security');
    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'AMBIGUOUS', raw: 'está bien, supongo', channel: 'voice' }, 'architect', 'security');
    assert.equal(agent.engine.isAuthorized(r.permission_id), false);
    assert.equal(agent.getState(), 'PERMISSION_REQUIRED');
    const clar = hub.ofType('permission_clarification_needed');
    assert.equal(clar.length, 1);
    assert.equal(clar[0].to, 'architect');
    assert.equal(hub.ofType('permission_granted').length, 0);
    assert.ok(agent.audit.list({ action: 'ambiguous_authorization' }).length === 1);

    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'NO', raw: 'no', channel: 'voice' }, 'architect', 'security');
    assert.equal(agent.getState(), 'DENIED');
    assert.equal(hub.ofType('permission_denied').length, 1);
    agent.stop();
  });

  it('a voice bridge that claims decision=YES with an ambiguous transcript does not authorize', async () => {
    const { hub, agent } = setup();
    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security');
    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'YES', raw: 'maybe', channel: 'voice' }, 'architect', 'security');
    assert.equal(agent.engine.isAuthorized(r.permission_id), false);
    assert.equal(hub.ofType('permission_clarification_needed').length, 1);
    agent.stop();
  });

  it('a plain user_message "sí" answers the single pending permission; with several pending it asks which', async () => {
    const { hub, agent } = setup();
    const a = req();
    await hub.deliver('permission_requested', a, 'operator', 'security');
    await hub.deliver('user_message', { text: 'sí', channel: 'voice' }, 'human');
    assert.equal(agent.engine.isAuthorized(a.permission_id), true);

    const b = req({ operation: 'sandbox_network' });
    const c = req({ operation: 'sandbox_network_external' });
    await hub.deliver('permission_requested', b, 'operator', 'security');
    await hub.deliver('permission_requested', c, 'operator', 'security');
    await hub.deliver('user_message', { text: 'sí', channel: 'voice' }, 'human');
    assert.equal(agent.engine.isAuthorized(b.permission_id), false);
    assert.equal(agent.engine.isAuthorized(c.permission_id), false);
    assert.ok(intents(hub).includes('permission_reprompt'));
    agent.stop();
  });

  it('"stop" with several pending cancels all of them', async () => {
    const { hub, agent } = setup();
    await hub.deliver('permission_requested', req(), 'operator', 'security');
    await hub.deliver('permission_requested', req({ operation: 'sandbox_network' }), 'operator', 'security');
    await hub.deliver('user_message', { text: 'stop', channel: 'voice' }, 'human');
    assert.equal(agent.engine.pending().length, 0);
    assert.equal(hub.ofType('permission_cancelled').length, 2);
    agent.stop();
  });

  it('unrelated user messages are ignored when nothing is pending', async () => {
    const { hub, agent } = setup();
    await hub.deliver('user_message', { text: 'WASP, créame un workshop de red', channel: 'voice' }, 'human');
    assert.equal(agent.engine.list().length, 0);
    assert.equal(agent.getState(), 'MONITORING');
    agent.stop();
  });

  it('LOW request is auto-approved: permission_granted immediately, decided_by security', async () => {
    const { hub, agent } = setup();
    const r = req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '127.0.0.1' } });
    await hub.deliver('permission_requested', r, 'operator', 'security');
    const g = hub.ofType('permission_granted')[0];
    assert.equal(g.payload.status, 'AUTO_APPROVED');
    assert.equal(g.payload.decided_by, 'security');
    assert.equal(hub.ofType('permission_required').length, 0);
    assert.equal(agent.getState(), 'MONITORING');
    agent.stop();
  });

  it('CRITICAL request is BLOCKED: permission_denied with status BLOCKED, and a human yes cannot unblock it', async () => {
    const { hub, agent } = setup();
    const r = req({ operation: 'host_shell' });
    await hub.deliver('permission_requested', r, 'operator', 'security');
    assert.equal(agent.getState(), 'BLOCKED');
    const d = hub.ofType('permission_denied')[0];
    assert.equal(d.payload.status, 'BLOCKED');
    assert.ok(agent.audit.list({ status: 'denied' }).length === 1);
    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'YES', raw: 'sí', channel: 'ui' }, 'architect', 'security');
    assert.equal(agent.engine.isAuthorized(r.permission_id), false);
    assert.equal(hub.ofType('permission_granted').length, 0);
    agent.stop();
  });

  it('a payload claiming another requester is corrected to the socket identity and flagged', async () => {
    const { hub, agent } = setup();
    const r = req({ requested_by: 'architect' }); // sent by the operator socket
    await hub.deliver('permission_requested', r, 'operator', 'security');
    assert.equal(agent.engine.get(r.permission_id)!.requested_by, 'operator');
    assert.ok(hub.ofType('warning').some((w) => /REQUESTER_MISMATCH/.test(w.payload.message)));
    agent.stop();
  });

  it('pending permissions expire when a timeout is configured (permission_cancelled, status EXPIRED)', async () => {
    const { hub, agent } = setup({ timeout: 20 });
    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security');
    await hub.settle(60);
    const c = hub.ofType('permission_cancelled')[0];
    assert.equal(c.payload.status, 'EXPIRED');
    assert.equal(agent.engine.get(r.permission_id)!.status, 'EXPIRED');
    agent.stop();
  });
});

describe('SecurityAgent — enforcement & failure honesty', () => {
  it('flags tool_started for an approval-requiring tool without a GRANTED permission', async () => {
    const { hub, agent } = setup();
    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security'); // AWAITING_HUMAN
    await hub.deliver('tool_started', { tool_id: 'docker_sandbox', request_id: 'tool_1', permission_id: r.permission_id }, 'operator');
    assert.equal(agent.getState(), 'WARNING');
    const w = hub.ofType('warning').filter((x) => /UNAUTHORIZED_TOOL_START/.test(x.payload.message));
    assert.equal(w.length, 1);
    assert.ok(agent.audit.list({ action: 'UNAUTHORIZED_TOOL_START' }).length === 1);
    agent.stop();
  });

  it('flags tool_started for a permission GREEN never saw', async () => {
    const { hub, agent } = setup();
    await hub.deliver('tool_started', { tool_id: 'docker_sandbox', request_id: 'ghost', permission_id: 'perm_ghost' }, 'operator');
    assert.equal(hub.ofType('warning').length, 1);
    agent.stop();
  });

  it('does not flag an authorized start, nor a LOW tool', async () => {
    const { hub, agent } = setup();
    const r = req();
    await hub.deliver('permission_requested', r, 'operator', 'security');
    await hub.deliver('user_authorization', { permission_id: r.permission_id, decision: 'YES', raw: 'yes', channel: 'cli' }, 'architect', 'security');
    await hub.deliver('tool_started', { tool_id: 'docker_sandbox', request_id: 'tool_1', permission_id: r.permission_id }, 'operator');
    await hub.deliver('tool_started', { tool_id: 'sandbox_ping', request_id: 'tool_2' }, 'operator');
    assert.equal(hub.ofType('warning').length, 0);
    agent.stop();
  });

  it('a LOW tool whose request GREEN escalated (external target) must not start without approval', async () => {
    const { hub, agent } = setup();
    const r = req({ operation: 'sandbox_ping', proposed_risk: 'LOW', input: { target: '8.8.8.8' } });
    await hub.deliver('permission_requested', r, 'operator', 'security');
    assert.equal(hub.ofType('permission_required').length, 1);
    await hub.deliver('tool_started', { tool_id: 'sandbox_ping', request_id: 'tool_3', permission_id: r.permission_id }, 'operator');
    assert.equal(hub.ofType('warning').length, 1);
    agent.stop();
  });

  it('announces an unavailable capability (Docker offline) to CYAN', async () => {
    const { hub, agent } = setup();
    await hub.deliver('tool_finished', { tool_id: 'docker_sandbox', request_id: 'x', status: 'unavailable', error: 'docker daemon not reachable', started_at: '', finished_at: '', duration_ms: 0 }, 'operator');
    assert.equal(agent.getState(), 'WARNING');
    const line = hub.ofType('agent_message').find((m) => m.payload.intent === 'capability_unavailable')!;
    assert.equal(line.to, 'architect');
    assert.match(line.payload.message, /no está disponible|unavailable/);
    agent.stop();
  });

  it('announces an offline agent', async () => {
    const { hub, agent } = setup();
    await hub.deliver('agent_offline', { agent: 'researcher', reason: 'socket closed' }, 'hub');
    assert.equal(agent.getState(), 'WARNING');
    assert.ok(hub.ofType('agent_message').some((m) => m.payload.intent === 'agent_offline' && /Researcher/.test(m.payload.message)));
    agent.stop();
  });

  it('merges tools_registered from ORANGE into the policy registry', async () => {
    const { hub, agent } = setup();
    await hub.deliver('tools_registered', { tools: [{ id: 'sandbox_traceroute', description: 'tr', owner: 'operator', risk: 'LOW', requires_approval: false, input_schema: {}, available: true }] }, 'operator');
    assert.equal(agent.engine.registry.get('sandbox_traceroute')?.risk_level, 'LOW');
    agent.stop();
  });

  it('stop() goes OFFLINE and detaches', async () => {
    const { hub, agent } = setup();
    agent.stop();
    assert.equal(agent.getState(), 'OFFLINE');
    await hub.deliver('permission_requested', req(), 'operator', 'security');
    assert.equal(agent.engine.list().length, 0);
  });
});
