/**
 * Microphone level meter (Web Audio). Pure feedback: shows the human that the mic is capturing
 * audio, independently of whether speech recognition understood anything.
 */
export class MicLevel {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private raf = 0;
  /** 0..1 smoothed loudness, ~30 times per second while running. */
  onLevel: (level: number) => void = () => {};
  onError: (error: string) => void = () => {};

  get isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  }

  get isRunning(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (!this.isSupported || this.ctx) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.onError((err as Error).message);
      return;
    }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    src.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    let smooth = 0;
    const tick = () => {
      if (!this.analyser || !this.data) return;
      this.analyser.getByteTimeDomainData(this.data);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / this.data.length);
      const level = Math.min(1, rms * 4);
      smooth = level > smooth ? level : smooth * 0.85 + level * 0.15;
      this.onLevel(smooth);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.onLevel(0);
  }
}
