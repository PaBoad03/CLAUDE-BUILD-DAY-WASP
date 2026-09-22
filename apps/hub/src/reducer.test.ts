import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, nowIso, type AnyEvent, type EventPayloads, type EventType, type Participant } from '@wasp/shared-types';
import { initialContext, reduce } from './reducer';
import { isAllowed } from './authority';

function ev<T extends EventType>(type: T, from: Participant, payload: EventPayloads[T], to: Participant = 'all'): AnyEvent {
  return { id: newId(), type, session_id: 's', from, to, timestamp: nowIso(), payload } as AnyEvent;
}

test('agent registration and offline update presence', () => {
  let ctx = initialContext('s', nowIso());
  ctx = reduce(ctx, ev('agent_registered', 'researcher', { agent: 'researcher', mode: 'stub' })).context;
  assert.equal(ctx.agents.researcher.status, 'online');
  assert.equal(ctx.agents.researcher.mode, 'stub');
  ctx = reduce(ctx, ev('agent_offline', 'hub', { agent: 'researcher' })).context;
  assert.equal(ctx.agents.researcher.status, 'offline');
  assert.equal(ctx.agent_states.researcher, 'OFFLINE');
});

test('stub validation can never set workshop.lab.validated = true', () => {
  let ctx = initialContext('s', nowIso());
  ctx = reduce(
    ctx,
    ev('validation_result', 'operator', {
      request_id: 'r1',
      validated: true,
      stub: true,
      summary: 'stub says ok',
      tests: [{ tool_id: 'sandbox_ping', request_id: 'r1', status: 'success', started_at: nowIso(), finished_at: nowIso(), duration_ms: 1, stub: true }],
    }),
  ).context;
  assert.equal(ctx.workshop.lab.validated, false);
  assert.match(ctx.workshop.lab.validation_note ?? '', /STUB/);
});

test('real successful validation sets validated = true', () => {
  let ctx = initialContext('s', nowIso());
  ctx = reduce(
    ctx,
    ev('validation_result', 'operator', {
      request_id: 'r1',
      validated: true,
      summary: 'ping ok',
      tests: [{ tool_id: 'sandbox_ping', request_id: 'r1', status: 'success', started_at: nowIso(), finished_at: nowIso(), duration_ms: 1 }],
    }),
  ).context;
  assert.equal(ctx.workshop.lab.validated, true);
});

test('a UI socket registration does not change presence', () => {
  let ctx = initialContext('s', nowIso());
  ctx = reduce(ctx, ev('agent_registered', 'operator', { agent: 'operator', mode: 'real', meta: { role: 'ui' } })).context;
  assert.equal(ctx.agents.operator.status, 'offline');
  assert.equal(ctx.agent_states.operator, 'OFFLINE');
});

test('real validation marks the research it names VERIFIED; a stub cannot', () => {
  let ctx = initialContext('s', nowIso());
  const res = { id: 'res1', source: 'https://x', title: 't', claim: 'ping works', verification_status: 'FOUND' as const, confidence: 'medium' as const };
  ctx = reduce(ctx, ev('research_result', 'researcher', { request_id: 'q', results: [res], summary: 's', counts: { FOUND: 1, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 0 } })).context;
  const okTest = { tool_id: 'sandbox_ping', request_id: 'r1', status: 'success' as const, started_at: nowIso(), finished_at: nowIso(), duration_ms: 1 };
  ctx = reduce(ctx, ev('validation_result', 'operator', { request_id: 'r1', validated: true, stub: true, summary: 'stub', tests: [{ ...okTest, stub: true }], verifies_research_ids: ['res1'] })).context;
  assert.equal(ctx.research[0].verification_status, 'FOUND');
  ctx = reduce(ctx, ev('validation_result', 'operator', { request_id: 'r2', validated: true, summary: 'real', tests: [okTest], verifies_research_ids: ['res1'] })).context;
  assert.equal(ctx.research[0].verification_status, 'VERIFIED');
  assert.equal(ctx.workshop.research[0].verification_status, 'VERIFIED');
  assert.equal(ctx.workshop.lab.validated, true);
});

test('workshop_updated cannot flip validated to true', () => {
  let ctx = initialContext('s', nowIso());
  const ws = { ...ctx.workshop, title: 'X', lab: { description: 'lab', validated: true } };
  ctx = reduce(ctx, ev('workshop_updated', 'architect', { workshop: ws, changed: ['title', 'lab'] })).context;
  assert.equal(ctx.workshop.title, 'X');
  assert.equal(ctx.workshop.lab.validated, false);
});

test('permission lifecycle is tracked', () => {
  let ctx = initialContext('s', nowIso());
  ctx = reduce(ctx, ev('permission_requested', 'operator', { permission_id: 'p1', requested_by: 'operator', operation: 'docker_sandbox', reason: 'need lab' }, 'security')).context;
  assert.equal(ctx.permissions[0].status, 'PENDING');
  ctx = reduce(ctx, ev('permission_required', 'security', { permission_id: 'p1', operation: 'docker_sandbox', risk: 'MEDIUM', approval_required: true, human_prompt: 'May I?' }, 'architect')).context;
  assert.equal(ctx.permissions[0].status, 'AWAITING_HUMAN');
  assert.equal(ctx.current_state, 'WAITING_FOR_PERMISSION');
  ctx = reduce(ctx, ev('permission_granted', 'security', { permission_id: 'p1', operation: 'docker_sandbox', requested_by: 'operator', status: 'GRANTED', risk: 'MEDIUM', approval_required: true, decided_by: 'human', human_raw: 'yes', decided_at: nowIso() })).context;
  assert.equal(ctx.permissions[0].status, 'GRANTED');
  assert.equal(ctx.permissions.length, 1);
});

test('only security may emit permission decisions', () => {
  assert.equal(isAllowed('permission_granted', 'security'), true);
  assert.equal(isAllowed('permission_granted', 'operator'), false);
  assert.equal(isAllowed('permission_granted', 'architect'), false);
  assert.equal(isAllowed('research_result', 'researcher'), true);
  assert.equal(isAllowed('research_result', 'architect'), false);
  assert.equal(isAllowed('agent_message', 'operator'), true);
});
