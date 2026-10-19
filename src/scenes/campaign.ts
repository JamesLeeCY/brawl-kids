// 闖關路線：每一關的場景可以是原本路線、隨機抽籤或自選（各關的敵人波數與難度不變）
import type { CampaignRoute, MatchSetup } from '../sim/world';
import { campaignStageId } from '../sim/world';
import type { App } from './scene';

export const ROUTES: { id: CampaignRoute; label: string; desc: string }[] = [
  { id: 'fixed', label: '原本路線', desc: '台灣大學 → 西門町 → 大巨蛋 → 信義區' },
  { id: 'random', label: '隨機場景', desc: '出發時從所有場地抽出不重複的關卡' },
  { id: 'custom', label: '自選場景', desc: '↑↓ 選關卡、←→ 換場景' },
];

/** 從所有場地隨機抽出每一關的場景（盡量不重複） */
export function randomCampaignRoute(app: App): string[] {
  const pool = [...app.data.stageOrder];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return app.data.campaign.map((_, i) => pool[i % pool.length]);
}

/** 從第 1 關重新開始；隨機路線會重新抽籤 */
export function resetCampaign(app: App, s: MatchSetup): void {
  s.campaignIndex = 0;
  if (s.campaignRoute === 'random') s.campaignStages = randomCampaignRoute(app);
  s.stageId = campaignStageId(app.data, s, 0);
  s.carry = undefined;
}
