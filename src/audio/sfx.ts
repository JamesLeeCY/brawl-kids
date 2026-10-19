// Web Audio 即時合成音效，不使用音檔。第一次按鍵時才建立 AudioContext。
import type { SoundKey } from '../data/schema';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlay: Partial<Record<SoundKey, number>> = {};
  masterVolume = 0.8;
  sfxVolume = 0.8;

  /** 須在使用者互動事件中呼叫 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolume();
    } catch {
      this.ctx = null;
    }
  }

  /** 背景音樂共用同一個 AudioContext 與主音量；尚未解鎖時為 null */
  graph(): { ctx: AudioContext; master: GainNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, master: this.master } : null;
  }

  setVolumes(master: number, sfx: number): void {
    this.masterVolume = master;
    this.sfxVolume = sfx;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.master) this.master.gain.value = this.masterVolume;
    if (this.sfx) this.sfx.gain.value = this.sfxVolume * 0.6;
  }

  play(key: SoundKey): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const now = ctx.currentTime;
    // 同一音效 30ms 內不重複，避免多人混戰時爆音
    if ((this.lastPlay[key] ?? -1) > now - 0.03) return;
    this.lastPlay[key] = now;
    switch (key) {
      case 'hit_light':
        this.noiseBurst(now, 0.06, 'highpass', 1800, 0.7);
        break;
      case 'hit_heavy': {
        this.noiseBurst(now, 0.12, 'lowpass', 2400, 0.8);
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(80, now);
        o.frequency.exponentialRampToValueAtTime(40, now + 0.18);
        g.gain.setValueAtTime(0.9, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        o.connect(g).connect(this.sfx);
        o.start(now);
        o.stop(now + 0.21);
        break;
      }
      case 'whoosh': {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 2;
        f.frequency.setValueAtTime(400, now);
        f.frequency.exponentialRampToValueAtTime(2500, now + 0.15);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.linearRampToValueAtTime(0.35, now + 0.05);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        src.connect(f).connect(g).connect(this.sfx);
        src.start(now);
        src.stop(now + 0.16);
        break;
      }
      case 'jump':
        this.tone(now, 'square', 300, 600, 0.08, 0.18);
        break;
      case 'special': {
        for (const [i, fr] of [220, 277, 330].entries()) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          o.type = 'sawtooth';
          o.frequency.value = fr;
          lfo.frequency.value = 7;
          lg.gain.value = 6;
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0.0001, now);
          g.gain.linearRampToValueAtTime(0.12, now + 0.03 + i * 0.01);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
          o.connect(g).connect(this.sfx);
          o.start(now);
          lfo.start(now);
          o.stop(now + 0.41);
          lfo.stop(now + 0.41);
        }
        break;
      }
      case 'ko': {
        const notes = [880, 660, 523, 392, 262];
        notes.forEach((fr, i) => this.tone(now + i * 0.12, 'square', fr, fr, 0.11, 0.2));
        break;
      }
    }
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.sfx!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.01);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx!);
    o.start(t);
    o.stop(t + dur + 0.01);
  }
}
