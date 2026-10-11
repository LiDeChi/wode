export class TheatreAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private loop: ReturnType<typeof setInterval> | null = null;
  enabled = false;
  private beat = 0;
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.context ||= new AudioContext();
      if (!this.master) { this.master = this.context.createGain(); this.master.connect(this.context.destination); }
      this.master.gain.value = 0.14;
      await this.context.resume();
      this.start();
    } else this.pause(true);
    return this.enabled;
  }
  private note(frequency: number, duration: number, volume: number, type: OscillatorType = 'sine') {
    if (!this.context || !this.master || !this.enabled || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, this.context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain); gain.connect(this.master);
    oscillator.start(); oscillator.stop(this.context.currentTime + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  private start() {
    if (this.loop) return;
    const pentatonic = [146.83, 164.81, 196, 220, 246.94, 293.66, 246.94, 196];
    this.loop = setInterval(() => { this.note(pentatonic[this.beat++ % pentatonic.length], 2.8, 0.13); this.note(73.42, 3.5, 0.04); }, 1700);
  }
  cue(kind: 'choice' | 'seal' | 'alarm' | 'page' = 'choice') {
    this.note(kind === 'alarm' ? 110 : kind === 'seal' ? 440 : kind === 'page' ? 196 : 293.66, 0.35, 0.3, kind === 'alarm' ? 'triangle' : 'sine');
  }
  pause(paused: boolean) {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (paused) { if (this.master) this.master.gain.value = 0; }
    else if (this.enabled) { if (this.master) this.master.gain.value = 0.14; this.start(); }
  }
  dispose() { this.pause(true); void this.context?.close(); }
}
