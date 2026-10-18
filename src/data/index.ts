// 以 Vite 的 import.meta.glob 自動載入 data/ 下的 JSON；新增角色只要放檔案進 characters/。
import { loadGameData, type GameData, type RawFile } from './load';
import baseFrames from './base_frames.json';
import items from './items.json';
import stages from './stages.json';

const charModules = import.meta.glob('./characters/*.json', { eager: true, import: 'default' });

let cached: GameData | null = null;

export function getGameData(): GameData {
  if (cached) return cached;
  const characters: RawFile[] = Object.entries(charModules).map(([path, json]) => ({ path: `data/${path.slice(2)}`, json }));
  cached = loadGameData({
    characters,
    baseFrames: { path: 'data/base_frames.json', json: baseFrames },
    items: { path: 'data/items.json', json: items },
    stages: { path: 'data/stages.json', json: stages },
  });
  for (const e of cached.errors) console.error(`[資料驗證] ${e}`);
  return cached;
}

/** 資料指紋：連線時比對，確保雙方跑同一份角色 / 場地資料 */
export function dataVersion(): string {
  const d = getGameData();
  const s = JSON.stringify([d.characters, d.items, d.stages, d.campaign, d.campaignDifficulty]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
