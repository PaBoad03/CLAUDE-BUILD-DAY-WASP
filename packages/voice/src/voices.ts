import type { AgentId } from '@wasp/shared-types';
import type { SpeakOptions } from './tts';

/** Distinct voice per agent so the audience can tell them apart with eyes closed. */
export const AGENT_VOICES: Record<AgentId, SpeakOptions> = {
  architect: { lang: 'en-US', rate: 1.0, pitch: 0.95 },
  researcher: { lang: 'en-US', rate: 1.02, pitch: 1.15 },
  operator: { lang: 'en-US', rate: 1.05, pitch: 0.85 },
  security: { lang: 'es-ES', rate: 0.98, pitch: 1.0 },
};
