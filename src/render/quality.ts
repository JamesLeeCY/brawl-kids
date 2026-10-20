// 畫質：低畫質時降低解析度、關掉光暈模糊、減少粒子，讓舊手機也跑得順。只影響畫面，不影響遊戲結果。
export type QualitySetting = 'auto' | 'high' | 'low';

/** 目前是否用低畫質（ES module live binding，各繪圖模組直接讀） */
export let lowQuality = false;

const listeners: (() => void)[] = [];

export function setLowQuality(v: boolean): void {
  if (lowQuality === v) return;
  lowQuality = v;
  for (const f of listeners) f();
}

/** 畫質改變時通知（例如重新設定畫布解析度） */
export function onQualityChange(f: () => void): void {
  listeners.push(f);
}

/** 依設定決定初始畫質；auto 先用高畫質，跑太慢再由主迴圈自動降級 */
export function applyQualitySetting(q: QualitySetting): void {
  setLowQuality(q === 'low');
}

/** 自動降級：戰鬥中連續數個量測區間 FPS 過低就切到低畫質 */
export class AutoQuality {
  private slow = 0;
  /** 剛自動降級的提示剩餘時間（ms） */
  noticeUntil = 0;

  constructor(private readonly threshold = 48, private readonly windows = 4) {}

  /** 每個 FPS 量測區間（約 500 ms）呼叫一次；回傳是否剛降級 */
  sample(fps: number, setting: QualitySetting, inBattle: boolean, now: number): boolean {
    if (setting !== 'auto' || lowQuality || !inBattle) {
      this.slow = 0;
      return false;
    }
    this.slow = fps < this.threshold ? this.slow + 1 : 0;
    if (this.slow < this.windows) return false;
    this.slow = 0;
    setLowQuality(true);
    this.noticeUntil = now + 3500;
    return true;
  }
}
