/**
 * Pure reducer: (context, event) → { context, changed }.
 * This is how events become shared state. No I/O here, so it is unit-testable.
 */

import {
  AGENT_IDS,
  emptyWorkshop,
  type AgentId,
  type AnyEvent,
  type PermissionRecord,
  type ResearchResult,
  type SharedContext,
} from '@wasp/shared-types';

export function initialContext(session_id: string, started_at: string): SharedContext {
  const agents = Object.fromEntries(
    AGENT_IDS.map((id) => [id, { agent: id, mode: 'real', status: 'offline' }]),
  ) as SharedContext['agents'];
  const agent_states = Object.fromEntries(AGENT_IDS.map((id) => [id, 'OFFLINE'])) as SharedContext['agent_states'];
  return {
    session_id,
    started_at,
    user_request: '',
    current_task: '',
    current_state: 'IDLE',
    workshop: emptyWorkshop(),
    research: [],
    tools: [],
    permissions: [],
    sandbox: { available: false, status: 'OFFLINE', network: 'NONE', message: 'operator not connected' },
    agent_messages: [],
    decisions: [],
    audit: [],
    agents,
    agent_states,
    revision: 0,
  };
}

export interface ReduceResult {
  context: SharedContext;
  changed: string[];
}

const MAX_LIST = 500;

export function reduce(prev: SharedContext, evt: AnyEvent): ReduceResult {
  // Shallow clone; we replace fields we touch.
  const ctx: SharedContext = { ...prev };
  const changed: string[] = [];
  const touch = (k: string) => {
    if (!changed.includes(k)) changed.push(k);
  };
  const push = <K extends 'agent_messages' | 'decisions' | 'audit'>(key: K, item: SharedContext[K][number]) => {
    ctx[key] = [...prev[key], item].slice(-MAX_LIST) as SharedContext[K];
    touch(key);
  };
  const setState = (s: SharedContext['current_state']) => {
    if (ctx.current_state !== s) {
      ctx.current_state = s;
      touch('current_state');
    }
  };

  switch (evt.type) {
    case 'agent_registered':
    case 'agent_started': {
      const p = evt.payload;
      ctx.agents = {
        ...prev.agents,
        [p.agent]: { agent: p.agent, mode: p.mode, meta: p.meta, status: 'online', connected_at: evt.timestamp },
      };
      ctx.agent_states = { ...prev.agent_states, [p.agent]: 'IDLE' };
      touch('agents');
      touch('agent_states');
      break;
    }
    case 'agent_offline': {
      const a = evt.payload.agent;
      ctx.agents = { ...prev.agents, [a]: { ...prev.agents[a], status: 'offline', disconnected_at: evt.timestamp } };
      ctx.agent_states = { ...prev.agent_states, [a]: 'OFFLINE' };
      touch('agents');
      touch('agent_states');
      if (a === 'operator') {
        ctx.sandbox = { ...prev.sandbox, available: false, status: 'OFFLINE', message: 'operator disconnected' };
        touch('sandbox');
      }
      break;
    }
    case 'agent_state': {
      ctx.agent_states = { ...prev.agent_states, [evt.payload.agent]: evt.payload.state };
      touch('agent_states');
      break;
    }
    case 'user_message': {
      ctx.user_request = evt.payload.text;
      ctx.current_task = evt.payload.text;
      touch('user_request');
      touch('current_task');
      setState('RECEIVED_REQUEST');
      break;
    }
    case 'agent_message': {
      push('agent_messages', {
        id: evt.id,
        from: evt.from,
        to: evt.to,
        type: evt.payload.intent ?? 'message',
        message: evt.payload.message,
        timestamp: evt.timestamp,
        spoken: evt.payload.speak ?? true,
      });
      break;
    }
    case 'session_state': {
      setState(evt.payload.state);
      break;
    }
    case 'research_request':
      setState('RESEARCHING');
      break;
    case 'research_result': {
      const incoming: ResearchResult[] = evt.payload.results.map((r) =>
        evt.payload.stub || r.stub ? { ...r, stub: true } : r,
      );
      const byId = new Map(prev.research.map((r) => [r.id, r]));
      for (const r of incoming) byId.set(r.id, r);
      ctx.research = [...byId.values()];
      ctx.workshop = { ...prev.workshop, research: ctx.research };
      touch('research');
      touch('workshop');
      break;
    }
    case 'validation_request':
      setState('VALIDATING');
      break;
    case 'validation_result': {
      const v = evt.payload;
      // validated can ONLY become true through a real (non-stub) validation_result.
      const realValidated = v.validated && !v.stub && v.tests.some((t) => t.status === 'success' && !t.stub);
      ctx.workshop = {
        ...prev.workshop,
        lab: {
          ...prev.workshop.lab,
          validated: realValidated,
          validation_note: realValidated ? v.summary : `${v.stub ? '[STUB] ' : ''}${v.summary}`,
        },
      };
      touch('workshop');
      if (v.tests.length) {
        ctx.sandbox = { ...prev.sandbox, last_test: v.tests[v.tests.length - 1] };
        touch('sandbox');
      }
      break;
    }
    case 'tools_registered': {
      const byId = new Map(prev.tools.map((t) => [t.id, t]));
      for (const t of evt.payload.tools) byId.set(t.id, t);
      ctx.tools = [...byId.values()];
      touch('tools');
      break;
    }
    case 'tool_started':
      setState('EXECUTING');
      break;
    case 'tool_finished':
    case 'sandbox_result': {
      ctx.sandbox = { ...prev.sandbox, last_test: evt.payload };
      touch('sandbox');
      break;
    }
    case 'sandbox_started':
    case 'sandbox_state': {
      ctx.sandbox = { ...evt.payload, last_test: evt.payload.last_test ?? prev.sandbox.last_test };
      touch('sandbox');
      break;
    }
    case 'permission_requested': {
      const p = evt.payload;
      const rec: PermissionRecord = { ...p, status: 'PENDING', requested_at: evt.timestamp };
      ctx.permissions = upsertPermission(prev.permissions, rec);
      touch('permissions');
      break;
    }
    case 'permission_required': {
      const p = evt.payload;
      const existing = prev.permissions.find((x) => x.permission_id === p.permission_id);
      const rec: PermissionRecord = {
        ...(existing ?? {
          permission_id: p.permission_id,
          requested_by: 'operator' as AgentId,
          operation: p.operation,
          reason: p.human_prompt,
          requested_at: evt.timestamp,
        }),
        status: p.approval_required ? 'AWAITING_HUMAN' : 'AUTO_APPROVED',
        risk: p.risk,
        approval_required: p.approval_required,
        human_prompt: p.human_prompt,
      };
      ctx.permissions = upsertPermission(prev.permissions, rec);
      touch('permissions');
      if (p.approval_required) setState('WAITING_FOR_PERMISSION');
      break;
    }
    case 'permission_granted':
    case 'permission_denied':
    case 'permission_cancelled': {
      const d = evt.payload;
      const existing = prev.permissions.find((x) => x.permission_id === d.permission_id);
      const rec: PermissionRecord = {
        ...(existing ?? {
          permission_id: d.permission_id,
          requested_by: d.requested_by,
          operation: d.operation,
          reason: '',
          requested_at: evt.timestamp,
        }),
        status: d.status,
        risk: d.risk,
        approval_required: d.approval_required,
        decided_by: d.decided_by,
        human_raw: d.human_raw,
        decided_at: d.decided_at,
      };
      ctx.permissions = upsertPermission(prev.permissions, rec);
      touch('permissions');
      if (evt.type === 'permission_granted') setState('EXECUTING');
      else setState('SYNTHESIZING');
      break;
    }
    case 'workshop_updated': {
      // Nobody can flip validated to true by editing the workshop; only validation_result can.
      const incoming = evt.payload.workshop;
      ctx.workshop = {
        ...incoming,
        research: prev.research.length ? prev.research : incoming.research,
        lab: { ...incoming.lab, validated: prev.workshop.lab.validated, validation_note: incoming.lab.validation_note ?? prev.workshop.lab.validation_note },
      };
      touch('workshop');
      break;
    }
    case 'decision_made': {
      push('decisions', {
        id: evt.id,
        timestamp: evt.timestamp,
        agent: evt.from as AgentId,
        decision: evt.payload.decision,
        rationale: evt.payload.rationale,
      });
      break;
    }
    case 'audit_event': {
      push('audit', evt.payload);
      break;
    }
    case 'final_response': {
      ctx.final_response = evt.payload.text;
      touch('final_response');
      setState('COMPLETED');
      break;
    }
    case 'session_completed':
      setState('COMPLETED');
      break;
    case 'error':
      setState('FAILED');
      break;
    default:
      break;
  }

  if (changed.length) {
    ctx.revision = prev.revision + 1;
  }
  return { context: ctx, changed };
}

function upsertPermission(list: PermissionRecord[], rec: PermissionRecord): PermissionRecord[] {
  const idx = list.findIndex((p) => p.permission_id === rec.permission_id);
  if (idx === -1) return [...list, rec].slice(-MAX_LIST);
  const next = [...list];
  next[idx] = rec;
  return next;
}
