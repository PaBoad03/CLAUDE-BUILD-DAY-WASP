import type { AgentId } from '@wasp/shared-types';
import type { SpeakOptions } from './tts';

/**
 * Distinct voice per agent so the audience can tell them apart with eyes closed.
 * Language is detected from each line (Spanish lines get a Spanish voice), Spanish by default.
 */
export const AGENT_VOICES: Record<AgentId, SpeakOptions> = {
  architect: { lang: 'auto', fallbackLang: 'es-ES', rate: 1.0, pitch: 0.95 },
  researcher: { lang: 'auto', fallbackLang: 'es-ES', rate: 1.02, pitch: 1.15 },
  operator: { lang: 'auto', fallbackLang: 'es-ES', rate: 1.05, pitch: 0.85 },
  security: { lang: 'auto', fallbackLang: 'es-ES', rate: 0.98, pitch: 1.0 },
};
