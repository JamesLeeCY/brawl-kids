// 分享重播：編成 #replay=... 網址；網址太長（聊天軟體可能截斷）就改複製代碼文字。
import { encodeReplay, HASH_PREFIX, type Replay } from './replay';

/** 超過這個長度就不放進網址 */
export const MAX_URL_LENGTH = 8192;

export function replayUrl(code: string): string {
  return `${location.origin}${location.pathname}${HASH_PREFIX}${code}`;
}

/** 分享或複製重播；回傳要顯示給玩家的結果訊息 */
export async function shareReplay(r: Replay): Promise<string> {
  const code = await encodeReplay(r);
  const url = replayUrl(code);
  if (url.length <= MAX_URL_LENGTH) {
    if (navigator.share && navigator.maxTouchPoints > 0) {
      try {
        await navigator.share({ title: '台灣大亂鬥 重播', text: '來看我這場！', url });
        return '已開啟分享';
      } catch {
        // 取消分享或不支援：改用複製
      }
    }
    return copy(url, '已複製重播連結，貼給朋友就能看');
  }
  return copy(code, '網址太長，已改為複製重播代碼：在標題畫面按 Ctrl+V 貼上即可觀看');
}

async function copy(s: string, ok: string): Promise<string> {
  try {
    await navigator.clipboard.writeText(s);
    return ok;
  } catch {
    return '無法存取剪貼簿，請改用電腦瀏覽器分享';
  }
}

/** 離開從連結開啟的重播後清掉網址的 #replay=，重新整理才不會又跳進重播 */
export function clearReplayHash(): void {
  if (location.hash.startsWith(HASH_PREFIX)) history.replaceState(null, '', location.pathname + location.search);
}
