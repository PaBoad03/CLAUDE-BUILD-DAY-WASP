import { AGENTS, AGENT_IDS, type AgentId, type SharedContext, type WaspEvent } from '@wasp/shared-types';
import { FloatingWindow } from './FloatingWindow';

/** The visible agent-to-agent conversation (CONTEXT.md §8). */
export function CommunicationWindow({ messages, rows = 6, title = 'AGENT COMMUNICATION' }: { messages: WaspEvent<'agent_message'>[]; rows?: number; title?: string }) {
  const recent = messages.slice(-rows);
  return (
    <FloatingWindow title={title}>
      {recent.length === 0 && <p className="muted">Waiting for the architect...</p>}
      <ul className="chat">
        {recent.map((m) => {
          const color = AGENTS[m.from as keyof typeof AGENTS]?.hex ?? '#e5e7eb';
          return (
            <li key={m.id} className="chat__item">
              <span className="chat__route" style={{ color }}>
                {m.from.toUpperCase()} → {String(m.to).toUpperCase()}
                {m.payload.intent ? ` · ${m.payload.intent}` : ''}
              </span>
              <span className="chat__text">“{m.payload.message}”</span>
            </li>
          );
        })}
      </ul>
    </FloatingWindow>
  );
}

/** Presence + face state of the four agents. UI sockets do not count (hub rule). */
export function AgentsWindow({ context }: { context: SharedContext | null }) {
  return (
    <FloatingWindow title="AGENTS">
      <ul className="agents">
        {AGENT_IDS.map((id) => {
          const p = context?.agents[id];
          const online = p?.status === 'online';
          const state = context?.agent_states[id] ?? 'OFFLINE';
          return (
            <li key={id} className={`agents__row ${online ? '' : 'agents__row--off'}`} style={{ ['--row' as string]: AGENTS[id].hex }}>
              <span className="agents__dot" />
              <span className="agents__name">{AGENTS[id].name.toUpperCase()}</span>
              <span className="agents__status">{online ? (p?.mode === 'stub' ? 'STUB' : 'ONLINE') : 'OFFLINE'}</span>
              <span className="agents__state">{state.replace(/_/g, ' ')}</span>
            </li>
          );
        })}
      </ul>
    </FloatingWindow>
  );
}

const PERM_CLASS: Record<string, string> = { GRANTED: 'good', AUTO_APPROVED: 'good', AWAITING_HUMAN: 'warn', PENDING: 'warn', DENIED: 'bad', CANCELLED: 'bad', BLOCKED: 'bad', EXPIRED: 'bad' };

export function PermissionsWindow({ context, rows = 6 }: { context: SharedContext | null; rows?: number }) {
  const perms = (context?.permissions ?? []).slice(-rows).reverse();
  const awaiting = perms.find((p) => p.status === 'AWAITING_HUMAN');
  return (
    <FloatingWindow title="PERMISSIONS" meta={awaiting ? 'HUMAN APPROVAL REQUIRED' : undefined} className={awaiting ? 'win--alert' : ''}>
      {awaiting && (
        <div className="review">
          <div className="review__row"><b>ACTION</b><span>{awaiting.operation}</span></div>
          <div className="review__row"><b>AGENT</b><span>{awaiting.requested_by.toUpperCase()}</span></div>
          <div className="review__row"><b>RISK</b><span className={`risk-${awaiting.risk}`}>{awaiting.risk}</span></div>
          <p className="review__prompt">{awaiting.human_prompt}</p>
        </div>
      )}
      {perms.length === 0 && <p className="muted">No permissions requested yet.</p>}
      <ul className="rows">
        {perms.map((p) => (
          <li key={p.permission_id} className="rows__row">
            <span style={{ color: AGENTS[p.requested_by].hex }}>{p.requested_by}</span>
            <span>{p.operation}<span className="muted"> {p.risk ?? ''}</span></span>
            <span className={PERM_CLASS[p.status] ?? ''}>{p.status.replace(/_/g, ' ')}{p.human_raw ? <small className="muted"> “{p.human_raw}”</small> : null}</span>
          </li>
        ))}
      </ul>
    </FloatingWindow>
  );
}

const AUDIT_CLASS: Record<string, string> = { success: 'good', info: 'muted', failure: 'bad', denied: 'bad', cancelled: 'bad', unavailable: 'warn' };

export function AuditWindow({ context, rows = 8 }: { context: SharedContext | null; rows?: number }) {
  const audit = (context?.audit ?? []).slice(-rows).reverse();
  return (
    <FloatingWindow title="AUDIT" meta={`${context?.audit.length ?? 0}`}>
      {audit.length === 0 && <p className="muted">Nothing recorded yet.</p>}
      <ul className="rows rows--audit">
        {audit.map((a) => (
          <li key={a.id} className="rows__row">
            <span className="muted">{a.timestamp.slice(11, 19)}</span>
            <span>
              <span style={{ color: AGENTS[a.agent as AgentId]?.hex ?? 'inherit' }}>{a.agent}</span> {a.action}
              <span className="muted">{a.tool && a.tool !== a.action ? ` ${a.tool}` : ''}{a.risk_level ? ` · ${a.risk_level}` : ''}{a.user_authorization ? ` · human “${a.user_authorization}”` : ''}{a.stub ? ' · STUB' : ''}</span>
            </span>
            <span className={AUDIT_CLASS[a.status] ?? ''}>{a.status}{a.approval_status ? <small className="muted"> {a.approval_status.replace(/_/g, ' ')}</small> : null}</span>
          </li>
        ))}
      </ul>
    </FloatingWindow>
  );
}

export function SandboxWindow({ context }: { context: SharedContext | null }) {
  const s = context?.sandbox;
  const tools = context?.tools ?? [];
  return (
    <FloatingWindow title="ORANGE / SANDBOX" accent={AGENTS.operator.hex} meta={s?.available ? `Docker ${s.docker_version ?? ''}` : 'DOCKER OFFLINE'}>
      <table className="kv">
        <tbody>
          <tr className={s?.available ? 'kv__good' : 'kv__warn'}><td>DOCKER</td><td>{s?.available ? 'AVAILABLE' : 'OFFLINE'}</td></tr>
          <tr className={s?.status === 'RUNNING' ? 'kv__good' : ''}><td>SANDBOX</td><td>{s?.status ?? '—'}</td></tr>
          <tr className={s?.network === 'EXTERNAL' ? 'kv__warn' : ''}><td>NETWORK</td><td>{s?.network ?? '—'}</td></tr>
          <tr><td>TOOLS</td><td>{tools.length ? `${tools.filter((t) => t.available).length}/${tools.length} available` : '—'}</td></tr>
        </tbody>
      </table>
      {s?.last_test && (
        <p className={`small ${s.last_test.status === 'success' ? 'good' : 'bad'}`}>
          {s.last_test.command?.length ? `> ${s.last_test.command.join(' ')}` : s.last_test.tool_id} — {s.last_test.status.toUpperCase()}{s.last_test.stub ? ' [STUB]' : ''}
        </p>
      )}
      {s?.message && <p className="muted small">{s.message}</p>}
    </FloatingWindow>
  );
}

export function WorkshopWindow({ context }: { context: SharedContext | null }) {
  const w = context?.workshop;
  if (!w || !w.title) {
    return (
      <FloatingWindow title="WORKSHOP">
        <p className="muted">No workshop yet.</p>
      </FloatingWindow>
    );
  }
  return (
    <FloatingWindow title="WORKSHOP" meta={`${w.duration_minutes} min · ${w.level}`}>
      <p className="win__headline">{w.title}</p>
      <ul className="agenda">
        {w.agenda.map((a, i) => (
          <li key={i}><span className="muted">{a.minutes}′</span> {a.title}</li>
        ))}
      </ul>
      <p className={`small ${w.lab.validated ? 'good' : 'warn'}`}>
        LAB {w.lab.validated ? 'VALIDATED' : 'NOT VALIDATED'}{w.lab.validation_note ? ` — ${w.lab.validation_note}` : ''}
      </p>
    </FloatingWindow>
  );
}

export function TaskWindow({ context }: { context: SharedContext | null }) {
  return (
    <FloatingWindow title="CURRENT TASK" meta={context?.current_state.replace(/_/g, ' ')}>
      {context?.user_request ? <p className="task">“{context.user_request}”</p> : <p className="muted">Waiting for the human.</p>}
      {context?.decisions.length ? (
        <ul className="decisions">
          {context.decisions.slice(-3).map((d) => (
            <li key={d.id}><span className="muted">{d.timestamp.slice(11, 19)}</span> {d.decision}</li>
          ))}
        </ul>
      ) : null}
      {context?.final_response && <p className="small good">{context.final_response}</p>}
    </FloatingWindow>
  );
}

export function ResearchStatusWindow({ context }: { context: SharedContext | null }) {
  const r = context?.research ?? [];
  const counts = { FOUND: 0, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 0 };
  for (const x of r) counts[x.verification_status]++;
  const stub = r.some((x) => x.stub);
  return (
    <FloatingWindow title="MAGENTA / RESEARCH" accent={AGENTS.researcher.hex} meta={r.length ? `${r.length} sources${stub ? ' · STUB' : ''}` : undefined}>
      <table className="kv">
        <tbody>
          <tr><td>FOUND</td><td>{counts.FOUND}</td></tr>
          <tr className={counts.VERIFIED ? 'kv__good' : 'kv__zero'}><td>VERIFIED</td><td>{counts.VERIFIED}</td></tr>
          <tr><td>UNKNOWN</td><td>{counts.UNKNOWN}</td></tr>
          <tr className={counts.CONTRADICTED ? 'kv__warn' : ''}><td>CONTRADICTED</td><td>{counts.CONTRADICTED}</td></tr>
        </tbody>
      </table>
    </FloatingWindow>
  );
}
