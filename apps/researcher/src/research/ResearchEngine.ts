import { newId, type ResearchRequest, type VerificationStatus } from "@wasp/shared-types";
import { injectionWarning, scanForInjection } from "./injection";
import {
  ResearchSourceError,
  toQuery,
  type MagentaResearchResult,
  type MagentaResearchSummary,
  type RawFinding,
  type ResearchMode,
  type ResearchSource,
} from "./types";

/**
 * The MAGENTA research engine.
 *
 * Tries sources in order (web first, catalog as fallback). Whatever happens,
 * it returns an honest payload: `degraded` + `degraded_reason` tell CYAN when
 * the engine could not do live research. It never emits VERIFIED.
 */
export interface ResearchEngineOptions {
  sources: ResearchSource[];
  now?: () => Date;
  idFactory?: () => string;
  log?: (msg: string) => void;
}

export class ResearchEngine {
  private readonly sources: ResearchSource[];
  private readonly now: () => Date;
  private readonly makeId: () => string;
  private readonly log: (msg: string) => void;

  constructor(opts: ResearchEngineOptions) {
    this.sources = opts.sources;
    this.now = opts.now ?? (() => new Date());
    this.makeId = opts.idFactory ?? (() => newId("res"));
    this.log = opts.log ?? (() => {});
  }

  /** Which mode a run would use right now (for logs / face detail). */
  plannedMode(): ResearchMode {
    return this.sources.find((s) => s.isAvailable())?.mode ?? "catalog";
  }

  async research(request: ResearchRequest): Promise<MagentaResearchSummary> {
    const query = toQuery(request);
    let degraded = false;
    let degraded_reason: string | undefined;
    let mode: ResearchMode = "catalog";
    let raw: RawFinding[] = [];
    let ran = false;

    for (const source of this.sources) {
      if (!source.isAvailable()) {
        if (source.mode === "web") {
          degraded = true;
          degraded_reason = `${source.name} unavailable (no credentials)`;
        }
        continue;
      }
      try {
        this.log(`research via ${source.name}`);
        raw = await source.search(query);
        mode = source.mode;
        ran = true;
        if (raw.length > 0) break;
        this.log(`${source.name} returned nothing; trying next source`);
      } catch (err) {
        degraded = true;
        degraded_reason = err instanceof ResearchSourceError ? err.message : `${source.name} failed`;
        this.log(`${source.name} failed: ${degraded_reason}`);
      }
    }

    if (!ran && raw.length === 0) {
      throw new ResearchSourceError(degraded_reason ?? "no research source available", "engine");
    }

    const results = raw.map((f) => this.normalise(f));
    const counts = countStatuses(results);
    const official_count = results.filter((r) => r.kind === "official").length;
    return {
      request_id: request.request_id,
      results,
      counts,
      summary: narrative(counts, official_count, mode, degraded),
      mode,
      degraded,
      ...(degraded_reason ? { degraded_reason } : {}),
      official_count,
    };
  }

  private normalise(f: RawFinding): MagentaResearchResult {
    const warnings: string[] = [];
    const scan = scanForInjection(`${f.title}\n${f.claim}\n${f.procedure}\n${f.evidence}`);
    const w = injectionWarning(scan);
    let confidence = f.confidence;
    if (w) {
      warnings.push(w);
      confidence = "low";
    }
    // Defensive: VERIFIED can only be set by an actual validation step (ORANGE).
    const status: VerificationStatus = (f.verification_status as string) === "VERIFIED" ? "FOUND" : f.verification_status;
    return {
      id: this.makeId(),
      source: f.source,
      title: f.title,
      kind: f.kind,
      claim: f.claim,
      procedure: f.procedure,
      verification_status: status,
      evidence: f.evidence,
      confidence,
      warnings,
      retrieved_at: this.now().toISOString(),
    };
  }
}

export function countStatuses(results: { verification_status: VerificationStatus }[]): Record<VerificationStatus, number> {
  const c: Record<VerificationStatus, number> = { FOUND: 0, VERIFIED: 0, CONTRADICTED: 0, UNKNOWN: 0 };
  for (const r of results) c[r.verification_status]++;
  return c;
}

export function narrative(c: Record<VerificationStatus, number>, official: number, mode: ResearchMode, degraded: boolean): string {
  const total = c.FOUND + c.VERIFIED + c.CONTRADICTED + c.UNKNOWN;
  const parts: string[] = [];
  parts.push(`Arquitecto, encontré ${total} fuente${total === 1 ? "" : "s"} relevante${total === 1 ? "" : "s"}${official ? `, ${official} oficial${official === 1 ? "" : "es"}` : ""}.`);
  if (c.CONTRADICTED > 0) parts.push(`${c.CONTRADICTED} contradice${c.CONTRADICTED === 1 ? "" : "n"} a otras fuentes.`);
  if (c.VERIFIED === 0) parts.push("El procedimiento está documentado pero no validado experimentalmente en nuestro entorno.");
  if (mode === "catalog") parts.push("La búsqueda web en vivo no estaba disponible; los resultados vienen del catálogo curado.");
  else if (degraded) parts.push("La investigación corrió en modo degradado.");
  return parts.join(" ");
}
