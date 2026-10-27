// Web Audio 即時合成音效，不使用音檔。第一次按鍵時才建立 AudioContext。
import type { SoundKey } from '../data/schema';
import type { SoundStyle } from '../render/signature';

/** 招牌音效的時機：一般命中、重擊、放招 */
export type SignatureMode = 'hit' | 'heavy' | 'cast';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlay: Partial<Record<string, number>> = {};
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

  /**
   * 角色招牌音效：命中時疊在一般打擊聲上（音量較小），放招時是 2～3 個音的短旋律。
   * 同一種音效 40ms 內不重複。
   */
  signature(style: SoundStyle, mode: SignatureMode): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noise) return;
    const now = ctx.currentTime;
    const key = `${style}:${mode}`;
    if ((this.lastPlay[key] ?? -1) > now - 0.04) return;
    this.lastPlay[key] = now;
    const v = mode === 'heavy' ? 0.9 : mode === 'cast' ? 0.7 : 0.55;
    const cast = mode === 'cast';
    const t = now;
    const nb = (dt: number, dur: number, type: BiquadFilterType, f: number, vol: number) => this.noiseBurst(t + dt, dur, type, f, vol * v);
    const tn = (dt: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number) => this.tone(t + dt, type, f0, f1, dur, vol * v);
    switch (style) {
      case 'paper':
        // 紙張：脆脆的啪一聲（放招：翻兩頁）
        nb(0, 0.05, 'highpass', 3500, 0.45);
        tn(0, 'square', 1300, 900, 0.03, 0.06);
        if (cast) nb(0.08, 0.05, 'highpass', 3000, 0.4);
        break;
      case 'slap':
        // 拖鞋：啪！
        nb(0, 0.07, 'bandpass', 1300, 0.9);
        if (cast) nb(0.12, 0.07, 'bandpass', 1100, 0.8);
        break;
      case 'laugh':
        // 哈哈
        for (let i = 0; i < (cast ? 3 : 2); i++) tn(i * 0.11, 'sawtooth', 430 - i * 20, 300, 0.08, 0.1);
        break;
      case 'croak':
        // 呱
        tn(0, 'square', 190, 110, 0.12, 0.13);
        if (cast) tn(0.17, 'square', 210, 120, 0.12, 0.13);
        break;
      case 'metal':
        // 啞鈴：金屬噹
        tn(0, 'triangle', 1760, 1700, 0.28, 0.16);
        tn(0, 'triangle', 2470, 2400, 0.2, 0.08);
        if (cast) tn(0.14, 'triangle', 1320, 1300, 0.3, 0.14);
        break;
      case 'zap':
        // 電擊：滋滋（放招：往上衝的電流）
        if (cast) tn(0, 'sawtooth', 200, 1400, 0.22, 0.08);
        else tn(0, 'sawtooth', 95, 60, 0.12, 0.12);
        nb(0, cast ? 0.2 : 0.1, 'highpass', 4200, 0.35);
        break;
      case 'chime':
        // 叮
        if (cast) [880, 1320, 1760].forEach((f, i) => tn(i * 0.07, 'sine', f, f, 0.3, 0.12));
        else {
          tn(0, 'sine', 1320, 1320, 0.3, 0.12);
          tn(0, 'sine', 1980, 1980, 0.2, 0.05);
        }
        break;
      case 'growl':
        // 熊吼
        nb(0, cast ? 0.35 : 0.18, 'lowpass', 420, 0.8);
        tn(0, 'sawtooth', 85, 60, cast ? 0.35 : 0.18, 0.1);
        break;
      case 'tweet':
        // 鳥叫：啾啾
        for (let i = 0; i < (cast ? 3 : 2); i++) tn(i * 0.08, 'sine', 2000, 3300, 0.06, 0.1);
        break;
      case 'steam':
        // 蒸氣：嘶
        nb(0, cast ? 0.4 : 0.22, 'highpass', 2600, 0.35);
        break;
      case 'boing':
        // 布丁：啵嚶
        if (cast) tn(0, 'sine', 180, 620, 0.22, 0.16);
        else tn(0, 'sine', 520, 170, 0.2, 0.16);
        break;
      case 'sparkle':
        // 閃亮
        [1760, 2350, 2790].slice(0, cast ? 3 : 2).forEach((f, i) => tn(i * 0.05, 'sine', f, f, 0.18, 0.08));
        break;
      case 'boom':
        // 煙火：咻～碰
        if (cast) tn(0, 'sine', 600, 1900, 0.3, 0.06);
        tn(cast ? 0.3 : 0, 'sine', 130, 45, 0.28, 0.35);
        nb(cast ? 0.3 : 0, 0.16, 'lowpass', 900, 0.6);
        break;
      case 'meow':
        // 喵
        tn(0, 'triangle', 620, 920, 0.09, 0.12);
        tn(0.09, 'triangle', 920, 520, cast ? 0.2 : 0.12, 0.12);
        break;
      case 'coin':
        // 金幣：叮叮
        tn(0, 'square', 988, 988, 0.07, 0.07);
        tn(0.07, 'square', 1319, 1319, cast ? 0.25 : 0.14, 0.07);
        break;
      case 'box':
        // 紙箱：碰（放招：撕膠帶）
        if (cast) nb(0, 0.22, 'bandpass', 2200, 0.5);
        nb(cast ? 0.2 : 0, 0.1, 'lowpass', 700, 0.8);
        tn(cast ? 0.2 : 0, 'sine', 170, 90, 0.12, 0.25);
        break;
      case 'cash':
        // 收銀機：咔～叮
        nb(0, 0.03, 'highpass', 3000, 0.5);
        tn(0.04, 'sine', 2093, 2093, cast ? 0.4 : 0.22, 0.12);
        if (cast) tn(0.04, 'sine', 2637, 2637, 0.3, 0.06);
        break;
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
