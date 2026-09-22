import { execFile } from 'node:child_process';
import type { AgentId } from '@wasp/tools';

/**
 * Speaker interface. `packages/voice` (owner: Andrea) should provide the
 * real TTS. Until then ORANGE uses a console speaker, or macOS `say` when
 * started with `--tts say`. Everything spoken is ALSO emitted as an
 * `agent_message` event, so the shared voice layer can pick it up later
 * without any change here.
 */
export interface Speaker {
  speak(agent: AgentId, text: string): Promise<void>;
}

export class ConsoleSpeaker implements Speaker {
  async speak(agent: AgentId, text: string) {
    console.log(`🟠 ${agent.toUpperCase()} says: "${text}"`);
  }
}

/** macOS only. Non-blocking; failures are swallowed so TTS can never stall execution. */
export class SayCommandSpeaker implements Speaker {
  constructor(private readonly voice = 'Daniel') {}
  async speak(agent: AgentId, text: string) {
    console.log(`🟠 ${agent.toUpperCase()} says: "${text}"`);
    await new Promise<void>((done) => {
      execFile('say', ['-v', this.voice, text], () => done());
    });
  }
}
