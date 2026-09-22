/**
 * STUB agents — fake MAGENTA / ORANGE / GREEN responders so anyone can test alone.
 *
 *   npm run stubs                       # all three
 *   npm run stubs -- researcher security # only some
 *
 * Everything they produce is marked stub: true and they register with mode 'stub'.
 * The hub reducer refuses to mark the lab validated from stub data.
 * When the real agent comes online on another PC, just don't run its stub.
 */

import { connectHub, type HubClient } from '@wasp/event-bus';
import {
  newId,
  nowIso,
  type AgentId,
  type HumanDecision,
  type PermissionDecision,
  type PermissionRequest,
  type RiskLevel,
  type ToolResult,
} from '@wasp/shared-types';

const wanted = (process.argv.slice(2).filter(Boolean) as AgentId[]);
const targets: AgentId[] = wanted.length ? wanted : ['researcher', 'operator', 'security'];
const log = (a: string, m: string) => console.log(`[stub:${a}] ${m}`);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ MAGENTA stub

async function researcherStub(hub: HubClient) {
  hub.setState('IDLE');
  hub.onMine('research_request', async (evt) => {
    const { request_id, question } = evt.payload;
    hub.setState('RESEARCHING');
    hub.say(evt.from, 'Research request received. [stub]', 'ack');
    hub.emit('research_started', { request_id }, { to: evt.from, correlation_id: request_id });
    await delay(1200);
    const results = [
      {
        id: newId('res'),
        source: 'stub://example/official-docs',
        title: `[STUB] Documentation about: ${question.slice(0, 60)}`,
        kind: 'official' as const,
        claim: 'Basic ICMP and DNS checks are standard beginner reconnaissance exercises.',
        procedure: 'ping 127.0.0.1 ; nslookup localhost',
        verification_status: 'FOUND' as const,
        confidence: 'medium' as const,
        stub: true,
      },
      {
        id: newId('res'),
        source: 'stub://example/community',
        title: '[STUB] Community write-up',
        kind: 'community' as const,
        claim: 'Interface inspection with ip addr is safe in an isolated container.',
        verification_status: 'UNKNOWN' as const,
        confidence: 'low' as const,
        stub: true,
      },
    ];
    hub.setState('SENDING');
    hub.emit(
      'research_result',
      {
        request_id,
        results,
        summary: 'Architect, I found two stub sources. The procedure is documented but not experimentally validated. [stub]',
        counts: { FOUND: 1, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 1 },
        stub: true,
      },
      { to: evt.from, correlation_id: request_id },
    );
    hub.say(evt.from, 'Architect, research is complete. Two sources found, none verified. [stub]', 'research_complete');
    hub.setState('COMPLETE');
  });
  log('researcher', 'ready (answers research_request with FOUND/UNKNOWN stub data)');
}

// ------------------------------------------------------------------ ORANGE stub

async function operatorStub(hub: HubClient) {
  hub.setState('IDLE');
  hub.emit('tools_registered', {
    tools: [
      { id: 'docker_sandbox', description: 'Create isolated Linux sandbox', owner: 'operator', risk: 'MEDIUM', requires_approval: true, input_schema: { type: 'object' }, available: false, unavailable_reason: 'stub operator has no Docker' },
      { id: 'sandbox_ping', description: 'ping inside sandbox', owner: 'operator', risk: 'LOW', requires_approval: false, input_schema: { type: 'object', properties: { target: { type: 'string' } } }, available: false, unavailable_reason: 'stub' },
    ],
  });
  hub.emit('sandbox_state', { available: false, status: 'OFFLINE', network: 'NONE', message: 'STUB operator — no real Docker' });

  hub.onMine('validation_request', async (evt) => {
    const { request_id, description } = evt.payload;
    hub.setState('PREPARING');
    hub.say(evt.from, 'I can test this in the isolated sandbox, but creating it requires permission. [stub]', 'ack');

    const permission_id = newId('perm');
    const req: PermissionRequest = {
      permission_id,
      requested_by: 'operator',
      operation: 'docker_sandbox',
      reason: `Create isolated sandbox to validate: ${description.slice(0, 80)}`,
      proposed_risk: 'MEDIUM',
      input: { network: 'CONTROLLED' },
    };
    hub.setState('WAITING_FOR_PERMISSION');
    hub.say('security', 'Security, I need authorization to start the sandbox. [stub]', 'permission_request');

    let decision;
    try {
      decision = await hub.request('permission_requested', req, {
        to: 'security',
        expect: ['permission_granted', 'permission_denied', 'permission_cancelled'],
        correlation_id: permission_id,
        timeoutMs: 120_000,
      });
    } catch (err) {
      hub.setState('ERROR');
      hub.emit('validation_result', { request_id, validated: false, tests: [], summary: `Cannot validate: ${(err as Error).message} [stub]`, stub: true }, { to: evt.from, correlation_id: request_id });
      return;
    }

    if (decision.type !== 'permission_granted') {
      hub.setState('IDLE');
      hub.say(evt.from, 'Authorization was not granted. I will not start the sandbox. [stub]', 'validation_aborted');
      hub.emit('validation_result', { request_id, validated: false, tests: [], summary: `Permission ${decision.payload.status}. Sandbox not started. [stub]`, stub: true }, { to: evt.from, correlation_id: request_id });
      return;
    }

    hub.say(evt.from, 'Authorization received. Starting the sandbox. [stub — nothing really runs]', 'executing');
    hub.setState('EXECUTING');
    const started = nowIso();
    hub.emit('tool_started', { tool_id: 'sandbox_ping', request_id });
    await delay(1000);
    const result: ToolResult = {
      tool_id: 'sandbox_ping',
      request_id,
      status: 'unavailable',
      error: 'STUB operator: no Docker, nothing executed',
      started_at: started,
      finished_at: nowIso(),
      duration_ms: 1000,
      stub: true,
    };
    hub.emit('tool_finished', result);
    hub.audit({ action: 'sandbox_ping', tool: 'ping', input: { target: '127.0.0.1' }, result, status: 'unavailable', risk_level: 'LOW', approval_required: false, correlation_id: request_id, stub: true });
    hub.setState('WARNING');
    hub.say(evt.from, 'Docker capability is unavailable on this stub. I cannot validate the laboratory.', 'validation_unavailable');
    hub.emit('validation_result', { request_id, validated: false, tests: [result], summary: 'Docker unavailable (stub). Laboratory NOT validated.', stub: true }, { to: evt.from, correlation_id: request_id });
  });
  log('operator', 'ready (requests permission, then reports Docker unavailable — honest stub)');
}

// ------------------------------------------------------------------ GREEN stub

const RISK_TABLE: Record<string, RiskLevel> = {
  sandbox_ping: 'LOW',
  sandbox_dns: 'LOW',
  docker_sandbox: 'MEDIUM',
  sandbox_network: 'MEDIUM',
  external_network: 'HIGH',
};

function interpret(raw: string): HumanDecision {
  const t = raw.trim().toLowerCase();
  if (/^(yes|y|sí|si|proceed|approve|approved|go ahead|autorizo|dale)\b/.test(t)) return 'YES';
  if (/^(no|n|deny|denied|nope|negativo)\b/.test(t)) return 'NO';
  if (/^(stop|cancel|abort|cancela|detente|para)\b/.test(t)) return 'STOP';
  return 'AMBIGUOUS';
}

async function securityStub(hub: HubClient) {
  hub.setState('MONITORING');
  const pending = new Map<string, PermissionRequest & { risk: RiskLevel }>();

  hub.onMine('permission_requested', async (evt) => {
    const req = evt.payload;
    const risk = RISK_TABLE[req.operation] ?? req.proposed_risk ?? 'HIGH';
    const approval_required = risk !== 'LOW';
    hub.setState('REVIEWING');
    hub.audit({ action: 'evaluate_permission', reason: req.reason, input: { operation: req.operation }, status: 'info', risk_level: risk, approval_required, approval_status: 'PENDING', correlation_id: req.permission_id, stub: true });

    if (!approval_required) {
      const d = decide(req, risk, 'AUTO_APPROVED', 'security');
      hub.emit('permission_granted', d, { to: 'all', correlation_id: req.permission_id });
      hub.setState('MONITORING');
      return;
    }
    pending.set(req.permission_id, { ...req, risk });
    hub.setState('PERMISSION_REQUIRED');
    hub.say('architect', `Human authorization is required. Operation ${req.operation}, risk ${risk}. [stub]`, 'permission_required');
    hub.emit(
      'permission_required',
      { permission_id: req.permission_id, operation: req.operation, risk, approval_required, human_prompt: `I need permission to ${req.reason}. Risk is ${risk}. Should I proceed?` },
      { to: 'architect', correlation_id: req.permission_id },
    );
  });

  hub.on('user_authorization', (evt) => {
    const { permission_id, raw, decision: given } = evt.payload;
    const req = pending.get(permission_id);
    if (!req) return;
    const decision = given === 'AMBIGUOUS' ? interpret(raw) : given;
    if (decision === 'AMBIGUOUS') {
      hub.emit('permission_clarification_needed', { permission_id, human_prompt: 'I did not understand. Please answer yes, no, or stop.' }, { to: 'architect', correlation_id: permission_id });
      hub.say('architect', 'That was ambiguous. I need a clear yes or no. [stub]', 'clarify');
      return;
    }
    pending.delete(permission_id);
    const status = decision === 'YES' ? 'GRANTED' : decision === 'NO' ? 'DENIED' : 'CANCELLED';
    const d = decide(req, req.risk, status, 'human', raw);
    const type = status === 'GRANTED' ? 'permission_granted' : status === 'DENIED' ? 'permission_denied' : 'permission_cancelled';
    hub.emit(type, d, { to: 'all', correlation_id: permission_id });
    hub.audit({ action: 'record_permission', tool: req.operation, reason: req.reason, status: status === 'GRANTED' ? 'success' : status === 'DENIED' ? 'denied' : 'cancelled', risk_level: req.risk, approval_required: true, approval_status: status, user_authorization: raw, correlation_id: permission_id, stub: true });
    hub.setState(status === 'GRANTED' ? 'AUTHORIZED' : 'DENIED');
    hub.say('all', status === 'GRANTED' ? 'Authorization confirmed. Operator may proceed. [stub]' : `Authorization ${status.toLowerCase()}. Operation blocked. [stub]`, 'permission_decision');
    setTimeout(() => hub.setState('MONITORING'), 2000);
  });

  log('security', 'ready (MEDIUM+ needs human; yes/no/stop; ambiguous → clarification)');
}

function decide(req: PermissionRequest, risk: RiskLevel, status: PermissionDecision['status'], by: 'security' | 'human', human_raw?: string): PermissionDecision {
  return {
    permission_id: req.permission_id,
    operation: req.operation,
    requested_by: req.requested_by,
    status,
    risk,
    approval_required: risk !== 'LOW',
    decided_by: by,
    human_raw,
    decided_at: nowIso(),
  };
}

// ------------------------------------------------------------------ main

const runners: Record<AgentId, ((h: HubClient) => Promise<void>) | undefined> = {
  architect: undefined,
  researcher: researcherStub,
  operator: operatorStub,
  security: securityStub,
};

for (const agent of targets) {
  const run = runners[agent];
  if (!run) {
    console.error(`no stub for "${agent}"`);
    continue;
  }
  const hub = await connectHub({ agent, mode: 'stub', meta: { stub: true, host: 'local' }, log: (m) => log(agent, m) });
  await run(hub);
}
console.log(`[stubs] connected: ${targets.join(', ')}. Ctrl+C to stop.`);
