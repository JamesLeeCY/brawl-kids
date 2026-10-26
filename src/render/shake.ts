// 畫面晃動強度（設定）：關 / 弱 / 標準。系統設定「減少動態效果」時一律不晃。只影響畫面。
export type ShakeSetting = 'off' | 'low' | 'normal';

export const SHAKE_LEVELS: { id: ShakeSetting; label: string; factor: number }[] = [
  { id: 'normal', label: '標準', factor: 1 },
  { id: 'low', label: '弱', factor: 0.45 },
  { id: 'off', label: '關（不晃、不放大）', factor: 0 },
];

/** 系統設定了「減少動態效果」 */
export const REDUCED_MOTION = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let factor = 1;

export function setShakeSetting(s: ShakeSetting): void {
  factor = SHAKE_LEVELS.find((x) => x.id === s)?.factor ?? 1;
}

/** 目前的晃動倍率（0 = 不晃） */
export function shakeFactor(): number {
  return REDUCED_MOTION ? 0 : factor;
}
