import { AGENTS, type AnyEvent } from "@wasp/shared-types";
import { FloatingWindow } from "./FloatingWindow";

export function EventLog({ events }: { events: AnyEvent[] }) {
  const recent = events.slice(-14).reverse();
  return (
    <FloatingWindow title="EVENT STREAM" className="win--log" meta={`${events.length}`}>
      <ul className="log">
        {recent.map((e) => (
          <li key={e.id} className="log__line">
            <span className="log__time">{e.timestamp.slice(11, 19)}</span>
            <span className="log__from" style={{ color: AGENTS[e.from as keyof typeof AGENTS]?.hex ?? "#9ca3af" }}>
              {e.from}
            </span>
            <span className="log__type">{e.type}</span>
            <span className="log__detail">{describe(e)}</span>
          </li>
        ))}
      </ul>
    </FloatingWindow>
  );
}

function describe(e: AnyEvent): string {
  switch (e.type) {
    case "agent_state":
      return `${e.payload.agent}: ${e.payload.state}${e.payload.detail ? ` — ${e.payload.detail}` : ""}`;
    case "agent_message":
      return `${e.payload.intent ?? "message"}: ${e.payload.message.slice(0, 70)}`;
    case "research_request":
      return e.payload.question.slice(0, 70);
    case "research_started":
      return e.payload.request_id;
    case "research_result":
      return `${e.payload.results.length} results, ${e.payload.counts.VERIFIED} verified${e.payload.stub ? " [STUB]" : ""}`;
    case "warning":
    case "error":
    case "hub_error":
      return e.payload.message;
    case "agent_registered":
    case "agent_started":
      return `${e.payload.agent} (${e.payload.mode})`;
    case "agent_offline":
      return e.payload.agent;
    case "agent_finished":
      return e.payload.summary?.slice(0, 70) ?? "";
    case "audit_event":
      return `${e.payload.agent} ${e.payload.action} ${e.payload.status}`;
    default:
      return "";
  }
}
