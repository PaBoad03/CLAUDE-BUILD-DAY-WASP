import { AGENTS, type FaceState, type WaspEvent } from "@wasp/shared-types";
import type { MagentaResearchResult, MagentaResearchSummary } from "../../research/types";
import { FloatingWindow } from "./FloatingWindow";

const KIND_LABEL: Record<MagentaResearchResult["kind"], string> = {
  official: "Official documentation",
  academic: "University material",
  technical_reference: "Technical reference",
  community: "Community source",
  unknown: "Unclassified source",
};

export function SourcesWindow({ research, state }: { research: MagentaResearchSummary | null; state: FaceState }) {
  const searching = state === "RESEARCHING";
  return (
    <FloatingWindow title="MAGENTA / SOURCES" meta={research ? `${research.mode.toUpperCase()}${research.stub ? " · STUB" : ""}` : undefined}>
      {searching && <p className="blink">Searching sources...</p>}
      {!research && !searching && <p className="muted">No research yet.</p>}
      {research && (
        <>
          <p className="win__headline">
            {research.results.length} SOURCE{research.results.length === 1 ? "" : "S"} FOUND
          </p>
          <ul className="list">
            {research.results.map((r) => {
              const warnings = r.warnings ?? [];
              const flagged = warnings.length > 0 || r.kind === "community" || r.kind === "unknown";
              return (
                <li key={r.id} className={flagged ? "list__item list__item--warn" : "list__item"}>
                  <span className="list__mark">{flagged ? "⚠" : "✓"}</span>
                  <span className="list__text">
                    <span className="list__kind">{KIND_LABEL[r.kind ?? "unknown"]}</span>
                    <a href={r.source} target="_blank" rel="noreferrer" className="list__title">
                      {r.title}
                    </a>
                    <span className="list__claim">{r.claim}</span>
                    {warnings.map((w) => (
                      <span key={w} className="list__warning">
                        {w}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
          {research.degraded && <p className="degraded">DEGRADED: {research.degraded_reason}</p>}
        </>
      )}
    </FloatingWindow>
  );
}

export function VerificationWindow({ research }: { research: MagentaResearchSummary | null }) {
  const c = research?.counts ?? { FOUND: 0, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 0 };
  return (
    <FloatingWindow title="MAGENTA / VERIFICATION">
      <table className="kv">
        <tbody>
          <tr>
            <td>FOUND</td>
            <td>{c.FOUND}</td>
          </tr>
          <tr className={c.VERIFIED === 0 ? "kv__zero" : "kv__good"}>
            <td>VERIFIED</td>
            <td>{c.VERIFIED}</td>
          </tr>
          <tr>
            <td>UNKNOWN</td>
            <td>{c.UNKNOWN}</td>
          </tr>
          <tr className={c.CONTRADICTED > 0 ? "kv__warn" : ""}>
            <td>CONTRADICTED</td>
            <td>{c.CONTRADICTED}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">VERIFIED requires real execution by ORANGE in the sandbox. Documentation alone is FOUND.</p>
    </FloatingWindow>
  );
}

export function CommunicationWindow({ messages }: { messages: WaspEvent<"agent_message">[] }) {
  const recent = messages.slice(-6);
  return (
    <FloatingWindow title="AGENT COMMUNICATION">
      {recent.length === 0 && <p className="muted">Waiting for the architect...</p>}
      <ul className="chat">
        {recent.map((m) => {
          const color = AGENTS[m.from as keyof typeof AGENTS]?.hex ?? "#e5e7eb";
          return (
            <li key={m.id} className="chat__item">
              <span className="chat__route" style={{ color }}>
                {m.from.toUpperCase()} → {m.to.toUpperCase()}
                {m.payload.intent ? ` · ${m.payload.intent}` : ""}
              </span>
              <span className="chat__text">“{m.payload.message}”</span>
            </li>
          );
        })}
      </ul>
    </FloatingWindow>
  );
}
