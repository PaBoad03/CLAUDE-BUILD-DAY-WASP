/**
 * How CYAN asks the human something and waits for the answer.
 *
 * Sources, first one wins:
 *   - WASP_AUTO_ANSWER=yes|no|stop|maybe   non-interactive (rehearsals, tests)
 *   - stt_transcript { final: true }        the voice layer (Andrea) heard the human
 *   - user_message from 'human'             a UI / HTTP bridge typed for the human
 *   - stdin                                 the CLI
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { HubClient } from '@wasp/event-bus';

export interface HumanIO {
  /** Ask and wait for a raw answer (transcript / typed text). */
  ask(prompt: string): Promise<string>;
  close(): void;
}

export interface CliHumanOptions {
  hub: Pick<HubClient, 'on' | 'say'>;
  autoAnswer?: string;
  log?: (m: string) => void;
}

export class CliHuman implements HumanIO {
  private rl: readline.Interface | null = null;
  private pending: ((answer: string) => void) | null = null;
  private offs: Array<() => void> = [];

  constructor(private readonly o: CliHumanOptions) {
    if (!o.autoAnswer) this.rl = readline.createInterface({ input: stdin, output: stdout });
    // Voice / UI answers resolve the pending question, whoever asked it.
    this.offs.push(
      o.hub.on('stt_transcript', (e) => {
        if (e.payload.final && this.pending) this.resolve(e.payload.text, 'voice');
      }),
      o.hub.on('user_message', (e) => {
        if (e.from === 'human' && this.pending) this.resolve(e.payload.text, 'ui');
      }),
    );
  }

  /** Spoken + visible acknowledgement, so the human knows WASP took exactly these words. */
  private acknowledge(text: string): void {
    const short = text.length > 90 ? `${text.slice(0, 87)}…` : text;
    this.o.hub.say('human', `Te escuché: “${short}”.`, 'heard');
  }

  async ask(prompt: string): Promise<string> {
    if (this.o.autoAnswer) {
      console.log(`\n  CYAN asks you: ${prompt}  [auto-answer: ${this.o.autoAnswer}]`);
      return this.o.autoAnswer;
    }
    return new Promise<string>((resolve) => {
      this.pending = resolve;
      // stdin and hub events race; the first answer wins.
      void this.rl?.question(`\n  CYAN asks you: ${prompt}  > `).then((a) => this.resolve(a.trim()), () => {});
    });
  }

  private resolve(answer: string, source: 'voice' | 'ui' | 'stdin' = 'stdin'): void {
    const p = this.pending;
    this.pending = null;
    if (p && source !== 'stdin') this.acknowledge(answer);
    p?.(answer);
  }

  close(): void {
    for (const off of this.offs) off();
    this.rl?.close();
  }
}
