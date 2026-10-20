// 成就與角色戰績：只存在這台裝置的 localStorage（讀寫皆包 try/catch，私密模式下照常玩、只是不會保留）。
import type { Difficulty } from './config';

const KEY = 'brawl-kids.progress.v1';

export interface CharStat {
  played: number;
  wins: number;
}

export interface Progress {
  chars: Record<string, CharStat>;
  /** 成就 id → 解鎖時間（ms） */
  unlocked: Record<string, number>;
  /** 玩過的場地 */
  stages: string[];
  /** 各難度全破過的最多關數 */
  campaign: Partial<Record<Difficulty, number>>;
  bestCombo: number;
  onlineWins: number;
}

function empty(): Progress {
  return { chars: {}, unlocked: {}, stages: [], campaign: {}, bestCombo: 0, onlineWins: 0 };
}

let cache: Progress | null = null;

export function loadProgress(): Progress {
  if (cache) return cache;
  let p = empty();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) p = { ...p, ...JSON.parse(raw) };
  } catch {
    /* 讀不到就從頭開始 */
  }
  cache = p;
  return p;
}

function save(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 私密模式等情況忽略 */
  }
}

/** 測試用：清掉記憶體快取（下次讀取重新從 localStorage 載入） */
export function resetProgressCache(): void {
  cache = null;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** 進度（目前 / 目標），沒有就不顯示進度條 */
  progress?: (p: Progress, total: TotalInfo) => [number, number];
  check: (p: Progress, total: TotalInfo) => boolean;
}

export interface TotalInfo {
  characters: number;
  stages: number;
  maxCampaign: number;
}

const winsTotal = (p: Progress) => Object.values(p.chars).reduce((s, c) => s + c.wins, 0);
const charsWon = (p: Progress) => Object.values(p.chars).filter((c) => c.wins > 0).length;
const maxCleared = (p: Progress) => Math.max(0, ...Object.values(p.campaign).map((n) => n ?? 0));

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_win', name: '初登場勝利', desc: '贏得第一場比賽', check: (p) => winsTotal(p) >= 1 },
  { id: 'five_chars', name: '多才多藝', desc: '用 5 名不同角色各贏一場', progress: (p) => [charsWon(p), 5], check: (p) => charsWon(p) >= 5 },
  { id: 'all_chars', name: '全員制霸', desc: '用全部角色各贏一場', progress: (p, t) => [charsWon(p), t.characters], check: (p, t) => charsWon(p) >= t.characters },
  { id: 'wins_50', name: '身經百戰', desc: '累積 50 勝', progress: (p) => [winsTotal(p), 50], check: (p) => winsTotal(p) >= 50 },
  { id: 'stages_all', name: '台北走透透', desc: '在每一個場地都打過一場', progress: (p, t) => [p.stages.length, t.stages], check: (p, t) => p.stages.length >= t.stages },
  { id: 'campaign_clear', name: '闖關成功', desc: '任一難度、任一關數闖關全破', check: (p) => maxCleared(p) >= 1 },
  { id: 'campaign_10', name: '十關鐵人', desc: '闖關 10 關全破', progress: (p, t) => [maxCleared(p), t.maxCampaign], check: (p, t) => maxCleared(p) >= t.maxCampaign },
  { id: 'campaign_hard', name: '困難也不怕', desc: '困難難度闖關全破', check: (p) => (p.campaign.hard ?? 0) >= 1 },
  { id: 'online_win', name: '連線勝利', desc: '在連線對戰中贏一場', check: (p) => p.onlineWins >= 1 },
  { id: 'combo_200', name: '連段新手', desc: '練習模式單次連段 200 傷害', progress: (p) => [Math.min(200, Math.round(p.bestCombo)), 200], check: (p) => p.bestCombo >= 200 },
  { id: 'combo_300', name: '連段大師', desc: '練習模式單次連段 300 傷害', progress: (p) => [Math.min(300, Math.round(p.bestCombo)), 300], check: (p) => p.bestCombo >= 300 },
  { id: 'all_moves', name: '招式全開', desc: '在練習模式用同一角色放出全部 6 招', check: (p) => !!p.unlocked.all_moves },
  { id: 'tutorial', name: '好學生', desc: '完成新手教學', check: (p) => !!p.unlocked.tutorial },
];

/** 依目前資料檢查成就；回傳這次新解鎖的成就（forced：直接解鎖的成就，例如完成教學） */
function evaluate(p: Progress, total: TotalInfo, forced: string[] = []): AchievementDef[] {
  const before = new Set(Object.keys(p.unlocked));
  const now = Date.now();
  const out: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (before.has(a.id)) continue;
    if (forced.includes(a.id) || a.check(p, total)) {
      p.unlocked[a.id] = now;
      out.push(a);
    }
  }
  return out;
}

export interface MatchRecord {
  stageId: string;
  /** 這台裝置上的真人玩家：用的角色、是否贏了 */
  players: { charId: string; won: boolean }[];
  online: boolean;
  /** 闖關全破時的難度與關數 */
  campaignClear?: { difficulty: Difficulty; length: number };
}

/** 一場比賽結束時記錄戰績；回傳新解鎖的成就 */
export function recordMatch(m: MatchRecord, total: TotalInfo): AchievementDef[] {
  const p = loadProgress();
  for (const pl of m.players) {
    const s = (p.chars[pl.charId] ??= { played: 0, wins: 0 });
    s.played++;
    if (pl.won) s.wins++;
  }
  if (!p.stages.includes(m.stageId)) p.stages.push(m.stageId);
  if (m.online && m.players.some((pl) => pl.won)) p.onlineWins++;
  if (m.campaignClear) {
    const d = m.campaignClear.difficulty;
    p.campaign[d] = Math.max(p.campaign[d] ?? 0, m.campaignClear.length);
  }
  const news = evaluate(p, total);
  save(p);
  return news;
}

/** 練習模式：更新最高連段傷害、放出全部招式 */
export function recordPractice(o: { combo?: number; allMoves?: boolean }, total: TotalInfo): AchievementDef[] {
  const p = loadProgress();
  if (o.combo !== undefined && o.combo > p.bestCombo) p.bestCombo = o.combo;
  const news = evaluate(p, total, o.allMoves ? ['all_moves'] : []);
  save(p);
  return news;
}

/** 完成新手教學 */
export function recordTutorial(total: TotalInfo): AchievementDef[] {
  const p = loadProgress();
  const news = evaluate(p, total, ['tutorial']);
  save(p);
  return news;
}
