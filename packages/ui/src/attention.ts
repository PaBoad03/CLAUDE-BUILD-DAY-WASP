import type { AgentId, Participant, WaspEvent } from '@wasp/shared-types';
import type { LookTarget } from './face3d/FaceScene';

/**
 * Where this PC's face should look, from the conversation: toward whoever the agent last spoke to,
 * or toward whoever last spoke to it. Seats around the (imaginary) table: CYAN center, MAGENTA right,
 * ORANGE left, GREEN up, human = the camera.
 */
const SEAT: Record<Participant, LookTarget> = {
  architect: 'center',
  researcher: 'right',
  operator: 'left',
  security: 'up',
  human: 'human',
  hub: 'center',
  all: 'human',
};

export function attentionFor(agent: AgentId, messages: WaspEvent<'agent_message'>[]): LookTarget {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from === agent) return m.to === agent ? 'human' : SEAT[m.to] ?? 'center';
    if (m.to === agent || m.to === 'all') return SEAT[m.from] ?? 'center';
  }
  return 'human';
}
