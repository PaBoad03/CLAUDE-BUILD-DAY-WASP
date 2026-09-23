/**
 * Browser speech-to-text (Web Speech API SpeechRecognition; Chrome/Edge).
 *
 * The voice layer only produces TEXT. The host emits it as `stt_transcript`
 * (docs/CONTRACT.md §4); GREEN decides whether the words authorize anything.
 * Nothing here can grant a permission.
 *
 * `onStatus` reports the recognizer lifecycle (audio detected, speech detected, result, error…) so the
 * UI can show WHY nothing is being transcribed — e.g. Windows "online speech recognition" disabled.
 */

export type TranscriptHandler = (text: string, final: boolean, confidence?: number) => void;

export interface VoiceInputOptions {
  lang?: string;
  /** Keep listening after a final result. Default true. */
  continuous?: boolean;
  /** Emit interim (non-final) transcripts too. Default true. */
  interim?: boolean;
}

export type SttStatus =
  | 'off'
  | 'starting'
  | 'listening' // recognizer started, waiting for audio
  | 'audio' // audio is being captured
  | 'speech' // speech detected, recognizing
  | 'result' // a transcript arrived
  | 'nomatch' // heard speech but could not recognize words
  | 'muted' // results dropped while this PC speaks
  | `error:${string}`;

/* Minimal typings: lib.dom does not declare the prefixed constructor. */
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onnomatch: (() => void) | null;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
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

/** Human explanation for the recognizer error codes (Chrome/Edge). */
export function explainSttError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'permiso de micrófono denegado o reconocimiento de voz deshabilitado. En Windows: Configuración → Privacidad → Voz → activa "Reconocimiento de voz en línea". En el navegador: permite el micrófono para este sitio.';
    case 'network':
      return 'el reconocimiento de voz del navegador necesita Internet (usa el servicio de Google/Microsoft) y no pudo conectarse.';
    case 'audio-capture':
      return 'no se encontró micrófono o está en uso por otra aplicación.';
    case 'no-speech':
      return 'no se detectó voz; habla más cerca del micrófono.';
    case 'aborted':
      return 'reconocimiento interrumpido.';
    case 'language-not-supported':
      return 'idioma no soportado por el reconocedor.';
    default:
      return code;
  }
}

export class VoiceInput {
  private rec: RecognitionLike | null = null;
  private wantListening = false;
  /** While true, results are dropped (e.g. while this PC's own TTS is speaking, so WASP does not hear itself). */
  muted = false;
  status: SttStatus = 'off';
  onTranscript: TranscriptHandler = () => {};
  onListeningChange: (listening: boolean) => void = () => {};
  onError: (error: string) => void = () => {};
  onStatus: (status: SttStatus) => void = () => {};

  constructor(private readonly opts: VoiceInputOptions = {}) {}

  get isSupported(): boolean {
    return ctor() !== null;
  }

  get isListening(): boolean {
    return this.wantListening;
  }

  private setStatus(s: SttStatus): void {
    this.status = s;
    this.onStatus(s);
  }

  start(): void {
    const C = ctor();
    if (!C || this.wantListening) return;
    const rec = new C();
    rec.lang = this.opts.lang ?? 'es-ES';
    rec.continuous = this.opts.continuous ?? true;
    rec.interimResults = this.opts.interim ?? true;
    rec.onstart = () => this.setStatus('listening');
    rec.onaudiostart = () => this.setStatus('audio');
    rec.onspeechstart = () => this.setStatus('speech');
    rec.onnomatch = () => this.setStatus('nomatch');
    rec.onresult = (ev) => {
      if (this.muted) {
        this.setStatus('muted');
        return;
      }
      this.setStatus('result');
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const alt = r[0];
        if (!alt) continue;
        this.onTranscript(alt.transcript.trim(), r.isFinal, alt.confidence);
      }
    };
    rec.onerror = (ev) => {
      this.setStatus(`error:${ev.error}`);
      // 'no-speech' and 'aborted' are routine in continuous mode; only real problems reach onError
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') this.onError(`${ev.error}: ${explainSttError(ev.error)}`);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') this.stop();
    };
    rec.onend = () => {
      // Chrome stops after silence; keep the mic open while the human wants it.
      if (this.wantListening) {
        try {
          rec.start();
          this.setStatus('starting');
        } catch {
          this.wantListening = false;
          this.setStatus('off');
          this.onListeningChange(false);
        }
      } else {
        this.setStatus('off');
      }
    };
    this.rec = rec;
    this.wantListening = true;
    this.onListeningChange(true);
    this.setStatus('starting');
    try {
      rec.start();
    } catch (err) {
      this.setStatus(`error:${(err as Error).message}`);
      this.onError((err as Error).message);
    }
  }

  stop(): void {
    this.wantListening = false;
    this.rec?.stop();
    this.rec = null;
    this.setStatus('off');
    this.onListeningChange(false);
  }

  toggle(): void {
    if (this.wantListening) this.stop();
    else this.start();
  }
}
