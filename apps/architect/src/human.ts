/**
 * How CYAN asks the human something and waits for the answer.
 *
 * Sources, first one wins:
 *   - WASP_AUTO_ANSWER=yes|no|stop|maybe   non-interactive (rehearsals, tests)
 *   - user_message from 'human'             the CYAN face (dictated or typed, then SEND) or any HTTP bridge
 *   - stdin                                 the CLI
 *
 * The face dictates into a text box and the human presses SEND, so a half-recognised sentence is
 * never taken as the request. Permission answers ("sí" / "no" / "stop") go straight to GREEN as
 * user_authorization from the face; they do not pass through here.
 */

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { HubClient } from '@wasp/event-bus';

export interface HumanIO {
  /** Ask and wait for a raw answer (transcript / typed text). */
  ask(prompt: string, auto?: string | null): Promise<string>;
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
    this.offs.push(
      o.hub.on('user_message', (e) => {
        if (e.from === 'human' && this.pending) this.resolve(e.payload.text, 'ui');
      }),
    );
  }

  /**
   * Ask and wait. `auto` overrides the configured auto-answer for this question:
   * a string answers immediately, `null` forces a real human answer even when WASP_AUTO_ANSWER is set.
   */
  async ask(prompt: string, auto: string | null | undefined = this.o.autoAnswer): Promise<string> {
    if (auto) {
      console.log(`\n  CYAN asks you: ${prompt}  [auto-answer: ${auto}]`);
      return auto;
    }
    if (!this.rl) this.rl = readline.createInterface({ input: stdin, output: stdout });
    return new Promise<string>((resolve) => {
      this.pending = resolve;
      // stdin and the face race; the first answer wins.
      void this.rl?.question(`\n  CYAN asks you: ${prompt}  > `).then((a) => this.resolve(a.trim()), () => {});
    });
  }

  /** Spoken + visible acknowledgement, so the human knows WASP took exactly these words. */
  private acknowledge(text: string): void {
    const short = text.length > 90 ? `${text.slice(0, 87)}…` : text;
    this.o.hub.say('human', `Te escuché: “${short}”.`, 'heard');
  }

  private resolve(answer: string, source: 'ui' | 'stdin' = 'stdin'): void {
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
