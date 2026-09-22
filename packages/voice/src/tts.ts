/**
 * Browser text-to-speech (Web Speech API), dependency-free so every PC can run it without keys.
 * Browsers require a user gesture before audio; call `enable()` from a click.
 *
 * `onUtterance` lets the host report `tts_started` / `tts_finished` to the bus (docs/CONTRACT.md §4).
 */
export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  /** Substring to prefer when picking a voice, e.g. "Google", "Microsoft". */
  voiceHint?: string;
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

  private flush(): void {
    if (!this.enabled || !this.isSupported || this.speaking) return;
    const next = this.queue.shift();
    if (!next) return;
    const u = new SpeechSynthesisUtterance(next);
    u.lang = this.opts.lang ?? 'en-US';
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
    const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (this.opts.voiceHint) {
      const hinted = sameLang.find((v) => v.name.includes(this.opts.voiceHint!));
      if (hinted) return hinted;
    }
    return sameLang[0] ?? voices[0] ?? null;
  }

  private setSpeaking(v: boolean) {
    if (this.speaking !== v) {
      this.speaking = v;
      this.onSpeakingChange(v);
    }
  }
}
