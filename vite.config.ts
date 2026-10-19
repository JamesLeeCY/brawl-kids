import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/** 每次建置的版本代號：連線時雙方比對，網頁開啟時也用來偵測快取到的舊版 */
const BUILD_ID = Date.now().toString(36);

/** 輸出 dist/version.json，讓已開啟的舊網頁能發現有新版本 */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

/** 輸出 dist/sw.js（PWA 離線快取）：快取名稱帶版本代號，新版上線時自動換掉舊快取 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle() {
      const src = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8').replace(/__BUILD_ID__/g, BUILD_ID);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  server: { port: 5173 },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile(), serviceWorker()],
  test: { environment: 'node' },
} as any);
