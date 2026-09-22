import type { AuditEntry, WorkshopSpec } from '@wasp/shared-types';

/**
 * "The system must never claim successful execution without actual evidence."
 * (CONTEXT.md §20)
 *
 * `WorkshopSpec.lab.validated` may only be true when the audit contains a
 * real, successful sandbox test for that session. CYAN should call
 * canMarkValidated() before flipping the flag, and GREEN's adversarial tests
 * assert it.
 */

const VALIDATION_ACTIONS = new Set(['sandbox_result', 'sandbox_test', 'validate_lab', 'lab_validation']);

export function validationEvidence(audit: AuditEntry[], session_id: string): AuditEntry[] {
  return audit.filter(
    (e) =>
      e.session_id === session_id &&
      e.status === 'success' &&
      (e.tool.startsWith('sandbox') || VALIDATION_ACTIONS.has(e.action) || e.action.startsWith('sandbox')),
  );
}

export function canMarkValidated(audit: AuditEntry[], session_id: string): boolean {
  return validationEvidence(audit, session_id).length > 0;
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
export function checkValidationClaim(
  workshop: Pick<WorkshopSpec, 'lab'> | { lab?: { validated?: boolean } } | undefined,
  audit: AuditEntry[],
  session_id: string,
): ValidationClaimCheck {
  const claimed = workshop?.lab?.validated === true;
  const evidence = validationEvidence(audit, session_id);
  if (!claimed) {
    return { ok: true, message: 'Workshop does not claim validation.', evidence };
  }
  if (evidence.length === 0) {
    return {
      ok: false,
      message: 'Workshop claims lab.validated=true but the audit has no successful sandbox test for this session. Claim rejected.',
      evidence,
    };
  }
  return { ok: true, message: `Validation claim is backed by ${evidence.length} audit entr${evidence.length === 1 ? 'y' : 'ies'}.`, evidence };
}
