// 遊戲速度（快 / 中 / 慢）：只改變每秒實際跑幾個邏輯 tick，不影響模擬結果（決定論不變）。
// 本機比賽用自己的設定；連線比賽用房主的設定（隨開賽訊息送給所有人），大家速度一致。
import { CONFIG } from './config';

export type SpeedSetting = 'fast' | 'normal' | 'slow';

export const SPEEDS: { id: SpeedSetting; label: string; value: number }[] = [
  { id: 'fast', label: '快（原速）', value: 1 },
  { id: 'normal', label: '中（推薦）', value: CONFIG.gameSpeed },
  { id: 'slow', label: '慢（招式更好打中）', value: 0.7 },
];

export function speedValue(s: SpeedSetting | undefined): number {
  return SPEEDS.find((x) => x.id === s)?.value ?? CONFIG.gameSpeed;
}

let current: number = CONFIG.gameSpeed;

/** 設定目前的速度倍率（0.5～1.2） */
export function setGameSpeed(v: number): void {
  current = Math.max(0.5, Math.min(1.2, v));
}

export function gameSpeed(): number {
  return current;
}

/** 目前一個邏輯 tick 的實際毫秒數 */
export function tickMs(): number {
  return 1000 / (CONFIG.tickRate * current);
}
