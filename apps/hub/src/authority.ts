/**
 * Who may emit what. The hub REJECTS events from the wrong sender.
 * This is what makes "the model cannot authorize itself" a system property rather than a prompt.
 *
 * GREEN (Juanda): if you need to tighten this, open a PR here — do not fork it.
 */

import type { EventType, Participant } from '@wasp/shared-types';

export const AUTHORITY: Partial<Record<EventType, readonly Participant[]>> = {
  // hub-only
  session_started: ['hub'],
  session_completed: ['hub', 'architect'],
  session_snapshot: ['hub'],
  agent_offline: ['hub'],
  context_updated: ['hub'],
  hub_error: ['hub'],

  // human input enters through the architect PC (voice/UI bridge) or a 'human' bridge
  user_message: ['human', 'architect'],
  user_authorization: ['human', 'architect'],

  // orchestration
  research_request: ['architect'],
  validation_request: ['architect', 'researcher'],
  final_response: ['architect'],
  workshop_updated: ['architect'],
  session_state: ['architect', 'hub'],

  // research
  research_started: ['researcher'],
  research_result: ['researcher'],

  // execution
  tools_registered: ['operator'],
  tool_started: ['operator'],
  tool_finished: ['operator'],
  sandbox_started: ['operator'],
  sandbox_test: ['operator'],
  sandbox_result: ['operator'],
  sandbox_state: ['operator'],
  validation_result: ['operator'],

  // permissions — ONLY security decides
  permission_required: ['security'],
  permission_granted: ['security'],
  permission_denied: ['security'],
  permission_cancelled: ['security'],
  permission_clarification_needed: ['security'],
};

export function isAllowed(type: EventType, from: Participant): boolean {
  const allowed = AUTHORITY[type];
  return !allowed || allowed.includes(from);
}
