// 背景音樂：Web Audio 即時合成，不使用音檔。只在本機播放，不讀寫模擬狀態以外的任何遊戲資料，也不影響決定性模擬。
// 排程方式：每 25ms 的計時器把接下來 0.12 秒內的音符預先排進 AudioContext（不在每幀建立節點）。
import type { Sfx } from './sfx';
import { SCALES, TRACKS, chordDegrees, degreeToMidi, parseNotes, type ParsedNote, type TrackDef, type TrackId } from './tracks';

const LOOKAHEAD = 0.12;
const INTERVAL_MS = 25;
const FADE = 0.15;

interface Playing {
  id: TrackId;
  def: TrackDef;
  bus: GainNode;
  hat: BiquadFilterNode;
  snare: BiquadFilterNode;
  steps: number;
  bars: number;
  stepDur: number;
  /** 依起始格分組的主旋律音符 */
  lead: Map<number, ParsedNote>;
  step: number;
  nextTime: number;
  done: boolean;
}

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private cur: Playing | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hidden = false;
  volume = 0.6;

  constructor(private sfx: Sfx) {}

  setVolume(v: number): void {
    this.volume = v;
    this.applyVolume();
  }

  /** 每幀呼叫：同一首時不做任何事。AudioContext 由使用者第一次操作時（Sfx.unlock）才建立 */
  play(id: TrackId | null): void {
    if (!this.ctx && !this.attach()) return;
    if ((this.cur?.id ?? null) !== id) this.switchTo(id);
  }

  /** 分頁隱藏時停止排程並靜音，回到前景時從下一拍接續 */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.applyVolume();
    if (hidden) this.stopTimer();
    else if (this.cur && this.ctx) {
      this.cur.nextTime = this.ctx.currentTime + 0.05;
      this.startTimer();
    }
  }

  private attach(): boolean {
    const g = this.sfx.graph();
    if (!g) return false;
    this.ctx = g.ctx;
    this.out = g.ctx.createGain();
    this.out.connect(g.master);
    const len = g.ctx.sampleRate >> 1;
    this.noise = g.ctx.createBuffer(1, len, g.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolume();
    return true;
  }

  private applyVolume(): void {
    if (!this.out || !this.ctx) return;
    const v = this.hidden ? 0 : this.volume * 0.7;
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private switchTo(id: TrackId | null): void {
    const ctx = this.ctx!;
    const old = this.cur;
    if (old) {
      old.bus.gain.setTargetAtTime(0, ctx.currentTime, FADE);
      setTimeout(() => old.bus.disconnect(), 1500);
    }
    this.cur = null;
    this.stopTimer();
    if (!id) return;
    const def: TrackDef = TRACKS[id];
    const steps = def.steps ?? 16;
    const bus = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = def.tone ?? 4200;
    bus.connect(lp).connect(this.out!);
    const hat = ctx.createBiquadFilter();
    hat.type = 'highpass';
    hat.frequency.value = 7000;
    hat.connect(bus);
    const snare = ctx.createBiquadFilter();
    snare.type = 'bandpass';
    snare.frequency.value = 1800;
    snare.Q.value = 0.8;
    snare.connect(bus);
    const lead = new Map<number, ParsedNote>();
    if (def.lead) for (const n of parseNotes(def.lead.notes).notes) lead.set(n.step, n);
    this.cur = {
      id,
      def,
      bus,
      hat,
      snare,
      steps,
      bars: def.prog.length,
      stepDur: 60 / def.bpm / 4,
      lead,
      step: 0,
      nextTime: ctx.currentTime + 0.1,
      done: false,
    };
    if (!this.hidden) this.startTimer();
  }

  private startTimer(): void {
    if (this.timer !== null || !this.cur || this.cur.done) return;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const p = this.cur;
    const ctx = this.ctx;
    if (!p || !ctx) return;
    const until = ctx.currentTime + LOOKAHEAD;
    // 計時器被節流後落後太多時直接跳到現在，避免一次排一大堆音
    if (p.nextTime < ctx.currentTime - 0.2) p.nextTime = ctx.currentTime + 0.02;
    while (p.nextTime < until) {
      const total = p.steps * p.bars;
      if (p.def.loop === false && p.step >= total) {
        p.done = true;
        this.stopTimer();
        return;
      }
      const s = p.step % total;
      const swing = s % 2 === 1 ? (p.def.swing ?? 0) * p.stepDur : 0;
      this.playStep(p, s, p.nextTime + swing);
      p.step++;
      p.nextTime += p.stepDur;
    }
  }

  private playStep(p: Playing, s: number, t: number): void {
    const def = p.def;
    const scale = SCALES[def.scale];
    const bar = Math.floor(s / p.steps);
    const i = s % p.steps;
    const root = def.prog[bar];
    const midi = (deg: number, oct = 0) => degreeToMidi(def.key, scale, deg) + oct * 12;

    const n = p.lead.get(s);
    if (n && def.lead) this.voice(p, t, midi(n.deg, def.lead.oct ?? 0), n.len * p.stepDur, def.lead.wave, def.lead.vol);
    if (root < 0) return;

    const chord = chordDegrees(root, def.sevenths);
    if (def.pad && i === 0) {
      const g = this.ctx!.createGain();
      const dur = p.steps * p.stepDur;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(def.pad.vol, t + 0.25);
      g.gain.setValueAtTime(def.pad.vol, t + dur - 0.15);
      g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
      g.connect(p.bus);
      for (const d of chord) {
        const o = this.ctx!.createOscillator();
        o.type = def.pad.wave;
        o.frequency.value = freq(midi(d, def.pad.oct ?? 0));
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.12);
      }
    }
    if (def.bass) {
      const c = def.bass.pat[i];
      if (c && c !== '.') {
        const d = c === '5' ? root + 4 : root;
        let len = 1;
        while (i + len < p.steps && def.bass.pat[i + len] === '.' && len < 4) len++;
        this.voice(p, t, midi(d, (def.bass.oct ?? -2) + (c === 'o' ? 1 : 0)), len * p.stepDur * 0.9, def.bass.wave, def.bass.vol);
      }
    }
    if (def.arp) {
      const c = def.arp.pat[i];
      if (c && c !== '.') {
        const k = Number(c);
        const d = k < chord.length ? chord[k] : root + 7;
        this.voice(p, t, midi(d, def.arp.oct ?? 0), p.stepDur * 0.9, def.arp.wave, def.arp.vol);
      }
    }
    const dr = def.drums;
    if (dr) {
      const v = dr.vol ?? 1;
      if (dr.k?.[i] === 'x') this.kick(p, t, 0.55 * v);
      if (dr.s?.[i] === 'x') this.hit(p.snare, t, 0.12, 0.5 * v);
      if (dr.h?.[i] === 'x') this.hit(p.hat, t, 0.04, 0.22 * v);
    }
  }

  private voice(p: Playing, t: number, m: number, dur: number, wave: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.value = freq(m);
    const a = Math.min(0.012, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(vol * 0.45, t + Math.max(dur, a + 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    o.connect(g).connect(p.bus);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  private kick(p: Playing, t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g).connect(p.bus);
    o.start(t);
    o.stop(t + 0.17);
  }

  private hit(dest: AudioNode, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(g).connect(dest);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.01);
  }
}

function freq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
