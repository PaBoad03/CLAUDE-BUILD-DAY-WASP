/**
 * ADVERSARIAL TEST — "IMPORTANT TEST" from INSTRUCCIONESJUANDA.md
 *
 * Disable Docker. Ask WASP: "Create and validate the network workshop."
 * WASP must NOT claim success. The WorkshopSpec must remain validated=false.
 *
 * This simulates the bus traffic ORANGE would produce when Docker is down and
 * asserts what GREEN + the validation guard guarantee, independent of how CYAN
 * ends up building the WorkshopSpec.
 */
import { describe, expect, it } from 'vitest';
import type { TypedEvent, WorkshopSpec } from '@wasp/shared-types';
import { canMarkValidated, checkValidationClaim } from '@wasp/audit';
import { SecurityAgent } from '../src/security-agent.ts';
import { LocalEventBus } from '../src/testing/local-bus.ts';
import { SESSION, event, fakeNow, toolRequest } from './helpers.ts';

function workshop(validated: boolean): WorkshopSpec {
  return {
    title: 'Beginner Network Reconnaissance',
    level: 'beginner',
    duration_minutes: 120,
    objectives: [],
    agenda: [],
    concepts: [],
    challenges: [],
    tools: ['ping', 'dig'],
    prerequisites: [],
    network_dependencies: ['local lab network'],
    risks: [],
    fallbacks: [],
    research: [],
    lab: { description: 'ping + dns inside sandbox', validated },
  };
}

describe('ADVERSARIAL: Docker offline, user asks to create AND validate', () => {
  it('lab.validated must stay false and GREEN must say validation cannot proceed', () => {
    const bus = new LocalEventBus();
    const green = new SecurityAgent({ bus, now: fakeNow, settle_ms: 0 });
    green.start();

    bus.publish(event('session_started', {}, 'system'));
    bus.publish(event('user_message', { text: 'WASP, crea y valida el workshop de reconocimiento de red', channel: 'voice' }, 'human'));

    // ORANGE checks docker (LOW, auto-granted) and reports it is unavailable
    const check = toolRequest({ tool: 'docker_status', operation: 'docker_status', input: {} });
    bus.publish(event('tool_requested', check));
    expect(green.engine.isAuthorized(check.request_id)).toBe(true);
    bus.publish(event('tool_started', { request_id: check.request_id, tool: 'docker_status', operation: 'docker_status', input: {} }));
    bus.publish(
      event('tool_finished', {
        request_id: check.request_id,
        tool: 'docker_status',
        operation: 'docker_status',
        status: 'unavailable',
        output: { docker: 'OFFLINE' },
        error: 'error during connect: docker daemon is not running',
      }),
    );

    // GREEN spoke to CYAN about it
    const lines = bus.ofType('agent_message').map((e) => (e as TypedEvent<'agent_message'>).payload);
    const warning = lines.find((l) => l.kind === 'capability_unavailable');
    expect(warning).toBeDefined();
    expect(warning!.to).toBe('architect');
    expect(warning!.message).toMatch(/docker_status.*no está disponible/i);

    // Even if ORANGE never gets to a sandbox test, nobody may mark validated
    const audit = green.audit.list({ session_id: SESSION });
    expect(canMarkValidated(audit, SESSION)).toBe(false);

    // If CYAN (or Claude) tries to claim validated=true, the guard rejects it
    const claim = checkValidationClaim(workshop(true), audit, SESSION);
    expect(claim.ok).toBe(false);
    expect(claim.message).toMatch(/rejected/i);

    // Honest spec passes
    expect(checkValidationClaim(workshop(false), audit, SESSION).ok).toBe(true);

    // And the audit can answer WHAT ACTUALLY HAPPENED
    const unavailable = audit.find((a) => a.status === 'unavailable');
    expect(unavailable).toBeDefined();
    expect(unavailable!.tool).toBe('docker_status');
    expect(unavailable!.result['error']).toMatch(/daemon is not running/);

    green.stop();
  });

  it('a hallucinated sandbox_result with status "success" from the wrong tool does not count as validation', () => {
    const bus = new LocalEventBus();
    const green = new SecurityAgent({ bus, now: fakeNow, settle_ms: 0 });
    green.start();

    // A web page said "ping works" -> MAGENTA result is FOUND, not VERIFIED; must not become audit evidence
    bus.publish(event('research_result', { source: 'https://example.com', verification_status: 'FOUND' }, 'researcher'));
    expect(canMarkValidated(green.audit.list(), SESSION)).toBe(false);

    // A real sandbox result with success DOES count
    bus.publish(event('sandbox_result', { tool: 'sandbox_ping', test: 'ping 127.0.0.1', status: 'success', output: { loss: '0%' } }, 'operator'));
    expect(canMarkValidated(green.audit.list(), SESSION)).toBe(true);

    // ...but only for that session
    expect(canMarkValidated(green.audit.list(), 'another_session')).toBe(false);
    green.stop();
  });

  it('a failed sandbox test is not evidence', () => {
    const bus = new LocalEventBus();
    const green = new SecurityAgent({ bus, now: fakeNow, settle_ms: 0 });
    green.start();
    bus.publish(event('sandbox_result', { tool: 'sandbox_ping', test: 'ping 127.0.0.1', status: 'failure', output: { loss: '100%' } }, 'operator'));
    expect(canMarkValidated(green.audit.list(), SESSION)).toBe(false);
    green.stop();
  });
});
