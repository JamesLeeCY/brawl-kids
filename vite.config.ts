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

export default defineConfig({
  base: './',
  server: { port: 5173 },
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile()],
  test: { environment: 'node' },
} as any);
