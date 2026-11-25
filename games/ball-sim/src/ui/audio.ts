import type { Fx } from '../sim/types';

/**
 * Synthesized sound: no audio files. Bounces are short pitched blips on a
 * pentatonic scale, rings shatter as filtered noise (many in a row build into
 * a rush), titanium clanks use inharmonic partials, and a quiet pad plays
 * underneath. Browsers only allow audio after a click or tap, so everything
 * starts on the first gesture.
 */

const KEY = 'ballsim.audio.v1';
const PENTA = [0, 2, 4, 7, 9];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private amb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices: number[] = [];
  muted = false;
  volume = 0.8;
  private listeners = new Set<() => void>();
  private ambOn = false;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      if (typeof s.muted === 'boolean') this.muted = s.muted;
      if (typeof s.volume === 'number') this.volume = s.volume;
    } catch { /* storage blocked */ }
    const unlock = () => { this.unlock(); };
    window.addEventListener('pointerdown', unlock, { once: true, capture: true });
    window.addEventListener('keydown', unlock, { once: true, capture: true });
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ muted: this.muted, volume: this.volume })); } catch { /* ignore */ }
    for (const f of this.listeners) f();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.sfx.connect(comp);
    this.amb.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
    this.save();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    this.save();
  }

  /** Fade the ambient bed in or out (quieter in the editor). */
  ambience(level: number): void {
    if (!this.ctx || !this.amb) return;
    this.amb.gain.setTargetAtTime(level, this.ctx.currentTime, 0.8);
  }

  private startAmbience(): void {
    const ctx = this.ctx!, out = this.amb!;
    if (this.ambOn) return;
    this.ambOn = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.4;
    lp.connect(out);
    // Slowly moving pad: a soft minor-ninth voicing, gently detuned.
    const notes = [55, 82.41, 110, 130.81, 164.81, 246.94];
    notes.forEach((f, k) => {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = k < 2 ? 'sine' : 'triangle';
        o.frequency.value = f;
        o.detune.value = det + (k * 3);
        const gn = ctx.createGain();
        gn.gain.value = k < 2 ? 0.05 : 0.018;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05 + k * 0.013;
        const lg = ctx.createGain();
        lg.gain.value = gn.gain.value * 0.8;
        lfo.connect(lg);
        lg.connect(gn.gain);
        o.connect(gn);
        gn.connect(lp);
        o.start();
        lfo.start();
      }
    });
    // Airy noise bed, breathing slowly.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.012;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lg = ctx.createGain();
    lg.gain.value = 0.01;
    lfo.connect(lg);
    lg.connect(ng.gain);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    n.start();
    lfo.start();
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.03;
    const sg = ctx.createGain();
    sg.gain.value = 260;
    sweep.connect(sg);
    sg.connect(lp.frequency);
    sweep.start();
    this.ambience(0.55);
  }

  /* ------------------------------- Primitives ------------------------------- */

  private canPlay(): boolean {
    return !!this.ctx && !this.muted && this.ctx.state === 'running';
  }

  /** Limit overlapping voices so dense moments stay musical. */
  private budget(max: number): boolean {
    const now = this.ctx!.currentTime;
    this.voices = this.voices.filter((t) => now - t < 0.06);
    if (this.voices.length >= max) return false;
    this.voices.push(now);
    return true;
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', pan = 0, attack = 0.003, glideTo = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g);
    g.connect(p);
    p.connect(this.sfx!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, gain: number, type: BiquadFilterType, freq: number, q: number, pan = 0, freqTo = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    s.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(this.sfx!);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private note(size: number, speed: number): number {
    // Bigger balls sit lower. Faster hits step up the scale.
    const base = 52 + Math.round(18 - Math.log2(Math.max(2, size)) * 5);
    const step = Math.min(9, Math.floor(speed / 160));
    const deg = PENTA[step % 5] + 12 * Math.floor(step / 5);
    return 440 * Math.pow(2, (base + deg - 69) / 12);
  }

  /* ---------------------------------- Events ---------------------------------- */

  play(fx: Fx[], viewR: number): void {
    if (!this.canPlay() || !fx.length) return;
    let shatters = 0;
    for (const f of fx) {
      const pan = 'x' in f ? Math.max(-0.8, Math.min(0.8, (f as { x: number }).x / Math.max(1, viewR))) : 0;
      switch (f.k) {
        case 'bounce': {
          if (!this.budget(10)) break;
          const v = Math.min(1, f.s / 900);
          this.tone(this.note(f.r, f.s), 0.16 + v * 0.1, 0.04 + v * 0.11, 'triangle', pan);
          break;
        }
        case 'hit': {
          if (!this.budget(10)) break;
          const v = Math.min(1, f.s / 900);
          this.tone(this.note(f.r, f.s) * 1.5, 0.1, 0.03 + v * 0.07, 'sine', pan);
          break;
        }
        case 'shatter':
          if (shatters++ > 3) break;
          this.burst(0.35, 0.22, 'bandpass', 2400 + Math.random() * 2400, 1.2, pan, 900);
          this.burst(0.18, 0.12, 'highpass', 5000, 0.7, pan);
          this.tone(1800 + Math.random() * 900, 0.25, 0.04, 'sine', pan, 0.002, 600);
          break;
        case 'boom':
          this.tone(f.big ? 110 : 160, f.big ? 1.4 : 0.6, f.big ? 0.5 : 0.25, 'sine', pan, 0.005, 36);
          this.burst(f.big ? 1.2 : 0.5, f.big ? 0.45 : 0.2, 'lowpass', 1400, 0.5, pan, 120);
          break;
        case 'clank': {
          // Titanium: bright inharmonic partials with a hard transient.
          const g = 0.16 * f.s;
          for (const [m, k] of [[1, 1], [2.76, 0.55], [5.4, 0.35], [8.93, 0.2]] as const) this.tone(380 * m, 0.55 / Math.sqrt(m), g * k, 'sine', pan, 0.001);
          this.burst(0.06, 0.3 * f.s, 'highpass', 3000, 0.8, pan);
          this.tone(70, 0.3, 0.25 * f.s, 'sine', pan, 0.002, 40);
          break;
        }
        case 'pop':
          if (!this.budget(14)) break;
          this.tone(900 + Math.random() * 300, 0.07, 0.025, 'sine', pan);
          break;
        case 'fall':
          this.tone(520, 1.0, 0.08, 'sine', pan, 0.01, 140);
          this.burst(0.9, 0.06, 'bandpass', 1500, 1, pan, 300);
          break;
        case 'pickup':
          this.tone(f.kind === 'red' ? 523 : f.kind === 'green' ? 659 : f.kind === 'cyan' ? 784 : 587, 0.18, 0.12, 'triangle', pan);
          setTimeout(() => this.canPlay() && this.tone(f.kind === 'red' ? 784 : f.kind === 'green' ? 988 : f.kind === 'cyan' ? 1175 : 880, 0.3, 0.1, 'triangle', pan), 70);
          break;
        case 'damage':
          if (!this.budget(12)) break;
          if (f.blocked && f.amount <= 0) this.tone(1500, 0.12, 0.06, 'square', pan);
          else this.tone(140, 0.2, 0.16, 'sine', pan, 0.002, 70);
          break;
        case 'zap':
          this.burst(0.25, 0.25, 'highpass', 2500, 0.5, pan);
          this.tone(220, 0.2, 0.06, 'sawtooth', pan, 0.002, 1200);
          break;
        case 'clash':
          if (!this.budget(12)) break;
          this.tone(2400 + Math.random() * 600, 0.18, 0.06, 'sine', pan, 0.001);
          this.tone(3700, 0.1, 0.03, 'sine', pan, 0.001);
          break;
        case 'swallow':
          if (!this.budget(14)) break;
          this.tone(90, 0.12, 0.05, 'sine', pan, 0.002, 60);
          break;
        case 'end':
          this.celebrate();
          break;
      }
    }
  }

  celebrate(): void {
    if (!this.canPlay()) return;
    this.tone(98, 1.6, 0.4, 'sine', 0, 0.005, 40);
    this.burst(1.4, 0.35, 'lowpass', 1800, 0.4, 0, 100);
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, k) => {
      setTimeout(() => this.canPlay() && this.tone(f, 1.6 - k * 0.15, 0.08, 'triangle', (k - 2) * 0.3, 0.01), 120 + k * 70);
    });
  }

  /* ----------------------------------- UI ------------------------------------ */

  hover(): void {
    if (!this.canPlay() || !this.budget(4)) return;
    this.tone(2200, 0.03, 0.025, 'sine');
  }

  click(): void {
    if (!this.canPlay()) return;
    this.tone(1200, 0.05, 0.05, 'sine');
    this.tone(1800, 0.06, 0.03, 'sine');
  }

  enter(): void {
    if (!this.canPlay()) return;
    this.burst(0.9, 0.18, 'bandpass', 300, 0.8, 0, 4000);
    this.tone(180, 0.9, 0.12, 'sine', 0, 0.2, 720);
    setTimeout(() => this.canPlay() && this.tone(1046.5, 0.8, 0.07, 'triangle', 0, 0.01), 420);
    setTimeout(() => this.canPlay() && this.tone(1568, 0.9, 0.05, 'triangle', 0.2, 0.01), 500);
  }

  leave(): void {
    if (!this.canPlay()) return;
    this.burst(0.5, 0.1, 'bandpass', 3000, 0.8, 0, 300);
  }
}

export const audio = new AudioEngine();

/** Hover and click sounds for buttons, links and cards anywhere in the page. */
export function installUiSounds(): void {
  let last: Element | null = null;
  document.addEventListener('pointerover', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    const el = (e.target as Element).closest('button, a, .card, .pal-item, select, .toggle');
    if (el && el !== last && !(el as HTMLButtonElement).disabled) audio.hover();
    last = el;
  });
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest('button, .pal-item, .toggle');
    if (el && !(el as HTMLButtonElement).disabled) audio.click();
  }, true);
}
