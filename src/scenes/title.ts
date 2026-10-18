import { CONFIG } from '../config';
import { drawFigure } from '../render/character';
import { getPose } from '../render/poses';
import { text } from '../render/text';
import { Scene, type MenuInput } from './scene';
import { SelectScene } from './select';
import { OnlineMenuScene } from './online';
import { SettingsScene } from './settings';
import { touchMode } from './select';
import { button, hint, menuBackground } from './ui';

const VW = CONFIG.view.width;

export class TitleScene extends Scene {
  private sel = 0;
  private t = 0;
  private readonly options = ['本機遊戲', '連線對戰', '設定'];

  update(inp: MenuInput): void {
    this.t++;
    if (inp.any.up) this.sel = (this.sel + this.options.length - 1) % this.options.length;
    if (inp.any.down) this.sel = (this.sel + 1) % this.options.length;
    if (inp.any.A) this.choose();
  }

  private choose(): void {
    if (this.sel === 0) this.app.scenes.push(new SelectScene(this.app));
    else if (this.sel === 1) this.app.scenes.push(new OnlineMenuScene(this.app));
    else this.app.scenes.push(new SettingsScene(this.app));
  }

  onEscape(): void {}

  onClick(x: number, y: number): void {
    if (Math.abs(x - VW / 2) < 100) {
      const i = Math.floor((y - 290) / 40);
      if (i >= 0 && i < this.options.length && (y - 290) % 40 < 34) {
        this.sel = i;
        this.choose();
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t);
    const ids = this.app.data.selectable;
    // 角色分左右兩群站在標題兩側
    const half = Math.ceil(ids.length / 2);
    ids.forEach((id, i) => {
      const def = this.app.data.characters[id];
      const left = i < half;
      const k = left ? i : i - half;
      const x = left ? 40 + k * 46 : VW - 40 - k * 46;
      const y = 250 + (k % 2) * 26;
      const cheer = Math.floor(this.t / 40 + i) % 3 === 0;
      const pose = getPose(cheer ? 'victory' : `idle_${Math.floor(this.t / 30) % 2}`);
      drawFigure(ctx, def, { pose, x, y: y + 6, facing: left ? 1 : -1, scale: 1.15, tick: this.t, expression: cheer ? 'happy' : 'normal' });
    });
    text(ctx, '台灣大亂鬥', VW / 2, 110, 64, '#ffd23f', 'center', true, true);
    text(ctx, 'TAIWAN BRAWL', VW / 2, 145, 22, '#ffffff', 'center', true, true);
    this.options.forEach((o, i) => button(ctx, o, VW / 2, 290 + i * 40, 200, this.sel === i));
    if ((this.t >> 5) % 2 === 0) text(ctx, touchMode() ? '點選單或「攻擊」開始' : '按任一玩家的攻擊鍵開始', VW / 2, 420, 15, '#fff', 'center');
    if (touchMode()) hint(ctx, '點「攻擊」或選單開始　·　左半邊按住＝搖桿　·　推搖桿方向再點「必殺」放必殺技');
    else hint(ctx, '1P：WASD 移動、J 攻擊 K 跳 L 防禦　·　2P：方向鍵、數字鍵 1/2/3　·　必殺技：按住防禦＋方向，再按攻擊或跳躍');
  }
}
