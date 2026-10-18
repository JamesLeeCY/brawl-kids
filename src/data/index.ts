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

/** 連線協定版本：改動網路訊息格式時遞增 */
export const PROTOCOL_VERSION = 3;

/** 連線時比對的版本：協定 + 建置代號 + 資料指紋，任一不同就拒絕連線並提示重新整理 */
export function dataVersion(): string {
  return `p${PROTOCOL_VERSION}-${__BUILD_ID__}-${dataHash()}`;
}

/** 資料指紋：確保雙方跑同一份角色 / 場地資料 */
export function dataHash(): string {
  const d = getGameData();
  const s = JSON.stringify([d.characters, d.items, d.stages, d.campaign, d.campaignDifficulty]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
