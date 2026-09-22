/**
 * CYAN — Architect / Orchestrator (CLI smoke version).
 *
 *   npm run architect -- "WASP, create a two-hour beginner network reconnaissance workshop."
 *
 * This is the end-to-end skeleton that exercises the whole chain against the hub:
 *   user_message → research_request → research_result → validation_request
 *   → permission_required → (asks human on stdin) → user_authorization
 *   → validation_result → final_response
 *
 * It is deliberately deterministic for now. Next step (Pablo): replace `plan()` with the
 * Claude API tool loop in ./orchestrator.ts. The event contract does not change.
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { connectHub, AgentUnavailableError, RequestTimeoutError } from '@wasp/event-bus';
import { newId, type HumanDecision, type ResearchSummary, type ValidationResult, type WorkshopSpec } from '@wasp/shared-types';

const request = process.argv.slice(2).join(' ') || 'WASP, create a two-hour beginner network reconnaissance workshop.';
const log = (m: string) => console.log(`[cyan] ${m}`);

const hub = await connectHub({ agent: 'architect', mode: 'real', meta: { host: 'pablo' }, log });

// Human input. WASP_AUTO_ANSWER=yes|no|stop makes it non-interactive (tests / rehearsals).
const auto = process.env.WASP_AUTO_ANSWER;
const rl = auto ? null : readline.createInterface({ input: stdin, output: stdout });
async function askHuman(prompt: string): Promise<string> {
  if (auto) {
    console.log(`\n  CYAN asks you: ${prompt}  [auto-answer: ${auto}]`);
    return auto;
  }
  return (await rl!.question(`\n  CYAN asks you: ${prompt}  [yes/no/stop] > `)).trim();
}

hub.onAny((e) => {
  if (e.type === 'agent_message' && e.from !== 'architect') console.log(`  ${e.from.toUpperCase()} → ${e.to.toUpperCase()}: ${e.payload.message}`);
  if (e.type === 'hub_error') console.error(`  HUB ERROR: ${e.payload.message}`);
});

// Human authorization: when GREEN says a human is needed, CYAN asks.
hub.onMine('permission_required', async (evt) => {
  const p = evt.payload;
  hub.setState('WAITING_FOR_PERMISSION');
  hub.say('human', p.human_prompt, 'ask_human');
  hub.emit('speak_requested', { agent: 'architect', text: p.human_prompt, priority: 'high' });
  const raw = await askHuman(p.human_prompt);
  const decision: HumanDecision = /^(y|yes|sí|si|dale)$/i.test(raw) ? 'YES' : /^(n|no)$/i.test(raw) ? 'NO' : /^(stop|cancel)$/i.test(raw) ? 'STOP' : 'AMBIGUOUS';
  hub.emit('user_authorization', { permission_id: p.permission_id, decision, raw, channel: 'cli' }, { to: 'security', correlation_id: p.permission_id });
});
hub.onMine('permission_clarification_needed', async (evt) => {
  const raw = await askHuman(evt.payload.human_prompt);
  hub.emit('user_authorization', { permission_id: evt.payload.permission_id, decision: 'AMBIGUOUS', raw, channel: 'cli' }, { to: 'security', correlation_id: evt.payload.permission_id });
});

// ------------------------------------------------------------------ the flow

const online = (a: 'researcher' | 'operator' | 'security') => hub.isOnline(a) ? (hub.isStub(a) ? 'stub' : 'online') : 'OFFLINE';
log(`agents: researcher=${online('researcher')} operator=${online('operator')} security=${online('security')}`);

hub.setState('LISTENING');
hub.emit('user_message', { text: request, channel: 'cli' }, { to: 'architect' });
hub.setState('THINKING');
hub.emit('session_state', { state: 'PLANNING' });
hub.emit('decision_made', { decision: 'Delegate research to MAGENTA, then validation to ORANGE.', rationale: 'Workshop needs evidence before lab validation.' });

const notes: string[] = [];
let research: ResearchSummary | null = null;
let validation: ValidationResult | null = null;

// 1. research
hub.setState('COMMUNICATING');
hub.say('researcher', 'Researcher, I need evidence for a beginner network reconnaissance workshop.', 'research_request');
try {
  const r = await hub.request('research_request', { request_id: newId('req'), question: request, scope: { level: 'beginner', duration_minutes: 120 } }, { to: 'researcher', expect: 'research_result', timeoutMs: 60_000 });
  research = r.payload;
  log(`research: ${research.results.length} results${research.stub ? ' [STUB]' : ''}`);
} catch (err) {
  const why = err instanceof AgentUnavailableError ? 'Research agent is offline' : err instanceof RequestTimeoutError ? 'Research agent did not answer' : (err as Error).message;
  notes.push(`${why}; the workshop has no researched evidence.`);
  hub.emit('warning', { message: why });
  log(`research unavailable: ${why}`);
}

// 2. validation (which triggers the permission chain inside ORANGE/GREEN)
hub.setState('COMMUNICATING');
hub.say('operator', 'Operator, can you validate the connectivity exercise in our sandbox?', 'validation_request');
try {
  // No `tools`: ORANGE runs its default plan (docker_sandbox → ping → dns → http → routes).
  // `research_ids`: a real successful validation flips those results FOUND → VERIFIED in the hub.
  const research_ids = research?.results.filter((r) => !r.stub).map((r) => r.id);
  const v = await hub.request(
    'validation_request',
    { request_id: newId('req'), description: 'ping 127.0.0.1, DNS and HTTP against the local target inside an isolated Linux container', research_ids: research_ids?.length ? research_ids : undefined },
    { to: 'operator', expect: 'validation_result', timeoutMs: 300_000 },
  );
  validation = v.payload;
  log(`validation: validated=${validation.validated}${validation.stub ? ' [STUB]' : ''} — ${validation.summary}`);
} catch (err) {
  const why = err instanceof AgentUnavailableError ? 'Operator agent is offline' : err instanceof RequestTimeoutError ? 'Operator did not answer' : (err as Error).message;
  notes.push(`${why}; the laboratory could not be validated.`);
  hub.emit('warning', { message: why });
  log(`validation unavailable: ${why}`);
}

// 3. synthesize — deterministic for now; Claude will do this next.
hub.setState('THINKING');
hub.emit('session_state', { state: 'SYNTHESIZING' });
const validated = hub.context?.workshop.lab.validated ?? false;
const workshop: WorkshopSpec = {
  ...(hub.context?.workshop ?? ({} as WorkshopSpec)),
  title: 'Beginner Network Reconnaissance Workshop',
  level: 'beginner',
  duration_minutes: 120,
  objectives: ['Understand what reconnaissance is', 'Run safe connectivity checks in an isolated lab', 'Read DNS and interface information'],
  agenda: [
    { title: 'Concepts', minutes: 30 },
    { title: 'Lab: ping & DNS in the sandbox', minutes: 60 },
    { title: 'Debrief & ethics', minutes: 30 },
  ],
  concepts: ['ICMP', 'DNS', 'interfaces & routes', 'legal/ethical boundaries'],
  challenges: [{ title: 'Localhost connectivity', description: 'ping 127.0.0.1 and interpret packet loss', tools: ['sandbox_ping'] }],
  tools: ['docker_sandbox', 'sandbox_ping', 'sandbox_dns'],
  prerequisites: ['Laptop with Docker'],
  network_dependencies: ['none for the base lab'],
  risks: ['students running commands outside the sandbox'],
  fallbacks: ['static walkthrough if Docker is unavailable'],
  research: research?.results ?? [],
  lab: { description: 'Isolated Linux container, controlled network', validated, validation_note: validation?.summary ?? notes.join(' ') },
};
hub.emit('workshop_updated', { workshop, changed: ['*'] });

const parts = [`Pablo, the workshop is designed: "${workshop.title}", ${workshop.duration_minutes} minutes, ${workshop.agenda.length} blocks.`];
if (research) parts.push(`Research found ${research.results.length} sources, ${research.counts.VERIFIED} verified${research.stub ? ' (stub data)' : ''}.`);
parts.push(validated ? 'The laboratory was validated in the sandbox.' : `The laboratory is NOT validated: ${validation?.summary ?? notes.join(' ')}`);
const final = parts.join(' ');

hub.emit('final_response', { text: final, workshop });
hub.emit('speak_requested', { agent: 'architect', text: final });
hub.say('human', final, 'final_response');
hub.setState(validated ? 'SUCCESS' : 'WARNING');
console.log(`\n=== WASP ===\n${final}\n`);
console.log(`context revision ${hub.context?.revision}, state ${hub.context?.current_state}, audit entries ${hub.context?.audit.length}`);

rl?.close();
setTimeout(() => {
  hub.close();
  process.exit(0);
}, 500);
