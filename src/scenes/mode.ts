import { CONFIG, type Difficulty } from '../config';
import { text } from '../render/text';
import { drawStageCard } from '../render/thumbs';
import type { CampaignRoute, GameMode, MatchSetup, PlayerSetup } from '../sim/world';
import { DEFAULT_CAMPAIGN_LENGTH, campaignStageId, defaultCampaignRoute } from '../sim/world';
import { BattleScene } from './battle';
import { ROUTES, randomCampaignRoute } from './campaign';
import { Scene, type App, type MenuInput } from './scene';
import { button, hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

export function buildSetup(
  app: App,
  mode: GameMode,
  stageId: string,
  campaignIndex = 0,
  campaignDifficulty: Difficulty = 'normal',
  campaignStages?: string[],
  campaignRoute?: CampaignRoute,
  campaignLength?: number,
): MatchSetup {
  const ids = app.data.selectable;
  const players: PlayerSetup[] = [];
  app.slots.forEach((s, slot) => {
    if (s.kind === 'empty') return;
    players.push({
      slot,
      charId: ids[s.charIdx % ids.length],
      team: s.team,
      controller: s.kind === 'ai' ? 'ai' : 'human',
      difficulty: s.difficulty,
    });
  });
  const setup: MatchSetup = {
    mode,
    stageId,
    seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
    players,
    campaignIndex,
    campaignDifficulty,
    campaignLength: mode === 'campaign' ? campaignLength : undefined,
    campaignStages: mode === 'campaign' ? campaignStages : undefined,
    campaignRoute: mode === 'campaign' ? campaignRoute : undefined,
  };
  if (mode === 'campaign') setup.stageId = campaignStageId(app.data, setup, campaignIndex);
  return setup;
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

type MenuMode = 'versus' | 'campaign' | 'practice';
const MODES: { id: MenuMode; label: string }[] = [
  { id: 'versus', label: '對戰模式' },
  { id: 'campaign', label: '闖關模式' },
  { id: 'practice', label: '練習模式' },
];
/** 練習沙包的行為 */
const DUMMIES: { label: string; ai: Difficulty | null }[] = [
  { label: '站著不動', ai: null },
  { label: '電腦（簡單）', ai: 'easy' },
  { label: '電腦（普通）', ai: 'normal' },
  { label: '電腦（困難）', ai: 'hard' },
];
const DIFF_DESC = ['敵人較弱、血量 80%，適合新手', '標準難度', '敵人更聰明、每波多一隻、血量 130%'];

/** 闖關設定列：0 模式、1 難度、2 關數、3 場景路線、4… 自選各關、最後 出發 */
const ROW_DIFF = 1;
const ROW_LEN = 2;
const ROW_ROUTE = 3;
const ROW_STAGES = 4;

export class ModeScene extends Scene {
  private t = 0;
  private row = 0;
  private mode: MenuMode = 'versus';
  private stageIdx = 0;
  private dummyIdx = 0;
  /** 沙包角色：0 = 守衛機器人，之後依序為可選角色 */
  private dummyChar = 0;
  private diffIdx = 1;
  private routeIdx = 0;
  private length = DEFAULT_CAMPAIGN_LENGTH;
  /** 自選路線：每一關的場景（長度 = 關數） */
  private custom: string[];
  private warn = 0;

  constructor(app: App) {
    super(app);
    this.custom = defaultCampaignRoute(app.data, this.length);
  }

  private get route(): CampaignRoute {
    return ROUTES[this.routeIdx].id;
  }

  private get maxLength(): number {
    return this.app.data.campaign.length;
  }

  private rowCount(): number {
    if (this.mode === 'versus') return 3;
    if (this.mode === 'practice') return 5;
    return ROW_STAGES + 1 + (this.route === 'custom' ? this.length : 0);
  }

  private setLength(n: number): void {
    this.length = Math.max(1, Math.min(this.maxLength, n));
    this.custom = defaultCampaignRoute(this.app.data, this.length);
  }

  update(inp: MenuInput): void {
    this.t++;
    if (this.warn > 0) this.warn--;
    const a = inp.any;
    const rows = this.rowCount();
    if (a.up) this.row = (this.row + rows - 1) % rows;
    if (a.down) this.row = (this.row + 1) % rows;
    const stages = this.app.data.stageOrder;
    const step = a.left ? -1 : a.right ? 1 : 0;
    if (this.row === 0 && step) {
      const i = MODES.findIndex((m) => m.id === this.mode);
      this.mode = MODES[(i + MODES.length + step) % MODES.length].id;
      this.row = 0;
    }
    if (step && this.mode !== 'campaign' && this.row === 1) this.stageIdx = (this.stageIdx + stages.length + step) % stages.length;
    if (step && this.mode === 'practice') {
      const nChar = this.app.data.selectable.length + 1;
      if (this.row === 2) this.dummyIdx = (this.dummyIdx + DUMMIES.length + step) % DUMMIES.length;
      if (this.row === 3) this.dummyChar = (this.dummyChar + nChar + step) % nChar;
    }
    if (step && this.mode === 'campaign') {
      if (this.row === ROW_DIFF) this.diffIdx = (this.diffIdx + 3 + step) % 3;
      else if (this.row === ROW_LEN) this.setLength(this.length + step);
      else if (this.row === ROW_ROUTE) this.routeIdx = (this.routeIdx + ROUTES.length + step) % ROUTES.length;
      else if (this.route === 'custom' && this.row >= ROW_STAGES && this.row < ROW_STAGES + this.length) {
        const i = this.row - ROW_STAGES;
        this.custom[i] = stages[(stages.indexOf(this.custom[i]) + stages.length + step) % stages.length];
      }
    }
    if (a.A || a.J) {
      const startRow = this.rowCount() - 1;
      if (this.row === startRow || a.J) this.start();
      else this.row = Math.min(this.row + 1, startRow);
    }
  }

  private get dummyCharId(): string {
    return this.dummyChar === 0 ? 'guardbot' : this.app.data.selectable[this.dummyChar - 1];
  }

  /** 練習模式：本機真人玩家（同一隊）＋一個沙包 */
  private practiceSetup(): MatchSetup | null {
    const ids = this.app.data.selectable;
    const players: PlayerSetup[] = [];
    this.app.slots.forEach((s, slot) => {
      if (s.kind === 'human') players.push({ slot, charId: ids[s.charIdx % ids.length], team: 1, controller: 'human', difficulty: s.difficulty });
    });
    if (!players.length) return null;
    const free = [0, 1, 2, 3].find((i) => this.app.slots[i]?.kind !== 'human')!;
    const d = DUMMIES[this.dummyIdx];
    // 站著不動的沙包：設成真人但這個欄位沒有人按鍵，所以不會動
    players.push({ slot: free, charId: this.dummyCharId, team: 2, controller: d.ai ? 'ai' : 'human', difficulty: d.ai ?? 'normal' });
    return { mode: 'versus', stageId: this.app.data.stageOrder[this.stageIdx], seed: (Date.now() ^ (performance.now() * 1000)) >>> 0, players, practice: true };
  }

  private start(): void {
    if (this.mode === 'practice') {
      const ps = this.practiceSetup();
      if (!ps) {
        this.warn = 150;
        return;
      }
      this.app.scenes.push(new BattleScene(this.app, ps));
      return;
    }
    const route = this.route;
    const stagesForRun = route === 'random' ? randomCampaignRoute(this.app, this.length) : route === 'custom' ? [...this.custom] : undefined;
    const setup = buildSetup(this.app, this.mode, this.app.data.stageOrder[this.stageIdx], 0, DIFFS[this.diffIdx], stagesForRun, route, this.length);
    if (this.mode === 'versus') {
      const teams = new Set(setup.players.map((p) => (p.team > 0 ? p.team : 100 + p.slot)));
      if (teams.size < 2) {
        this.warn = 150;
        return;
      }
    }
    this.app.scenes.push(new BattleScene(this.app, setup));
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#2b1331', '#5c2a4d');
    text(ctx, '選擇模式與場地', VW / 2, 42, 24, '#ffd23f', 'center', true, true);
    button(ctx, `◀ ${MODES.find((m) => m.id === this.mode)!.label} ▶`, VW / 2, 56, 300, this.row === 0);
    if (this.mode === 'versus') this.renderVersus(ctx);
    else if (this.mode === 'campaign') this.renderCampaign(ctx);
    else this.renderPractice(ctx);
    if (this.warn > 0)
      text(ctx, this.mode === 'practice' ? '練習模式需要至少一位真人玩家，請回選角加入。' : '對戰至少需要兩隊！請回選角設定隊伍或加入電腦。', VW / 2, 412, 15, '#ff7b7b', 'center');
    const hints: Record<MenuMode, string> = {
      versus: '場上只剩一隊存活即獲勝　·　↑↓ 選擇　←→ 切換　攻擊 確定　跳躍 直接開始　Esc 返回選角',
      campaign: '所有玩家同隊合作、電腦成為隊友　·　↑↓ 選擇　←→ 切換　攻擊 確定　Esc 返回',
      practice: '無限 MP、不會倒下，沙包被打完會自動回血；畫面上有招式表，放出來會打勾　·　Esc 返回',
    };
    hint(ctx, hints[this.mode]);
  }

  private renderPractice(ctx: CanvasRenderingContext2D): void {
    const ids = this.app.data.stageOrder;
    const st = this.app.data.stages[ids[this.stageIdx]];
    button(ctx, `◀ ${st.name} ▶`, VW / 2, 102, 360, this.row === 1);
    drawStageCard(ctx, this.app.data, ids[this.stageIdx], VW / 2, 150, 240, { selected: this.row === 1 });
    const name = this.dummyChar === 0 ? '守衛機器人' : this.app.data.characters[this.dummyCharId].name;
    button(ctx, `◀ 沙包：${DUMMIES[this.dummyIdx].label} ▶`, VW / 2 - 160, 300, 300, this.row === 2);
    button(ctx, `◀ 沙包角色：${name} ▶`, VW / 2 + 160, 300, 300, this.row === 3);
    text(ctx, '沙包 HP 無限、2 秒沒被打會回滿；可以看連段傷害', VW / 2, 360, 12, '#fde68a', 'center', false);
    button(ctx, '開始練習！', VW / 2, 392, 200, this.row === 4);
  }

  private renderVersus(ctx: CanvasRenderingContext2D): void {
    const ids = this.app.data.stageOrder;
    const st = this.app.data.stages[ids[this.stageIdx]];
    button(ctx, `◀ ${st.name} ▶`, VW / 2, 102, 360, this.row === 1);
    drawStageCard(ctx, this.app.data, ids[this.stageIdx], VW / 2, 150, 320, { selected: this.row === 1 });
    // 所有場地的小縮圖
    const w = 70;
    const gap = 8;
    const x0 = VW / 2 - ((w + gap) * ids.length - gap) / 2 + w / 2;
    ids.forEach((id, i) => drawStageCard(ctx, this.app.data, id, x0 + i * (w + gap), 342, w, { selected: i === this.stageIdx }));
    button(ctx, '開戰！', VW / 2, 392, 200, this.row === 2);
  }

  private renderCampaign(ctx: CanvasRenderingContext2D): void {
    const cd = this.app.data.campaignDifficulty;
    const d = [cd.easy, cd.normal, cd.hard][this.diffIdx];
    const r = ROUTES[this.routeIdx];
    // 三個設定並排
    button(ctx, `◀ 難度：${d.label} ▶`, VW / 2 - 250, 102, 230, this.row === ROW_DIFF);
    button(ctx, `◀ 關卡數：${this.length} ▶`, VW / 2, 102, 230, this.row === ROW_LEN);
    button(ctx, `◀ ${r.label} ▶`, VW / 2 + 250, 102, 230, this.row === ROW_ROUTE);
    const desc = this.row === ROW_ROUTE ? r.desc : this.row === ROW_LEN ? `共 ${this.length} 關（1～${this.maxLength}），每關 3 波，最後一關有頭目` : DIFF_DESC[this.diffIdx];
    text(ctx, desc, VW / 2, 158, 12, '#fde68a', 'center', false);
    // 路線卡片：一排最多 5 張
    const ids = this.route === 'custom' ? this.custom : defaultCampaignRoute(this.app.data, this.length);
    const perRow = 5;
    const rowsN = Math.ceil(ids.length / perRow);
    const w = rowsN > 1 ? 128 : this.length <= 3 ? 170 : 140;
    const gap = 14;
    const rowH = Math.round((w * 9) / 16) + 34;
    const y0 = rowsN > 1 ? 172 : 196;
    ids.forEach((id, i) => {
      const rr = Math.floor(i / perRow);
      const inRow = Math.min(perRow, ids.length - rr * perRow);
      const x0 = VW / 2 - ((w + gap) * inRow - gap) / 2 + w / 2;
      const sel = this.route === 'custom' && this.row === ROW_STAGES + i;
      drawStageCard(ctx, this.app.data, id, x0 + (i % perRow) * (w + gap), y0 + rr * rowH, w, {
        selected: sel,
        badge: `第 ${i + 1} 關`,
        tag: i === ids.length - 1 ? '頭目' : undefined,
        label: true,
        mystery: this.route === 'random',
      });
    });
    if (this.route === 'custom' && this.row >= ROW_STAGES && this.row < ROW_STAGES + this.length)
      text(ctx, `第 ${this.row - ROW_STAGES + 1} 關：←→ 換場景`, VW / 2, 384, 12, '#ffd23f', 'center', false);
    button(ctx, '出發！', VW / 2, 392, 200, this.row === this.rowCount() - 1);
  }
}
