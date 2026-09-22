import type { ResearchRequest, ResearchResult, ResearchSummary, VerificationStatus } from "@wasp/shared-types";

/**
 * MAGENTA-side research types. They EXTEND the shared contract
 * (`packages/shared-types/src/research.ts`) — they never redefine it.
 * Extra fields travel as plain JSON; consumers that only know the shared
 * type simply ignore them.
 */

/** What the engine actually needs from a ResearchRequest. */
export interface ResearchQuery {
  question: string;
  focus?: string[];
  max_results?: number;
}

export function toQuery(req: ResearchRequest): ResearchQuery {
  const scope = (req.scope ?? {}) as Record<string, unknown>;
  const focus = Array.isArray(scope.focus) ? scope.focus.filter((f): f is string => typeof f === "string") : undefined;
  const max = typeof scope.max_results === "number" ? scope.max_results : undefined;
  return { question: req.question, ...(focus ? { focus } : {}), ...(max ? { max_results: max } : {}) };
}

/** A shared ResearchResult plus MAGENTA's extra evidence fields. */
export interface MagentaResearchResult extends ResearchResult {
  kind: NonNullable<ResearchResult["kind"]>;
  procedure: string;
  evidence: string;
  /** Non-fatal flags, e.g. "possible prompt injection in source". PROPOSED for the shared type. */
  warnings: string[];
  /** ISO-8601. PROPOSED for the shared type. */
  retrieved_at: string;
}

export type ResearchMode = "web" | "catalog";

/** The `research_result` payload MAGENTA emits: a shared ResearchSummary plus honesty metadata. */
export interface MagentaResearchSummary extends ResearchSummary {
  results: MagentaResearchResult[];
  /** "web" = live Claude web search, "catalog" = curated offline catalog. */
  mode: ResearchMode;
  /** True when the engine could not do everything it wanted (no API key, API error, refusal…). */
  degraded: boolean;
  degraded_reason?: string;
  official_count: number;
}

/** A raw finding before the engine normalises it. Sources may never suggest VERIFIED. */
export type RawFinding = Omit<MagentaResearchResult, "id" | "warnings" | "retrieved_at" | "verification_status" | "stub"> & {
  verification_status: Exclude<VerificationStatus, "VERIFIED">;
};

/**
 * A pluggable research source. Implementations: CatalogSource (offline,
 * curated) and ClaudeWebSource (live web search through the Claude API).
 */
export interface ResearchSource {
  readonly name: string;
  readonly mode: ResearchMode;
  /** Cheap check the engine uses to decide whether to try this source. */
  isAvailable(): boolean;
  search(query: ResearchQuery): Promise<RawFinding[]>;
}

export class ResearchSourceError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ResearchSourceError";
  }
}
