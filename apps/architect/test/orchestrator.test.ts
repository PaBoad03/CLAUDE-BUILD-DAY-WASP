import { test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { FakeHub } from '@wasp/event-bus/testing';
import { newId, nowIso, type ResearchSummary, type ValidationResult } from '@wasp/shared-types';
import { initialContext, reduce } from '../../hub/src/reducer';
import { ClaudeOrchestrator, type ClaudeLike } from '../src/orchestrator';
import type { HumanIO } from '../src/human';

/** A scripted Claude: each call returns the next message; tool_use blocks name the tools to call. */
function scriptedClaude(turns: Array<Array<{ name: string; input: Record<string, unknown> }> | string>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let i = 0;
  const client: ClaudeLike = {
    messages: {
      async create(params) {
        calls.push(JSON.parse(JSON.stringify(params))); // snapshot: the orchestrator keeps mutating its messages array
        const turn = turns[i++];
        const content =
          typeof turn === 'string'
            ? [{ type: 'text', text: turn, citations: null }]
            : turn.map((t, k) => ({ type: 'tool_use', id: `tu_${i}_${k}`, name: t.name, input: t.input, caller: null }));
        return {
          id: `msg_${i}`, type: 'message', role: 'assistant', model: 'fake', content,
          stop_reason: typeof turn === 'string' ? 'end_turn' : 'tool_use', stop_sequence: null, stop_details: null,
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50, server_tool_use: null, service_tier: null, inference_geo: null, iterations: null, speed: null },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, calls };
}

const human: HumanIO = { ask: async () => 'sí', close() {} };

/** Hub with a live reducer so hub.context is authoritative like the real one. */
function hubWithContext() {
  const hub = new FakeHub('architect');
  hub.context = initialContext('sess_test', nowIso());
  hub.onAny((e) => {
    hub.context = reduce(hub.context!, e).context;
  });
  return hub;
}

function researcher(hub: FakeHub, stub = false) {
  return (evt: Parameters<NonNullable<FakeHub['responder']>>[0]) => {
    if (evt.type !== 'research_request') return;
    const payload: ResearchSummary = {
      request_id: evt.payload.request_id,
      results: [{ id: 'res1', source: 'https://example.org/ping', title: 'ping man page', claim: 'ping sends ICMP echo', verification_status: 'FOUND', confidence: 'high', stub: stub || undefined }],
      summary: 'One source found.',
      counts: { FOUND: 1, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 0 },
      stub: stub || undefined,
    };
    return hub.from('researcher', 'research_result', payload, { to: 'architect', correlation_id: evt.correlation_id });
  };
}

function operator(hub: FakeHub, validated: boolean, stub = false) {
  return (evt: Parameters<NonNullable<FakeHub['responder']>>[0]) => {
    if (evt.type !== 'validation_request') return;
    const payload: ValidationResult = {
      request_id: evt.payload.request_id,
      validated,
      tests: [{ tool_id: 'sandbox_ping', request_id: newId('t'), status: validated ? 'success' : 'unavailable', started_at: nowIso(), finished_at: nowIso(), duration_ms: 1, stub: stub || undefined, summary: validated ? '0% loss' : 'Docker unavailable' }],
      summary: validated ? 'Laboratory validated.' : 'Docker capability is unavailable.',
      verifies_research_ids: validated ? evt.payload.research_ids : undefined,
      stub: stub || undefined,
    };
    return hub.from('operator', 'validation_result', payload, { to: 'architect', correlation_id: evt.correlation_id });
  };
}

const FINALIZE = {
  name: 'finalize_workshop',
  input: {
    title: 'Beginner Recon', level: 'beginner', duration_minutes: 120, objectives: ['a'], agenda: [{ title: 'Concepts', minutes: 30, description: '' }], concepts: ['ICMP'], challenges: [{ title: 'ping', description: 'ping localhost', tools: ['sandbox_ping'] }],
    tools: ['sandbox_ping'], prerequisites: [], network_dependencies: [], risks: [], fallbacks: [], lab_description: 'isolated container', spoken_summary: 'Pablo, the workshop is ready. The lab was validated.',
  },
};

test('happy path: research → validation → finalize; hub context decides validated and marks research VERIFIED', async () => {
  const hub = hubWithContext();
  const r = researcher(hub);
  const o = operator(hub, true);
  hub.responder = (e) => r(e) ?? o(e);
  const { client, calls } = scriptedClaude([
    [{ name: 'speak_to', input: { to: 'researcher', message: 'Researcher, I need evidence.', intent: 'research_request' } }, { name: 'request_research', input: { question: 'beginner recon', level: 'beginner', duration_minutes: 120 } }],
    [{ name: 'request_validation', input: { description: 'ping in sandbox', tools: [], research_ids: ['res1', 'res_invented'] } }],
    [FINALIZE],
  ]);
  const orch = new ClaudeOrchestrator({ hub, human, client });
  const result = await orch.run('WASP, create a workshop.');

  assert.equal(result.reason, 'finalized');
  assert.equal(result.iterations, 3);
  assert.equal(result.workshop!.lab.validated, true);
  assert.equal(result.workshop!.research[0].verification_status, 'VERIFIED');
  // the model asked to verify an invented id: filtered out before it reached ORANGE
  assert.deepEqual(hub.ofType('validation_request')[0].payload.research_ids, ['res1']);
  assert.ok(hub.ofType('final_response').length === 1);
  assert.ok(hub.ofType('workshop_updated').length === 1);
  assert.match(result.final, /validado con pruebas reales/);
  // tool results were fed back
  const second = calls[1].messages.at(-1)!;
  assert.equal(second.role, 'user');
  assert.equal((second.content as Anthropic.ToolResultBlockParam[]).length, 2);
  assert.equal(calls[0].model, 'claude-opus-5');
  assert.equal(calls[0].output_config?.effort, 'medium');
});

test('the model cannot claim validation: Docker offline → validated false even if spoken_summary says otherwise', async () => {
  const hub = hubWithContext();
  const r = researcher(hub);
  const o = operator(hub, false);
  hub.responder = (e) => r(e) ?? o(e);
  const { client } = scriptedClaude([
    [{ name: 'request_research', input: { question: 'q', level: 'beginner', duration_minutes: 120 } }],
    [{ name: 'request_validation', input: { description: 'x', tools: [], research_ids: ['res1'] } }],
    [FINALIZE],
  ]);
  const result = await new ClaudeOrchestrator({ hub, human, client }).run('req');
  assert.equal(result.workshop!.lab.validated, false);
  assert.match(result.final, /NO está validado: Docker capability is unavailable/);
  assert.equal(result.workshop!.research[0].verification_status, 'FOUND');
  assert.equal(hub.states().at(-1), 'WARNING');
});

test('stub operator claiming success never validates', async () => {
  const hub = hubWithContext();
  hub.stubs.add('operator');
  const o = operator(hub, true, true);
  hub.responder = (e) => o(e);
  const { client } = scriptedClaude([[{ name: 'request_validation', input: { description: 'x', tools: [], research_ids: [] } }], [FINALIZE]]);
  const result = await new ClaudeOrchestrator({ hub, human, client }).run('req');
  assert.equal(result.workshop!.lab.validated, false);
  assert.match(result.final, /NO está validado/);
});

test('offline researcher → error tool_result, loop continues, final answer says so', async () => {
  const hub = hubWithContext();
  hub.online.delete('researcher');
  hub.responder = operator(hub, false);
  const { client, calls } = scriptedClaude([[{ name: 'request_research', input: { question: 'q', level: 'beginner', duration_minutes: 120 } }], [FINALIZE]]);
  const result = await new ClaudeOrchestrator({ hub, human, client }).run('req');
  const fed = calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(fed[0].is_error, true);
  assert.match(String(fed[0].content), /agente de investigación está desconectado/);
  assert.ok(hub.ofType('warning').length >= 1);
  assert.equal(result.reason, 'finalized');
  assert.equal(result.workshop!.research.length, 0);
});

test('end_turn without finalize_workshop still publishes an honest final_response', async () => {
  const hub = hubWithContext();
  const { client } = scriptedClaude(['I designed it.']);
  const result = await new ClaudeOrchestrator({ hub, human, client }).run('req');
  assert.equal(result.reason, 'end_turn');
  assert.match(result.final, /NO está validado/);
  assert.equal(hub.ofType('final_response').length, 1);
});

test('max_iterations guard', async () => {
  const hub = hubWithContext();
  const { client } = scriptedClaude(Array.from({ length: 5 }, () => [{ name: 'get_status', input: {} }]));
  const result = await new ClaudeOrchestrator({ hub, human, client, maxIterations: 3 }).run('req');
  assert.equal(result.reason, 'max_iterations');
  assert.equal(result.iterations, 3);
});

test('ask_human routes through HumanIO and is audited', async () => {
  const hub = hubWithContext();
  const asked: string[] = [];
  const h: HumanIO = { ask: async (q) => (asked.push(q), 'two hours'), close() {} };
  const { client, calls } = scriptedClaude([[{ name: 'ask_human', input: { question: 'How long?' } }], [FINALIZE]]);
  await new ClaudeOrchestrator({ hub, human: h, client }).run('req');
  assert.deepEqual(asked, ['How long?']);
  const fed = calls[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
  assert.equal(fed[0].content, 'two hours');
  assert.ok(hub.ofType('audit_event').some((e) => e.payload.action === 'ask_human'));
  assert.ok(hub.ofType('speak_requested').some((e) => e.payload.text === 'How long?'));
});
