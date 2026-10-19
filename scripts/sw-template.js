// Service worker（建置時由 vite.config.ts 填入版本代號後輸出成 dist/sw.js）。
// - 網頁本身與 version.json：先上網拿最新的，離線時才用快取 → 不影響「發現新版自動更新」
// - 其他同網域檔案（含檔名雜湊的 JS / 圖示）：先用快取，第二次開啟更快
// - 外部連線（配對伺服器、中繼伺服器的 WebSocket 等）一律不經過這裡
const CACHE = 'brawl-__BUILD_ID__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('brawl-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js');
  if (fresh) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && req.mode === 'navigate') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
