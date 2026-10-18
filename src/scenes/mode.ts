import { CONFIG, type Difficulty } from '../config';
import { text } from '../render/text';
import type { GameMode, MatchSetup, PlayerSetup } from '../sim/world';
import { BattleScene } from './battle';
import { Scene, type App, type MenuInput } from './scene';
import { button, hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

export function buildSetup(app: App, mode: GameMode, stageId: string, campaignIndex = 0, campaignDifficulty: Difficulty = 'normal'): MatchSetup {
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
  return {
    mode,
    stageId: mode === 'campaign' ? app.data.campaign[campaignIndex].stage : stageId,
    seed: (Date.now() ^ (performance.now() * 1000)) >>> 0,
    players,
    campaignIndex,
    campaignDifficulty,
  };
}

export class ModeScene extends Scene {
  private t = 0;
  private row = 0;
  private mode: GameMode = 'versus';
  private stageIdx = 0;
  private diffIdx = 1;
  private warn = 0;

  update(inp: MenuInput): void {
    this.t++;
    if (this.warn > 0) this.warn--;
    const a = inp.any;
    const rows = 3;
    if (a.up) this.row = (this.row + rows - 1) % rows;
    if (a.down) this.row = (this.row + 1) % rows;
    if (this.row === 0 && (a.left || a.right)) {
      this.mode = this.mode === 'versus' ? 'campaign' : 'versus';
      this.row = 0;
    }
    const stages = this.app.data.stageOrder;
    if (this.row === 1 && this.mode === 'versus') {
      if (a.left) this.stageIdx = (this.stageIdx + stages.length - 1) % stages.length;
      if (a.right) this.stageIdx = (this.stageIdx + 1) % stages.length;
    }
    if (this.row === 1 && this.mode === 'campaign') {
      if (a.left) this.diffIdx = (this.diffIdx + 2) % 3;
      if (a.right) this.diffIdx = (this.diffIdx + 1) % 3;
    }
    if (a.A || a.J) {
      const startRow = 2;
      if (this.row === startRow || a.J) this.start();
      else this.row = Math.min(this.row + 1, startRow);
    }
  }

  private start(): void {
    const diffs: Difficulty[] = ['easy', 'normal', 'hard'];
    const setup = buildSetup(this.app, this.mode, this.app.data.stageOrder[this.stageIdx], 0, diffs[this.diffIdx]);
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
    text(ctx, '選擇模式與場地', VW / 2, 50, 26, '#ffd23f', 'center', true, true);
    button(ctx, `◀ ${this.mode === 'versus' ? '對戰模式' : '闖關模式'} ▶`, VW / 2, 90, 300, this.row === 0);
    if (this.mode === 'versus') {
      const st = this.app.data.stages[this.app.data.stageOrder[this.stageIdx]];
      button(ctx, `◀ ${st.name} ▶`, VW / 2, 140, 300, this.row === 1);
      this.preview(ctx, st.palette.skyTop, st.palette.skyBottom, st.palette.ground, st.palette.near);
      button(ctx, '開戰！', VW / 2, 360, 200, this.row === 2);
      text(ctx, '場上只剩一隊存活即獲勝', VW / 2, 345, 12, 'rgba(255,255,255,0.7)', 'center', false);
    } else {
      const cd = this.app.data.campaignDifficulty;
      const d = [cd.easy, cd.normal, cd.hard][this.diffIdx];
      button(ctx, `◀ 難度：${d.label} ▶`, VW / 2, 140, 300, this.row === 1);
      const desc = ['敵人較弱、血量 80%，適合新手', '標準難度', '敵人更聰明、每波多一隻、血量 130%'][this.diffIdx];
      text(ctx, desc, VW / 2, 196, 13, '#fde68a', 'center', false);
      const names = this.app.data.campaign.map((c) => this.app.data.stages[c.stage]?.name ?? c.stage);
      names.forEach((n, i) => text(ctx, `第 ${i + 1} 關　${n}　（3 波${i === names.length - 1 ? '，最後一波頭目' : ''}）`, VW / 2, 226 + i * 24, 15, '#fff', 'center'));
      text(ctx, '所有玩家同隊合作；電腦欄位成為隊友', VW / 2, 336, 12, 'rgba(255,255,255,0.75)', 'center', false);
      button(ctx, '出發！', VW / 2, 352, 200, this.row === 2);
    }
    if (this.warn > 0) text(ctx, '對戰至少需要兩隊！請回選角設定隊伍或加入電腦。', VW / 2, 412, 15, '#ff7b7b', 'center');
    hint(ctx, '↑↓ 選擇　←→ 切換　攻擊 確定　跳躍 直接開始　Esc 返回選角');
  }

  private preview(ctx: CanvasRenderingContext2D, a: string, b: string, ground: string, near: string): void {
    const g = ctx.createLinearGradient(0, 190, 0, 320);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(VW / 2 - 160, 186, 320, 100);
    ctx.fillStyle = near;
    for (let i = 0; i < 6; i++) ctx.fillRect(VW / 2 - 160 + i * 54, 236 - (i % 3) * 10, 48, 30 + (i % 3) * 10);
    ctx.fillStyle = ground;
    ctx.fillRect(VW / 2 - 160, 266, 320, 40);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(VW / 2 - 160, 186, 320, 120);
  }
}
