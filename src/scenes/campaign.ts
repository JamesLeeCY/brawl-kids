// 闖關路線：關數可選（1～10），每一關的場景可以是原本路線、隨機抽籤或自選（各關的敵人波數與難度曲線不變）
import type { CampaignRoute, MatchSetup } from '../sim/world';
import { campaignLength, campaignStageId } from '../sim/world';
import type { App } from './scene';

export const ROUTES: { id: CampaignRoute; label: string; desc: string }[] = [
  { id: 'fixed', label: '原本路線', desc: '依難度排好的預設場景' },
  { id: 'random', label: '隨機場景', desc: '出發時從所有場地抽籤，盡量不重複' },
  { id: 'custom', label: '自選場景', desc: '每一關的場景自己選' },
];

/** 從所有場地隨機抽出 length 關的場景：先用完一輪不重複的，再洗牌補上（相鄰兩關不同） */
export function randomCampaignRoute(app: App, length: number): string[] {
  const out: string[] = [];
  while (out.length < length) {
    const pool = [...app.data.stageOrder];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (out.length && pool[0] === out[out.length - 1]) pool.push(pool.shift()!);
    out.push(...pool);
  }
  return out.slice(0, length);
}

/** 從第 1 關重新開始；隨機路線會重新抽籤 */
export function resetCampaign(app: App, s: MatchSetup): void {
  s.campaignIndex = 0;
  if (s.campaignRoute === 'random') s.campaignStages = randomCampaignRoute(app, campaignLength(app.data, s));
  s.stageId = campaignStageId(app.data, s, 0);
  s.carry = undefined;
}
