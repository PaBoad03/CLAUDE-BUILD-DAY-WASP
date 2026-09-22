import type { HubClient } from "@wasp/event-bus";
import type { FaceState, ResearchRequest, WaspEvent } from "@wasp/shared-types";
import type { ResearchEngine } from "../research/ResearchEngine";

/**
 * MAGENTA runtime: answers `research_request` from the architect through the
 * shared hub, exactly as docs/CONTRACT.md §4/§5 describe.
 *
 * Every step is an event so UI, voice, audit and shared context all see the
 * same thing (CONTEXT.md §7: "Audio is the EXPERIENCE. Structured events are
 * the SYSTEM.").
 */

/** The slice of HubClient the agent needs. Tests pass a fake; production passes the real client. */
export type HubLike = Pick<HubClient, "agent" | "onMine" | "emit" | "say" | "setState" | "audit">;

/** First sentence of the summary, plus the FOUND ≠ VERIFIED reminder when nothing was verified. */
export function spokenLine(summary: string, verified: number): string {
  const first = summary.split(/(?<=[.!?])\s+/)[0]?.trim() || summary.trim();
  if (verified > 0) return first;
  return /not (experimentally )?validated|no verificad/i.test(first) ? first : `${first} Documented, but not experimentally validated.`;
}

export interface ResearcherAgentOptions {
  hub: HubLike;
  engine: ResearchEngine;
  log?: (msg: string) => void;
}

export class ResearcherAgent {
  private readonly hub: HubLike;
  private readonly engine: ResearchEngine;
  private readonly log: (msg: string) => void;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;

  constructor(opts: ResearcherAgentOptions) {
    this.hub = opts.hub;
    this.engine = opts.engine;
    this.log = opts.log ?? (() => {});
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.hub.onMine("research_request", (evt) => {
      // Serialise requests: one research run at a time keeps the face/voice coherent.
      this.queue = this.queue.then(() => this.handle(evt)).catch(() => {});
    });
    this.setState("IDLE", "researcher online");
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setState("OFFLINE");
  }

  /** Resolves when all queued requests have finished (useful in tests). */
  idle(): Promise<void> {
    return this.queue;
  }

  private async handle(evt: WaspEvent<"research_request">): Promise<void> {
    const req: ResearchRequest = evt.payload;
    const replyTo = evt.from;
    const correlation_id = evt.correlation_id ?? req.request_id;
    this.log(`research request from ${replyTo}: ${req.question}`);

    this.setState("LISTENING", "request received");
    this.hub.say(replyTo, "Research request received.", "research_ack", { request_id: req.request_id });

    const mode = this.engine.plannedMode();
    this.setState("RESEARCHING", mode === "web" ? "searching the web" : "searching curated catalog");
    this.hub.emit("research_started", { request_id: req.request_id }, { to: replyTo, correlation_id });

    try {
      const summary = await this.engine.research(req);

      this.setState("ANALYZING", `${summary.results.length} sources`);
      if (summary.degraded && summary.degraded_reason) {
        this.hub.emit("warning", { message: "Research ran in degraded mode", detail: summary.degraded_reason }, { correlation_id });
      }
      const flagged = summary.results.filter((r) => r.warnings.length > 0);
      if (flagged.length > 0) {
        this.setState("WARNING", `${flagged.length} source(s) flagged`);
        this.hub.emit(
          "warning",
          {
            message: `${flagged.length} source(s) contained instruction-like text; treated as untrusted data`,
            detail: flagged.map((r) => r.source),
          },
          { correlation_id },
        );
      }

      // The structured result. Hub folds it into SharedContext.research and broadcasts it.
      this.hub.emit("research_result", summary, { to: replyTo, correlation_id });

      this.setState("SENDING", `reporting to ${replyTo}`);
      // The spoken/visible line. Details stay on screen; the voice line is ONE sentence (docs/CORRECCIONES.md M4).
      // The full summary still travels in research_result.summary.
      this.hub.say(replyTo, spokenLine(summary.summary, summary.counts.VERIFIED), "research_complete", {
        request_id: req.request_id,
        counts: summary.counts,
        mode: summary.mode,
        degraded: summary.degraded,
      });

      this.hub.audit({
        action: "research",
        tool: summary.mode === "web" ? "claude_web_search" : "curated_catalog",
        reason: req.question,
        input: { request_id: req.request_id },
        result: { counts: summary.counts, degraded: summary.degraded, degraded_reason: summary.degraded_reason },
        status: "success",
        risk_level: "LOW",
        approval_required: false,
        correlation_id,
      });
      this.hub.emit("agent_finished", { agent: "researcher", summary: summary.summary }, { correlation_id });
      this.setState("COMPLETE", summary.degraded ? "complete (degraded)" : "research complete");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.log(`research failed: ${detail}`);
      this.hub.emit("error", { message: "Research failed", detail }, { correlation_id });
      this.hub.say(replyTo, `Architect, I could not complete the research: ${detail}. I have no sources to report.`, "research_failed", {
        request_id: req.request_id,
      });
      this.hub.audit({
        action: "research",
        reason: req.question,
        input: { request_id: req.request_id },
        result: { error: detail },
        status: "failure",
        risk_level: "LOW",
        approval_required: false,
        correlation_id,
      });
      this.hub.emit("agent_finished", { agent: "researcher", summary: `failed: ${detail}` }, { correlation_id });
      this.setState("ERROR", detail);
    }
  }

  private setState(state: FaceState, detail?: string) {
    this.hub.setState(state, detail);
  }
}
