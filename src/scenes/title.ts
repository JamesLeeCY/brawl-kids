import { CONFIG } from '../config';
import { drawFigure } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { Scene, type MenuInput } from './scene';
import { SelectScene } from './select';
import { OnlineMenuScene } from './online';
import { SettingsScene } from './settings';
import { TutorialScene, tutorialDone } from './tutorial';
import { AchievementsScene } from './achievements';
import { touchMode } from './select';
import { button, hint } from './ui';
import { drawDeskRow, drawLegislature } from '../render/legislature';

const VW = CONFIG.view.width;

export class TitleScene extends Scene {
  private t = 0;
  private readonly options = ['本機遊戲', '連線對戰', '新手教學', '成就', '設定'];
  /** 第一次玩：預設選「新手教學」並提示 */
  private firstRun = !tutorialDone();
  private sel = this.firstRun ? 2 : 0;

  update(inp: MenuInput): void {
    this.t++;
    if (inp.any.up) this.sel = (this.sel + this.options.length - 1) % this.options.length;
    if (inp.any.down) this.sel = (this.sel + 1) % this.options.length;
    if (inp.any.A) this.choose();
  }

  private choose(): void {
    if (this.sel === 0) this.app.scenes.push(new SelectScene(this.app));
    else if (this.sel === 1) this.app.scenes.push(new OnlineMenuScene(this.app));
    else if (this.sel === 2) {
      this.firstRun = false;
      this.app.scenes.push(new TutorialScene(this.app));
    } else if (this.sel === 3) this.app.scenes.push(new AchievementsScene(this.app));
    else this.app.scenes.push(new SettingsScene(this.app));
  }

  onEscape(): void {}

  onClick(x: number, y: number): void {
    if (Math.abs(x - VW / 2) < 100) {
      const i = Math.floor((y - 222) / 40);
      if (i >= 0 && i < this.options.length && (y - 222) % 40 < 36) {
        this.sel = i;
        this.choose();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawLegislature(ctx);
    // 立法院議場：角色分成左右兩側、各兩排站在議員席後面，平均分散不擁擠
    const ids = this.app.data.selectable;
    // 每排的座位平均分散在 x0～x1 之間；右側與左側左右對稱
    const spread = (n: number, x0: number, x1: number) => Array.from({ length: n }, (_, k) => (n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * k) / (n - 1)));
    const seats: { x: number; y: number; s: number; f: 1 | -1; row: 0 | 1 }[] = [];
    const left = Math.ceil(ids.length / 2);
    const right = ids.length - left;
    const sideSeats = (n: number, f: 1 | -1) => {
      const back = Math.ceil(n / 2);
      const front = n - back;
      // 人多時縮小一點，避免擠在一起
      const sc = n > 8 ? 0.92 : 1;
      const mirror = (x: number) => (f === 1 ? x : VW - x);
      spread(back, 44, 262).forEach((x) => seats.push({ x: mirror(x), y: 266, s: sc, f, row: 0 }));
      spread(front, 46, 258).forEach((x) => seats.push({ x: mirror(x), y: 356, s: sc * 1.15, f, row: 1 }));
    };
    sideSeats(left, 1);
    sideSeats(right, -1);
    const drawRow = (row: 0 | 1) =>
      ids.forEach((id, i) => {
        const seat = seats[i];
        if (!seat || seat.row !== row) return;
        const def = this.app.data.characters[id];
        // 偶爾揮手或拍手（不擋臉），每個人錯開時間
        const wave = Math.floor(this.t / 50 + i * 1.7) % 5 === 0;
        const pose = getPose(wave ? (i % 2 ? 'wave2' : 'clap') : `idle_${Math.floor(this.t / 30 + i) % 2}`);
        drawFigure(ctx, def, { pose, x: seat.x, y: seat.y, facing: seat.f, scale: seat.s, tick: this.t, expression: wave ? 'happy' : 'normal', sticker: true });
      });
    drawRow(0);
    drawDeskRow(ctx, 20, 290, 256, -1);
    drawDeskRow(ctx, 510, 780, 256, 1);
    drawRow(1);
    drawDeskRow(ctx, 8, 292, 348, -1);
    drawDeskRow(ctx, 508, 792, 348, 1);
    text(ctx, '台灣大亂鬥', VW / 2, 110, 64, '#ffd23f', 'center', true, true);
    text(ctx, 'TAIWAN BRAWL', VW / 2, 145, 22, '#ffffff', 'center', true, true);
    this.options.forEach((o, i) => button(ctx, o, VW / 2, 222 + i * 40, 200, this.sel === i));
    // 第一次玩：在「新手教學」旁邊安靜地備註（不閃爍）
    // 第一次玩：在「新手教學」按鈕裡、文字右側小小備註（不閃爍、不擋到旁邊的角色）
    if (this.firstRun) text(ctx, '第一次玩', VW / 2 + 92, 222 + 2 * 40 + 22, 11, this.sel === 2 ? '#7c2d12' : '#fde68a', 'right', true);
    if (touchMode()) hint(ctx, '點「攻擊」或選單開始　·　左半邊按住＝搖桿　·　推搖桿方向再點「必殺」放必殺技');
    else hint(ctx, '1P：WASD 移動、J 攻擊 K 跳 L 防禦　·　2P：方向鍵、數字鍵 1/2/3　·　必殺技：按住防禦＋方向，再按攻擊或跳躍');
  }
}
