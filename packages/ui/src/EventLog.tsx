import { AGENTS, type AnyEvent } from '@wasp/shared-types';
import { FloatingWindow } from './FloatingWindow';

export function EventLog({ events, rows = 14 }: { events: AnyEvent[]; rows?: number }) {
  const recent = events.slice(-rows).reverse();
  return (
    <FloatingWindow title="EVENT STREAM" className="win--log" meta={`${events.length}`}>
      <ul className="log">
        {recent.map((e) => (
          <li key={e.id} className="log__line">
            <span className="log__time">{e.timestamp.slice(11, 19)}</span>
            <span className="log__from" style={{ color: AGENTS[e.from as keyof typeof AGENTS]?.hex ?? '#9ca3af' }}>
              {e.from}
            </span>
            <span className="log__type">{e.type}</span>
            <span className="log__detail">{describeEvent(e)}</span>
          </li>
        ))}
      </ul>
    </FloatingWindow>
  );
}

/** One-line human description of any event on the bus. */
export function describeEvent(e: AnyEvent): string {
  switch (e.type) {
    case 'agent_state':
      return `${e.payload.agent}: ${e.payload.state}${e.payload.detail ? ` — ${e.payload.detail}` : ''}`;
    case 'agent_message':
      return `${e.payload.intent ?? 'message'} → ${e.to}: ${e.payload.message.slice(0, 70)}`;
    case 'user_message':
      return e.payload.text.slice(0, 70);
    case 'user_authorization':
      return `${e.payload.decision} "${e.payload.raw}" (${e.payload.channel})`;
    case 'research_request':
      return e.payload.question.slice(0, 70);
    case 'research_started':
      return e.payload.request_id;
    case 'research_result':
      return `${e.payload.results.length} results, ${e.payload.counts.VERIFIED} verified${e.payload.stub ? ' [STUB]' : ''}`;
    case 'validation_request':
      return e.payload.description.slice(0, 70);
    case 'validation_result':
      return `validated=${e.payload.validated}${e.payload.stub ? ' [STUB]' : ''} — ${e.payload.summary.slice(0, 60)}`;
    case 'tools_registered':
      return `${e.payload.tools.length} tools`;
    case 'tool_requested':
      return e.payload.tool_id;
    case 'tool_started':
      return e.payload.tool_id;
    case 'tool_finished':
    case 'sandbox_result':
      return `${e.payload.tool_id}: ${e.payload.status}${e.payload.summary ? ` — ${e.payload.summary.slice(0, 50)}` : ''}`;
    case 'sandbox_test':
      return e.payload.command;
    case 'sandbox_state':
    case 'sandbox_started':
      return `${e.payload.status} / ${e.payload.network}${e.payload.available ? '' : ' (Docker unavailable)'}`;
    case 'permission_requested':
      return `${e.payload.operation} by ${e.payload.requested_by}`;
    case 'permission_required':
      return `${e.payload.operation} risk ${e.payload.risk}${e.payload.approval_required ? ' — HUMAN' : ''}`;
    case 'permission_granted':
    case 'permission_denied':
    case 'permission_cancelled':
      return `${e.payload.operation}: ${e.payload.status} (${e.payload.decided_by}${e.payload.human_raw ? ` "${e.payload.human_raw}"` : ''})`;
    case 'permission_clarification_needed':
      return e.payload.human_prompt.slice(0, 70);
    case 'speak_requested':
    case 'tts_started':
      return `${e.payload.agent}: ${e.payload.text.slice(0, 60)}`;
    case 'tts_finished':
      return `${e.payload.agent}: ${e.payload.ok ? 'ok' : e.payload.error ?? 'error'}`;
    case 'stt_transcript':
      return `${e.payload.final ? '' : '… '}${e.payload.text.slice(0, 70)}`;
    case 'workshop_updated':
      return `${e.payload.workshop.title || '(untitled)'} — lab.validated=${e.payload.workshop.lab.validated}`;
    case 'final_response':
      return e.payload.text.slice(0, 70);
    case 'decision_made':
      return e.payload.decision.slice(0, 70);
    case 'session_state':
      return e.payload.state;
    case 'warning':
    case 'error':
    case 'hub_error':
      return e.payload.message;
    case 'agent_registered':
    case 'agent_started':
      return `${e.payload.agent} (${e.payload.mode})`;
    case 'agent_offline':
      return e.payload.agent;
    case 'agent_finished':
      return e.payload.summary?.slice(0, 70) ?? '';
    case 'audit_event':
      return `${e.payload.agent} ${e.payload.action} ${e.payload.status}${e.payload.stub ? ' [STUB]' : ''}`;
    default:
      return '';
  }
}
