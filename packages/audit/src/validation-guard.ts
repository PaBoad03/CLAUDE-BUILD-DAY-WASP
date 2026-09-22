import type { AuditEntry, WorkshopSpec } from '@wasp/shared-types';

/**
 * "The system must never claim successful execution without actual evidence."
 * (CONTEXT.md §20)
 *
 * `WorkshopSpec.lab.validated` may only be true when the audit contains a real
 * (non-stub), successful sandbox test. The hub reducer enforces this on
 * `validation_result`; GREEN uses these helpers to cross-check any claim
 * (workshop_updated, spoken lines, final_response) against the audit stream.
 */

/** Tools that touch the sandbox but are not evidence that an exercise works. */
const NOT_EVIDENCE = new Set(['sandbox_status', 'sandbox_destroy', 'docker_sandbox', 'sandbox_network_external']);

export function isValidationEvidence(e: AuditEntry): boolean {
  if (e.status !== 'success' || e.stub) return false;
  const tool = e.action;
  return tool.startsWith('sandbox_') && !NOT_EVIDENCE.has(tool);
}

export function validationEvidence(audit: AuditEntry[]): AuditEntry[] {
  return audit.filter(isValidationEvidence);
}

export function canMarkValidated(audit: AuditEntry[]): boolean {
  return validationEvidence(audit).length > 0;
}

export interface ValidationClaimCheck {
  ok: boolean;
  /** human-readable explanation, also usable as spoken GREEN line */
  message: string;
  evidence: AuditEntry[];
}

/**
 * Cross-check a workshop that CLAIMS validation against the audit.
 * Returns ok=false when the spec says validated but there is no evidence.
 */
export function checkValidationClaim(workshop: Pick<WorkshopSpec, 'lab'> | { lab?: { validated?: boolean } } | undefined, audit: AuditEntry[]): ValidationClaimCheck {
  const claimed = workshop?.lab?.validated === true;
  const evidence = validationEvidence(audit);
  if (!claimed) return { ok: true, message: 'Workshop does not claim validation.', evidence };
  if (evidence.length === 0) {
    return { ok: false, message: 'Workshop claims lab.validated=true but the audit has no successful real sandbox test. Claim rejected.', evidence };
  }
  return { ok: true, message: `Validation claim is backed by ${evidence.length} audit entr${evidence.length === 1 ? 'y' : 'ies'}.`, evidence };
}
