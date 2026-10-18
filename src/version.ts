// 版本檢查：偵測瀏覽器開著（或快取到）舊版網頁，並自動更新到伺服器上的最新版。

/** 讀取伺服器上最新的建置代號；開發版或讀不到時回傳 null */
export function fetchLatestBuild(): Promise<string | null> {
  if (!import.meta.env.PROD) return Promise.resolve(null);
  return fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v: { build?: string } | null) => v?.build ?? null)
    .catch(() => null);
}

/** 這個網頁是不是舊版（讀不到伺服器版本時視為不是） */
export function isStale(): Promise<boolean> {
  return fetchLatestBuild().then((b) => !!b && b !== __BUILD_ID__);
}

/**
 * 換到最新版：改用帶版本參數的網址重新載入。
 * GitHub Pages 讓瀏覽器快取網頁 10 分鐘，單純 reload 可能拿到同一份舊版；網址不同就不會用到快取。
 * 每個新版本只自動嘗試一次，避免無限重新整理。回傳 false 表示已試過、這次不再重新載入。
 */
export function reloadToBuild(build: string, params: Record<string, string> = {}): boolean {
  try {
    if (sessionStorage.getItem('reloadedFor') === build) return false;
    sessionStorage.setItem('reloadedFor', build);
  } catch {
    /* 私密模式等情況忽略 */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('v', build);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  window.location.replace(url.toString());
  return true;
}

/** 若是舊版就自動更新；回傳是否已開始重新載入 */
export function updateIfStale(params: Record<string, string> = {}): Promise<boolean> {
  return fetchLatestBuild().then((b) => (b && b !== __BUILD_ID__ ? reloadToBuild(b, params) : false));
}
