// 成就與角色戰績畫面（標題選單「成就」）
import { CONFIG } from '../config';
import { roundRect } from '../render/character';
import { text } from '../render/text';
import { ACHIEVEMENTS, loadProgress, type TotalInfo } from '../progress';
import { Scene, type App, type MenuInput } from './scene';
import { hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

export function progressTotals(app: App): TotalInfo {
  return { characters: app.data.selectable.length, stages: app.data.stageOrder.length, maxCampaign: app.data.campaign.length };
}

export class AchievementsScene extends Scene {
  private t = 0;

  update(inp: MenuInput): void {
    this.t++;
    if (this.t > 10 && (inp.any.A || inp.any.D || inp.any.J)) this.app.scenes.pop();
  }

  onEscape(): void {
    this.app.scenes.pop();
  }

  onClick(): void {
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#1e1b4b', '#3b0764');
    const p = loadProgress();
    const total = progressTotals(this.app);
    const got = ACHIEVEMENTS.filter((a) => p.unlocked[a.id]).length;
    text(ctx, `成就　${got} / ${ACHIEVEMENTS.length}`, VW / 2, 40, 24, '#ffd23f', 'center', true, true);

    // 左：成就清單
    ACHIEVEMENTS.forEach((a, i) => {
      const y = 62 + i * 27;
      const ok = !!p.unlocked[a.id];
      ctx.fillStyle = ok ? 'rgba(34,197,94,0.22)' : 'rgba(255,255,255,0.07)';
      roundRect(ctx, 16, y, 420, 24, 6);
      ctx.fill();
      text(ctx, `${ok ? '★' : '☆'} ${a.name}`, 26, y + 17, 13, ok ? '#fde047' : '#cbd5e1', 'left');
      text(ctx, a.desc, 150, y + 17, 11, ok ? '#fff' : 'rgba(255,255,255,0.65)', 'left', false);
      if (!ok && a.progress) {
        const [cur, goal] = a.progress(p, total);
        text(ctx, `${Math.min(cur, goal)} / ${goal}`, 428, y + 17, 11, '#93c5fd', 'right', false);
      }
    });

    // 右：角色戰績
    const x0 = 452;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, x0, 58, 332, 356, 10);
    ctx.fill();
    text(ctx, '角色戰績（這台裝置）', x0 + 166, 80, 14, '#ffd23f', 'center');
    const rows = this.app.data.selectable
      .map((id) => ({ id, s: p.chars[id] ?? { played: 0, wins: 0 } }))
      .sort((a, b) => b.s.played - a.s.played || b.s.wins - a.s.wins);
    rows.forEach(({ id, s }, i) => {
      const col = i < 8 ? 0 : 1;
      const r = i % 8;
      const x = x0 + 12 + col * 162;
      const y = 106 + r * 38;
      const name = this.app.data.characters[id].name;
      text(ctx, name, x, y, 13, s.played ? '#fff' : 'rgba(255,255,255,0.45)', 'left');
      const rate = s.played ? `${Math.round((s.wins / s.played) * 100)}%` : '—';
      text(ctx, `${s.wins} 勝 / ${s.played} 場　${rate}`, x, y + 16, 11, s.played ? '#86efac' : 'rgba(255,255,255,0.35)', 'left', false);
    });
    hint(ctx, '戰績與成就只存在這台裝置的瀏覽器　·　任一鍵返回');
  }
}
