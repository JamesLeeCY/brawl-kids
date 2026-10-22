// 贊助連結：標題畫面右上角的「請作者喝杯咖啡」，連到綠界直播主收款網址。
// 網址留空時不顯示按鈕。只是外部連結：遊戲不經手任何付款資料，贊助也不會解鎖任何東西。

/** 綠界「收款工具 → 實況主收款」產生的收款網址 */
export const DONATE_URL = '';

/** 只接受 https 網址，避免填錯變成 javascript: 之類的連結 */
export function donateUrl(url: string = DONATE_URL): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** 在新分頁開啟贊助頁（必須在點擊事件裡呼叫，瀏覽器才不會擋） */
export function openDonate(): void {
  const url = donateUrl();
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}
