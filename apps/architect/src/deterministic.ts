/**
 * Deterministic orchestration — the fallback when Claude is unavailable (no credentials,
 * API down) and the reference flow for tests. Same events, same honesty rules, no intelligence.
 */

import type { HubClient } from '@wasp/event-bus';
import { AgentUnavailableError, RequestTimeoutError } from '@wasp/event-bus';
import { newId, type ResearchSummary, type ValidationResult, type WorkshopSpec } from '@wasp/shared-types';

export type HubLike = Pick<HubClient, 'agent' | 'context' | 'emit' | 'say' | 'setState' | 'audit' | 'request' | 'isOnline' | 'isStub' | 'on' | 'onMine' | 'onAny'>;

export async function deterministicFlow(hub: HubLike, request: string, log: (m: string) => void = () => {}): Promise<string> {
  hub.setState('THINKING');
  hub.emit('session_state', { state: 'PLANNING' });
  hub.emit('decision_made', { decision: 'Delegate research to MAGENTA, then validation to ORANGE.', rationale: 'Deterministic flow (Claude unavailable): workshop needs evidence before lab validation.' });

  const notes: string[] = [];
  let research: ResearchSummary | null = null;
  let validation: ValidationResult | null = null;

  hub.setState('COMMUNICATING');
  hub.say('researcher', 'Researcher, I need evidence for a beginner network reconnaissance workshop.', 'research_request');
  try {
    const r = await hub.request('research_request', { request_id: newId('req'), question: request, scope: { level: 'beginner', duration_minutes: 120 } }, { to: 'researcher', expect: 'research_result', timeoutMs: 90_000 });
    research = r.payload;
    log(`research: ${research.results.length} results${research.stub ? ' [STUB]' : ''}`);
  } catch (err) {
    const why = describe(err, 'Research agent');
    notes.push(`${why}; the workshop has no researched evidence.`);
    hub.emit('warning', { message: why });
    log(`research unavailable: ${why}`);
  }

  hub.setState('COMMUNICATING');
  hub.say('operator', 'Operator, can you validate the connectivity exercise in our sandbox?', 'validation_request');
  try {
    const research_ids = research?.results.filter((r) => !r.stub).map((r) => r.id);
    const v = await hub.request(
      'validation_request',
      { request_id: newId('req'), description: 'ping 127.0.0.1, DNS and HTTP against the local target inside an isolated Linux container', research_ids: research_ids?.length ? research_ids : undefined },
      { to: 'operator', expect: 'validation_result', timeoutMs: 300_000 },
    );
    validation = v.payload;
    log(`validation: validated=${validation.validated}${validation.stub ? ' [STUB]' : ''} — ${validation.summary}`);
  } catch (err) {
    const why = describe(err, 'Operator agent');
    notes.push(`${why}; the laboratory could not be validated.`);
    hub.emit('warning', { message: why });
    log(`validation unavailable: ${why}`);
  }

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
      { title: 'Lab: ping, DNS & HTTP in the sandbox', minutes: 60 },
      { title: 'Debrief & ethics', minutes: 30 },
    ],
    concepts: ['ICMP', 'DNS', 'HTTP', 'interfaces & routes', 'legal/ethical boundaries'],
    challenges: [{ title: 'Localhost connectivity', description: 'ping 127.0.0.1 and interpret packet loss', tools: ['sandbox_ping'] }],
    tools: ['docker_sandbox', 'sandbox_ping', 'sandbox_dns', 'sandbox_http'],
    prerequisites: ['Laptop with Docker'],
    network_dependencies: ['none for the base lab'],
    risks: ['students running commands outside the sandbox'],
    fallbacks: ['static walkthrough if Docker is unavailable'],
    research: hub.context?.research ?? research?.results ?? [],
    lab: { description: 'Isolated Linux container, controlled network', validated, validation_note: validation?.summary ?? notes.join(' ') },
  };
  hub.emit('workshop_updated', { workshop, changed: ['*'] });

  const parts = [`Pablo, the workshop is designed: "${workshop.title}", ${workshop.duration_minutes} minutes, ${workshop.agenda.length} blocks.`];
  if (research) parts.push(`Research found ${research.results.length} sources, ${research.counts.VERIFIED} verified${research.stub ? ' (stub data)' : ''}.`);
  else parts.push(notes[0] ?? '');
  parts.push(validated ? 'The laboratory was validated in the sandbox.' : `The laboratory is NOT validated: ${validation?.summary ?? notes.join(' ')}`);
  const final = parts.filter(Boolean).join(' ');

  hub.emit('final_response', { text: final, workshop });
  hub.emit('speak_requested', { agent: 'architect', text: final });
  hub.say('human', final, 'final_response');
  hub.setState(validated ? 'SUCCESS' : 'WARNING');
  return final;
}

export function describe(err: unknown, who: string): string {
  if (err instanceof AgentUnavailableError) return `${who} is offline`;
  if (err instanceof RequestTimeoutError) return `${who} did not answer in time`;
  return (err as Error).message;
}
