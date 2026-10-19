// 背景音樂譜面：全部以音階級數記譜（0 = 主音，7 = 高八度，負數 = 低音域），播放時才換算頻率。
// 主旋律以空白分隔、每小節 steps 格（16 分音符）：數字 = 音、'.' = 休止、'_' = 延長上一個音。
// 低音 / 琶音 / 鼓為每小節重複的字元圖樣。prog 為每小節和弦根音級數（-1 = 該小節只留主旋律）。

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;

export interface Inst {
  wave: OscillatorType;
  vol: number;
  /** 相對調性主音的八度位移 */
  oct?: number;
}

export interface TrackDef {
  bpm: number;
  /** 每小節格數（16 分音符），3/4 拍為 12 */
  steps?: number;
  /** 0～0.5：偶數拍後的 16 分音符往後延遲的比例 */
  swing?: number;
  /** false：播一次就停（勝利 / 失敗短曲） */
  loop?: boolean;
  /** 主音 MIDI 編號 */
  key: number;
  scale: keyof typeof SCALES;
  /** 整首曲子的低通濾波截止頻率（越低越柔和） */
  tone?: number;
  prog: number[];
  /** 和弦加七音 */
  sevenths?: boolean;
  lead?: Inst & { notes: string };
  /** x = 根音、5 = 五度、o = 高八度、. = 休止 */
  bass?: Inst & { pat: string };
  pad?: Inst;
  /** 0～3 = 和弦第幾個音（3 = 根音高八度）、. = 休止 */
  arp?: Inst & { pat: string };
  /** k = 大鼓、s = 小鼓、h = 腳踏鈸；x = 打擊、. = 無 */
  drums?: { k?: string; s?: string; h?: string; vol?: number };
}

export const TRACKS = {
  // 標題 / 選單：明亮有精神，I–V–vi–IV
  title: {
    bpm: 140, key: 60, scale: 'major', prog: [0, 4, 5, 3],
    lead: { wave: 'square', vol: 0.11, notes:
      '4 _ 4 5 7 _ 5 4 2 _ 4 _ 0 _ . . ' +
      '1 _ 1 2 4 _ 2 1 -1 _ 1 _ 4 _ . . ' +
      '2 _ 2 4 5 _ 4 2 0 _ 2 _ 5 _ 4 _ ' +
      '3 _ 4 5 7 _ _ 5 4 _ _ _ . . 4 5' },
    bass: { wave: 'triangle', vol: 0.3, oct: -2, pat: 'x..x..x.x..x..5.' },
    pad: { wave: 'triangle', vol: 0.05 },
    drums: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
  },
  // 台灣大學椰林大道：清爽的校園早晨
  ntu: {
    bpm: 116, key: 62, scale: 'major', prog: [3, 4, 2, 5],
    lead: { wave: 'triangle', vol: 0.16, notes:
      '4 _ _ 2 4 _ 5 _ 4 _ 2 _ 0 _ _ . ' +
      '1 _ _ 2 4 _ 6 _ 5 _ 4 _ 1 _ _ . ' +
      '2 _ _ 4 6 _ 7 _ 6 _ 4 _ 2 _ _ . ' +
      '5 _ 4 _ 2 _ 4 _ 5 _ _ _ . . . .' },
    bass: { wave: 'triangle', vol: 0.3, oct: -2, pat: 'x...x.5.x...x.5.' },
    pad: { wave: 'sine', vol: 0.06 },
    arp: { wave: 'sine', vol: 0.05, oct: 1, pat: '0.1.2.1.0.1.2.1.' },
    drums: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', vol: 0.8 },
  },
  // 西門町：輕快流行舞曲，四拍大鼓
  ximending: {
    bpm: 128, key: 60, scale: 'major', prog: [5, 3, 0, 4],
    lead: { wave: 'square', vol: 0.1, notes:
      '5 . 5 . 4 5 . 7 _ . 5 . 4 . 2 . ' +
      '3 . 3 . 2 3 . 5 _ . 4 . 2 . 0 . ' +
      '4 . 4 . 2 4 . 7 _ . 9 . 7 . 4 . ' +
      '6 _ 5 _ 4 _ 1 _ 2 _ _ _ . . . .' },
    bass: { wave: 'sawtooth', vol: 0.16, oct: -2, pat: 'x.o.x.o.x.o.x.o.' },
    pad: { wave: 'sawtooth', vol: 0.025 },
    arp: { wave: 'square', vol: 0.035, oct: 1, pat: '0123012301230123' },
    drums: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.xxx.xxx.xxx.xx' },
  },
  // 大巨蛋：球場加油應援，混合利地安
  dome: {
    bpm: 132, key: 62, scale: 'mixolydian', prog: [0, 6, 3, 0],
    lead: { wave: 'square', vol: 0.11, notes:
      '0 . 2 . 4 . . . 4 . . . 4 . . . ' +
      '6 . 5 . 4 . . . 2 . . . 0 . . . ' +
      '3 . 4 . 5 . . . 7 . . . 5 . 4 . ' +
      '4 _ _ _ 4 _ _ _ 0 . 0 . 0 . . .' },
    bass: { wave: 'square', vol: 0.12, oct: -2, pat: 'x..5x..5x..5x.5.' },
    pad: { wave: 'square', vol: 0.025 },
    drums: { k: 'x.x...x.x.x...x.', s: '....x.......x.x.', h: 'x.x.x.x.x.x.x.x.' },
  },
  // 信義區 101：城市夜景，多利安小調琶音
  xinyi: {
    bpm: 118, key: 57, scale: 'dorian', prog: [0, 3, 0, 6], tone: 2600,
    lead: { wave: 'sine', vol: 0.16, oct: 1, notes:
      '7 _ _ _ _ _ 6 _ 4 _ _ _ . . . . ' +
      '5 _ _ _ 6 _ 7 _ 8 _ _ _ . . . . ' +
      '9 _ _ _ 8 _ 7 _ 4 _ _ _ . . . . ' +
      '6 _ _ _ _ _ 4 _ 3 _ _ _ . . 4 6' },
    bass: { wave: 'sawtooth', vol: 0.18, oct: -2, pat: 'x.....x...x.....' },
    pad: { wave: 'sawtooth', vol: 0.03 },
    arp: { wave: 'sawtooth', vol: 0.05, oct: 0, pat: '0120312001203120' },
    drums: { k: 'x.....x...x.....', s: '....x.......x...', h: '..x...x...x...x.' },
  },
  // 木柵動物園：蹦蹦跳跳的頑皮曲
  zoo: {
    bpm: 150, key: 65, scale: 'major', prog: [0, 3, 4, 0],
    lead: { wave: 'square', vol: 0.09, notes:
      '0 . 2 . 4 . 2 . 7 . . 4 . . . . ' +
      '3 . 5 . 7 . 5 . 8 . . 7 . . . . ' +
      '4 . 6 . 8 . 6 . 9 . 8 . 7 . 6 . ' +
      '7 . 4 . 2 . 4 . 0 . . . -3 . 0 .' },
    bass: { wave: 'triangle', vol: 0.32, oct: -2, pat: 'x...5...x...5...' },
    arp: { wave: 'triangle', vol: 0.06, oct: 1, pat: '..2...2...2...2.' },
    drums: { k: 'x.......x.......', s: '....x.......x...', h: '......x.......x.', vol: 0.8 },
  },
  // 貓空纜車泡茶：慢板五聲音階，悠閒
  maokong: {
    bpm: 80, key: 62, scale: 'major', prog: [0, 5, 3, 0], tone: 2200,
    lead: { wave: 'triangle', vol: 0.17, oct: 1, notes:
      '4 _ _ _ 5 _ 4 2 1 _ _ _ 2 _ _ . ' +
      '0 _ _ _ 2 _ 1 0 -2 _ _ _ . . . . ' +
      '1 _ 2 _ 4 _ _ _ 5 _ 4 _ 2 _ _ . ' +
      '1 _ _ _ 2 _ 1 _ 0 _ _ _ _ _ _ .' },
    bass: { wave: 'sine', vol: 0.3, oct: -2, pat: 'x.......5.......' },
    pad: { wave: 'sine', vol: 0.06 },
    arp: { wave: 'triangle', vol: 0.06, oct: 1, pat: '0...1...2...1...' },
    drums: { h: 'x.......x.......', vol: 0.6 },
  },
  // 圓山花博：3/4 拍圓舞曲
  expo: {
    bpm: 100, key: 60, scale: 'major', steps: 12, prog: [0, 3, 4, 0],
    lead: { wave: 'triangle', vol: 0.16, oct: 1, notes:
      '4 _ _ _ 2 _ _ _ 4 _ 5 _ ' +
      '5 _ _ _ 3 _ _ _ 5 _ 7 _ ' +
      '6 _ _ _ 4 _ 5 _ 6 _ 4 _ ' +
      '2 _ _ _ _ _ 0 _ _ _ . .' },
    bass: { wave: 'triangle', vol: 0.3, oct: -2, pat: 'x...5...5...' },
    pad: { wave: 'sine', vol: 0.05 },
    drums: { k: 'x...........', h: '....x...x...', vol: 0.7 },
  },
  // 中山赤峰街：文青咖啡廳的慵懶爵士，搖擺節奏
  chifeng: {
    bpm: 84, key: 62, scale: 'dorian', prog: [0, 3, 1, 4], swing: 0.2, sevenths: true, tone: 2400,
    lead: { wave: 'sine', vol: 0.17, oct: 1, notes:
      '4 . 6 . 7 _ _ 6 4 _ . . 2 . 3 . ' +
      '5 _ _ . 6 . 5 . 3 _ _ . . . . . ' +
      '1 . 3 . 4 _ 5 . 6 _ 5 . 4 . 3 . ' +
      '4 _ _ _ _ _ . . 2 . 1 . 0 . . .' },
    bass: { wave: 'sine', vol: 0.34, oct: -2, pat: 'x.....5.x...x...' },
    pad: { wave: 'triangle', vol: 0.04 },
    drums: { k: 'x.........x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', vol: 0.7 },
  },
  // 總統府前：英雄進行曲，銅管主旋律與軍鼓
  government: {
    bpm: 112, key: 58, scale: 'major', prog: [0, 5, 3, 4],
    lead: { wave: 'sawtooth', vol: 0.08, oct: 1, notes:
      '0 _ _ 0 4 _ _ _ 4 _ 5 _ 7 _ _ _ ' +
      '5 _ _ 4 2 _ _ _ 0 _ 2 _ 5 _ _ _ ' +
      '3 _ _ 5 7 _ _ _ 8 _ 7 _ 5 _ _ _ ' +
      '4 _ _ 4 6 _ 8 _ 11 _ _ _ . . . .' },
    bass: { wave: 'triangle', vol: 0.32, oct: -2, pat: 'x...5...x...5...' },
    pad: { wave: 'sawtooth', vol: 0.03 },
    drums: { k: 'x...x...x...x...', s: 'x.xxx...x.xxx...' },
  },
  // 闖關頭目波：和聲小調，快速緊張
  boss: {
    bpm: 156, key: 57, scale: 'harmonicMinor', prog: [0, 5, 3, 4],
    lead: { wave: 'sawtooth', vol: 0.08, oct: 1, notes:
      '7 . 7 . 6 . 7 . 4 . . . 2 . 3 . ' +
      '5 . 5 . 4 . 5 . 2 . . . 0 . 2 . ' +
      '3 . 3 . 2 . 3 . 5 . 7 . 8 . 7 . ' +
      '6 _ _ _ 4 _ _ _ 6 _ 7 _ 8 _ _ _' },
    bass: { wave: 'sawtooth', vol: 0.17, oct: -2, pat: 'x.x.x.x.x.x.x.o.' },
    pad: { wave: 'sawtooth', vol: 0.025 },
    drums: { k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx', vol: 0.9 },
  },
  // 勝利：短號角，只播一次
  victory: {
    bpm: 132, key: 60, scale: 'major', prog: [3, 4, 0, -1], loop: false,
    lead: { wave: 'square', vol: 0.12, oct: 1, notes:
      '4 . 4 . 4 . 4 _ 2 _ 3 _ 4 _ 3 4 ' +
      '6 _ _ _ 5 _ _ _ 4 _ 6 _ 8 _ _ _ ' +
      '7 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ ' +
      '. . . . . . . . . . . . . . . .' },
    bass: { wave: 'triangle', vol: 0.3, oct: -2, pat: 'x...x...x...x...' },
    pad: { wave: 'triangle', vol: 0.06 },
    drums: { k: 'x...x...x...x...', s: '....x.......x.xx' },
  },
  // 失敗：慢速下行小調，只播一次
  defeat: {
    bpm: 72, key: 57, scale: 'minor', prog: [5, 3, 4, 0], loop: false, tone: 2000,
    lead: { wave: 'triangle', vol: 0.16, oct: 1, notes:
      '4 _ _ _ 3 _ _ _ 2 _ _ _ 0 _ _ _ ' +
      '1 _ _ _ 0 _ _ _ -1 _ _ _ -3 _ _ _ ' +
      '-1 _ _ _ 0 _ _ _ -2 _ _ _ _ _ _ _ ' +
      '0 _ _ _ _ _ _ _ _ _ _ _ _ _ _ _' },
    bass: { wave: 'sine', vol: 0.3, oct: -2, pat: 'x...............' },
    pad: { wave: 'sine', vol: 0.06 },
  },
} satisfies Record<string, TrackDef>;

export type TrackId = keyof typeof TRACKS;

/** 場景之外的情境：選單、戰鬥（哪個場地、是否頭目波）、結算 */
export type MusicCue =
  | { kind: 'menu' }
  | { kind: 'battle'; stageId: string; boss: boolean }
  | { kind: 'result'; won: boolean };

export function trackFor(cue: MusicCue): TrackId {
  if (cue.kind === 'menu') return 'title';
  if (cue.kind === 'result') return cue.won ? 'victory' : 'defeat';
  if (cue.boss) return 'boss';
  return cue.stageId in TRACKS && !NON_STAGE.has(cue.stageId) ? (cue.stageId as TrackId) : 'ntu';
}

const NON_STAGE = new Set<string>(['title', 'boss', 'victory', 'defeat']);

export interface ParsedNote {
  step: number;
  /** 音階級數 */
  deg: number;
  /** 長度（格數） */
  len: number;
}

/** 主旋律字串 → 音符列表（每首只在開始播放時解析一次） */
export function parseNotes(s: string): { notes: ParsedNote[]; length: number } {
  const toks = s.trim().split(/\s+/);
  const notes: ParsedNote[] = [];
  toks.forEach((t, i) => {
    if (t === '_') {
      if (notes.length && notes[notes.length - 1].step + notes[notes.length - 1].len === i) notes[notes.length - 1].len++;
      return;
    }
    if (t === '.') return;
    const deg = Number(t);
    if (!Number.isInteger(deg)) throw new Error(`bad note token "${t}"`);
    notes.push({ step: i, deg, len: 1 });
  });
  return { notes, length: toks.length };
}

/** 音階級數 → MIDI 編號 */
export function degreeToMidi(key: number, scale: readonly number[], deg: number): number {
  const n = scale.length;
  const oct = Math.floor(deg / n);
  return key + oct * 12 + scale[deg - oct * n];
}

/** 和弦內音（級數），由調內三度堆疊 */
export function chordDegrees(root: number, sevenths = false): number[] {
  return sevenths ? [root, root + 2, root + 4, root + 6] : [root, root + 2, root + 4];
}
