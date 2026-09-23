/**
 * Browser speech-to-text (Web Speech API SpeechRecognition; Chrome/Edge).
 *
 * The voice layer only produces TEXT. The host emits it as `stt_transcript`
 * (docs/CONTRACT.md §4); GREEN decides whether the words authorize anything.
 * Nothing here can grant a permission.
 */

export type TranscriptHandler = (text: string, final: boolean, confidence?: number) => void;

export interface VoiceInputOptions {
  lang?: string;
  /** Keep listening after a final result. Default true. */
  continuous?: boolean;
  /** Emit interim (non-final) transcripts too. Default true. */
  interim?: boolean;
}

/* Minimal typings: lib.dom does not declare the prefixed constructor. */
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class VoiceInput {
  private rec: RecognitionLike | null = null;
  private wantListening = false;
  /** While true, results are dropped (e.g. while this PC's own TTS is speaking, so WASP does not hear itself). */
  muted = false;
  onTranscript: TranscriptHandler = () => {};
  onListeningChange: (listening: boolean) => void = () => {};
  onError: (error: string) => void = () => {};

  constructor(private readonly opts: VoiceInputOptions = {}) {}

  get isSupported(): boolean {
    return ctor() !== null;
  }

  get isListening(): boolean {
    return this.wantListening;
  }

  start(): void {
    const C = ctor();
    if (!C || this.wantListening) return;
    const rec = new C();
    rec.lang = this.opts.lang ?? 'es-ES';
    rec.continuous = this.opts.continuous ?? true;
    rec.interimResults = this.opts.interim ?? true;
    rec.onresult = (ev) => {
      if (this.muted) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const alt = r[0];
        if (!alt) continue;
        this.onTranscript(alt.transcript.trim(), r.isFinal, alt.confidence);
      }
    };
    rec.onerror = (ev) => {
      this.onError(ev.error);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') this.stop();
    };
    rec.onend = () => {
      // Chrome stops after silence; keep the mic open while the human wants it.
      if (this.wantListening) {
        try {
          rec.start();
        } catch {
          this.wantListening = false;
          this.onListeningChange(false);
        }
      }
    };
    this.rec = rec;
    this.wantListening = true;
    this.onListeningChange(true);
    rec.start();
  }

  stop(): void {
    this.wantListening = false;
    this.rec?.stop();
    this.rec = null;
    this.onListeningChange(false);
  }

  toggle(): void {
    if (this.wantListening) this.stop();
    else this.start();
  }
}
