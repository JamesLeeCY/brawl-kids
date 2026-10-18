// 目前的邏輯畫面寬度（高度固定 450）。手機橫向時戰鬥畫面會加寬以填滿螢幕；選單維持 800 寬置中。
// 以 ES module 的 live binding 匯出：各繪圖函式每次讀到的都是最新值。
import { CONFIG } from '../config';

export let VW: number = CONFIG.view.width;

export function setViewWidth(w: number): void {
  VW = w;
}

/** 戰鬥畫面相對於標準 800 寬的左側偏移（用來把 HUD 等固定版面置中） */
export function viewOffset(): number {
  return (VW - CONFIG.view.width) / 2;
}
