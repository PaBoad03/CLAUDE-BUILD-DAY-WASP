/**
 * Browser text-to-speech (Web Speech API), dependency-free so every PC can run it without keys.
 * Browsers require a user gesture before audio; call `enable()` from a click.
 *
 * `lang: 'auto'` picks the voice from the text itself (Spanish vs English) so a Spanish line is never
 * read with an American accent; `fallbackLang` is used when the text gives no clue.
 * `onUtterance` lets the host report `tts_started` / `tts_finished` to the bus (docs/CONTRACT.md §4).
 */
export interface SpeakOptions {
  /** BCP-47 tag, or 'auto' to detect from the text. */
  lang?: string;
  /** Used with 'auto' when the text is ambiguous. Default es-ES. */
  fallbackLang?: string;
  rate?: number;
  pitch?: number;
  /** Substring to prefer when picking a voice, e.g. "Google", "Microsoft". */
  voiceHint?: string;
}

const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'para', 'con', 'por', 'no', 'sí', 'si', 'es', 'está', 'esta', 'pero', 'como', 'al', 'lo', 'se', 'su', 'te', 'me', 'ya', 'fue', 'puede', 'sin', 'sobre', 'hay', 'este', 'esa']);
const EN_WORDS = new Set(['the', 'and', 'is', 'are', 'to', 'of', 'you', 'i', 'it', 'in', 'on', 'for', 'with', 'this', 'that', 'not', 'was', 'be', 'can', 'have', 'has', 'we', 'your', 'from', 'but', 'an', 'at', 'by']);

/** Cheap language guess: accents/punctuation first, then common-word counts. */
export function detectLang(text: string): 'es-ES' | 'en-US' | null {
  if (/[áéíóúñ¿¡]/i.test(text)) return 'es-ES';
  const words = text.toLowerCase().replace(/[^a-záéíóúñü\s]/gi, ' ').split(/\s+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  if (es === 0 && en === 0) return null;
  return es >= en ? 'es-ES' : 'en-US';
}

export class VoiceOutput {
  private enabled = false;
  private queue: string[] = [];
  private speaking = false;
  onSpeakingChange: (speaking: boolean) => void = () => {};
  onUtterance: (phase: 'start' | 'end', text: string, ok: boolean) => void = () => {};

  constructor(private readonly opts: SpeakOptions = {}) {}

  get isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    if (!this.isSupported) return;
    this.enabled = true;
    // Warm up: some browsers return an empty voice list until first use.
    window.speechSynthesis.getVoices();
    this.flush();
  }

  disable(): void {
    this.enabled = false;
    this.queue = [];
    if (this.isSupported) window.speechSynthesis.cancel();
    this.setSpeaking(false);
  }

  speak(text: string): void {
    if (!text.trim()) return;
    this.queue.push(text);
    this.flush();
  }

  /** Drop what has not been spoken yet (e.g. the human said STOP). */
  interrupt(): void {
    this.queue = [];
    if (this.isSupported) window.speechSynthesis.cancel();
    this.setSpeaking(false);
  }

  private langFor(text: string): string {
    const want = this.opts.lang ?? 'auto';
    if (want !== 'auto') return want;
    return detectLang(text) ?? this.opts.fallbackLang ?? 'es-ES';
  }

  private flush(): void {
    if (!this.enabled || !this.isSupported || this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    const u = new SpeechSynthesisUtterance(next);
    u.lang = this.langFor(next);
    u.rate = this.opts.rate ?? 1.02;
    u.pitch = this.opts.pitch ?? 1.0;
    const voice = this.pickVoice(u.lang);
    if (voice) u.voice = voice;
    u.onstart = () => {
      this.setSpeaking(true);
      this.onUtterance('start', next, true);
    };
    u.onend = () => {
      this.onUtterance('end', next, true);
      this.setSpeaking(false);
      this.flush();
    };
    u.onerror = () => {
      this.onUtterance('end', next, false);
      this.setSpeaking(false);
      this.flush();
    };
    window.speechSynthesis.speak(u);
  }

  private pickVoice(lang: string): SpeechSynthesisVoice | null {
    const voices = window.speechSynthesis.getVoices();
    const base = lang.slice(0, 2).toLowerCase();
    const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
    // exact region first (es-ES over es-MX), then the hint, then any voice of that language
    const exact = sameLang.filter((v) => v.lang.toLowerCase().replace('_', '-') === lang.toLowerCase());
    const pool = exact.length ? exact : sameLang;
    if (this.opts.voiceHint) {
      const hinted = pool.find((v) => v.name.includes(this.opts.voiceHint!));
      if (hinted) return hinted;
    }
    const natural = pool.find((v) => /natural|neural|online/i.test(v.name));
    return natural ?? pool[0] ?? voices[0] ?? null;
  }

  private setSpeaking(v: boolean) {
    if (this.speaking !== v) {
      this.speaking = v;
      this.onSpeakingChange(v);
    }
  }
}
