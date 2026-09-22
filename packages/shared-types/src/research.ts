/**
 * Research contract. Engine owned by Andrea/MAGENTA.
 * FOUND != VERIFIED. Only actual execution can produce VERIFIED (CONTEXT.md §17).
 */

export type VerificationStatus = 'FOUND' | 'VERIFIED' | 'CONTRADICTED' | 'UNKNOWN';

export type SourceKind = 'official' | 'academic' | 'technical_reference' | 'community' | 'unknown';

export interface ResearchResult {
  id: string;
  source: string; // URL or identifier
  title: string;
  kind?: SourceKind;
  claim: string;
  procedure?: string;
  verification_status: VerificationStatus;
  evidence?: string;
  confidence: 'low' | 'medium' | 'high';
  /** true when produced by a stub responder. Never present it as real research. */
  stub?: boolean;
}

export interface ResearchRequest {
  request_id: string;
  question: string;
  /** Optional constraints: audience level, duration, topic scope. */
  scope?: Record<string, unknown>;
}

export interface ResearchSummary {
  request_id: string;
  results: ResearchResult[];
  /** One or two sentences MAGENTA will speak. */
  summary: string;
  counts: Record<VerificationStatus, number>;
  stub?: boolean;
}
