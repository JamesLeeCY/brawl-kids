// PWA service worker：在 Node 裡用假的 caches / fetch 執行 scripts/sw-template.js，檢查各種請求的快取策略
import template from '../scripts/sw-template.js?raw';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'https://example.github.io';
const BASE = `${ORIGIN}/brawl-kids/`;

type Handler = (ev: any) => void;

function setup(build = 'b1', online = true) {
  const store = new Map<string, Map<string, string>>(); // cacheName → url → body
  const listeners = new Map<string, Handler>();
  const fetchLog: string[] = [];
  const resolveUrl = (r: any) => new URL(typeof r === 'string' ? r : r.url, BASE).href;
  const res = (body: string) => ({ ok: true, body, clone: () => res(body) });
  const cacheApi = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => m.set(resolveUrl(u), `shell:${u}`)),
      put: async (req: any, r: any) => void m.set(resolveUrl(req), r.body),
      keys: async () => [...m.keys()].map((url) => ({ url })),
    };
  };
  const caches = {
    open: async (name: string) => cacheApi(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: any) => {
      for (const m of store.values()) {
        const hit = m.get(resolveUrl(req));
        if (hit !== undefined) return res(hit);
      }
      return undefined;
    },
  };
  const self: any = {
    location: new URL(`${BASE}sw.js`),
    addEventListener: (t: string, h: Handler) => listeners.set(t, h),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  const fetchFn = async (req: any) => {
    const url = resolveUrl(req);
    fetchLog.push(url);
    if (!online) throw new Error('offline');
    return res(`net:${url}`);
  };
  const src = template.replace(/__BUILD_ID__/g, build);
  new Function('self', 'caches', 'fetch', 'URL', src)(self, caches, fetchFn, URL);
  const fire = async (type: string, extra: object = {}) => {
    let p: Promise<any> | undefined;
    let responded: Promise<any> | undefined;
    listeners.get(type)?.({ ...extra, waitUntil: (x: Promise<any>) => (p = x), respondWith: (x: Promise<any>) => (responded = x) });
    if (p) await p;
    return responded ? await responded : undefined;
  };
  const get = (path: string, mode = 'no-cors') => fire('fetch', { request: { method: 'GET', url: new URL(path, BASE).href, mode } });
  return { store, fetchLog, fire, get, setOnline: (v: boolean) => (online = v) };
}

describe('PWA service worker', () => {
  it('安裝時快取網頁外殼，啟用時清掉舊版本的快取', async () => {
    const sw = setup('new');
    sw.store.set('brawl-old', new Map([['x', 'y']]));
    await sw.fire('install');
    await sw.fire('activate');
    expect([...sw.store.keys()]).toEqual(['brawl-new']);
    expect([...sw.store.get('brawl-new')!.keys()]).toContain(`${BASE}index.html`);
  });

  it('網頁與 version.json 一律先上網（才能發現新版本）', async () => {
    const sw = setup();
    await sw.fire('install');
    const page = await sw.get('./?room=ABC123', 'navigate');
    expect(page.body).toBe(`net:${BASE}?room=ABC123`);
    const v = await sw.get('./version.json?t=1');
    expect(v.body).toContain('net:');
    expect(sw.fetchLog).toHaveLength(2);
  });

  it('離線時網頁改用快取', async () => {
    const sw = setup();
    await sw.fire('install');
    sw.setOnline(false);
    const page = await sw.get('./?v=abc', 'navigate');
    expect(page.body).toBe('shell:./index.html');
  });

  it('其他檔案先用快取：第二次不再上網', async () => {
    const sw = setup();
    await sw.fire('install');
    const a = await sw.get('./assets/index-123.js');
    await new Promise((r) => setTimeout(r, 0));
    const b = await sw.get('./assets/index-123.js');
    expect(a.body).toBe(b.body);
    expect(sw.fetchLog.filter((u) => u.includes('index-123'))).toHaveLength(1);
  });

  it('外部網域（配對、中繼伺服器）不經過 service worker', async () => {
    const sw = setup();
    const r = await sw.fire('fetch', { request: { method: 'GET', url: 'https://0.peerjs.com/peerjs/id', mode: 'cors' } });
    expect(r).toBeUndefined();
    expect(sw.fetchLog).toHaveLength(0);
  });
});
