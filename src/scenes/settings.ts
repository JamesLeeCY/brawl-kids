import { CONFIG } from '../config';
import { ACTION_LABELS, DEFAULT_BINDINGS, HUMAN_PLAYERS, keyName } from '../input/keyboard';
import { roundRect } from '../render/character';
import { text } from '../render/text';
import { saveSettings } from '../settings';
import { ACTIONS } from '../sim/snapshot';
import { Scene, type MenuInput } from './scene';
import { hint, menuBackground } from './ui';
import { applyQualitySetting, type QualitySetting } from '../render/quality';
import { SPEEDS, setGameSpeed, speedValue } from '../speed';
import { SHAKE_LEVELS, setShakeSetting } from '../render/shake';

const QUALITIES: { id: QualitySetting; label: string }[] = [
  { id: 'auto', label: '自動（跑太慢時自動降低）' },
  { id: 'high', label: '高' },
  { id: 'low', label: '低（舊手機建議）' },
];

const VW = CONFIG.view.width;
const ROWS = ACTIONS.length + 8; // 7 個按鍵 + 主音量 + 音效音量 + 音樂音量 + 畫質 + 遊戲速度 + 畫面晃動 + 恢復預設 + 返回
const ROW_QUALITY = ACTIONS.length + 3;
const ROW_SPEED = ACTIONS.length + 4;
const ROW_SHAKE = ACTIONS.length + 5;
const ROW_RESET = ACTIONS.length + 6;
const ROW_BACK = ACTIONS.length + 7;
const VOLUME_KEYS = ['masterVolume', 'sfxVolume', 'musicVolume'] as const;

export class SettingsScene extends Scene {
  private row = 0;
  private col = 0;
  private t = 0;
  private waiting = false;

  update(inp: MenuInput): void {
    this.t++;
    if (this.waiting) return;
    const a = inp.any;
    if (a.up) this.row = (this.row + ROWS - 1) % ROWS;
    if (a.down) this.row = (this.row + 1) % ROWS;
    const s = this.app.settings;
    if (this.row < ACTIONS.length) {
      if (a.left) this.col = (this.col + HUMAN_PLAYERS - 1) % HUMAN_PLAYERS;
      if (a.right) this.col = (this.col + 1) % HUMAN_PLAYERS;
      if (a.A) this.startRebind();
    } else if (this.row < ACTIONS.length + VOLUME_KEYS.length) {
      const key = VOLUME_KEYS[this.row - ACTIONS.length];
      const d = (a.right ? 0.1 : 0) - (a.left ? 0.1 : 0);
      if (d) {
        s[key] = Math.round(Math.max(0, Math.min(1, s[key] + d)) * 10) / 10;
        this.apply();
        if (key !== 'musicVolume') this.app.sfx.play('hit_light');
      }
    } else if (this.row === ROW_QUALITY) {
      const step = a.right || a.A ? 1 : a.left ? -1 : 0;
      if (step) {
        const i = QUALITIES.findIndex((q) => q.id === s.quality);
        s.quality = QUALITIES[(i + QUALITIES.length + step) % QUALITIES.length].id;
        applyQualitySetting(s.quality);
        this.apply();
      }
    } else if (this.row === ROW_SPEED) {
      const step = a.right || a.A ? 1 : a.left ? -1 : 0;
      if (step) {
        const i = SPEEDS.findIndex((x) => x.id === s.speed);
        s.speed = SPEEDS[(i + SPEEDS.length + step) % SPEEDS.length].id;
        setGameSpeed(speedValue(s.speed));
        this.apply();
      }
    } else if (this.row === ROW_SHAKE) {
      const step = a.right || a.A ? 1 : a.left ? -1 : 0;
      if (step) {
        const i = SHAKE_LEVELS.findIndex((x) => x.id === s.shake);
        s.shake = SHAKE_LEVELS[(i + SHAKE_LEVELS.length + step) % SHAKE_LEVELS.length].id;
        setShakeSetting(s.shake);
        this.apply();
      }
    } else if (this.row === ROW_RESET && a.A) {
      s.bindings = DEFAULT_BINDINGS.map((b) => ({ ...b }));
      this.apply();
    } else if (this.row === ROW_BACK && a.A) this.app.scenes.pop();
  }

  private startRebind(): void {
    this.waiting = true;
    const action = ACTIONS[this.row];
    const player = this.col;
    this.app.kb.capture = (code) => {
      this.waiting = false;
      if (code === 'Escape') return;
      const bs = this.app.settings.bindings;
      // 若此鍵已被使用，與原位置互換
      const old = bs[player][action];
      for (const b of bs) for (const ac of ACTIONS) if (b[ac] === code) b[ac] = old;
      bs[player][action] = code;
      this.apply();
    };
  }

  private apply(): void {
    const s = this.app.settings;
    this.app.kb.setBindings(s.bindings);
    this.app.sfx.setVolumes(s.masterVolume, s.sfxVolume);
    this.app.music.setVolume(s.musicVolume);
    saveSettings(s);
  }

  onEscape(): void {
    if (this.waiting) {
      this.app.kb.capture = null;
      this.waiting = false;
      return;
    }
    this.app.scenes.pop();
  }

  render(ctx: CanvasRenderingContext2D): void {
    menuBackground(ctx, this.t, '#0f1d33', '#1e3a5f');
    text(ctx, '設定', VW / 2, 42, 28, '#ffd23f', 'center');
    const x0 = 230;
    const cw = 200;
    for (let p = 0; p < HUMAN_PLAYERS; p++) text(ctx, `${p + 1}P`, x0 + p * cw + cw / 2, 80, 15, ['#ff5a5a', '#4da6ff'][p], 'center');
    const s = this.app.settings;
    ACTIONS.forEach((a, r) => {
      const y = 86 + r * 24;
      text(ctx, ACTION_LABELS[a], x0 - 20, y + 16, 14, '#fff', 'right');
      for (let p = 0; p < HUMAN_PLAYERS; p++) {
        const sel = this.row === r && this.col === p;
        ctx.fillStyle = sel ? (this.waiting ? '#ff7b54' : '#ffd23f') : 'rgba(255,255,255,0.1)';
        roundRect(ctx, x0 + p * cw + 8, y, cw - 16, 21, 5);
        ctx.fill();
        const label = sel && this.waiting ? '請按新按鍵…' : keyName(s.bindings[p][a]);
        text(ctx, label, x0 + p * cw + cw / 2, y + 15, 13, sel ? '#111' : '#fff', 'center');
      }
    });
    const vy = 86 + ACTIONS.length * 24 + 6;
    const vols: [string, number][] = [
      ['主音量', s.masterVolume],
      ['音效音量', s.sfxVolume],
      ['音樂音量', s.musicVolume],
    ];
    vols.forEach(([label, v], i) => {
      const y = vy + i * 22;
      const sel = this.row === ACTIONS.length + i;
      text(ctx, label, x0 - 20, y + 18, 14, sel ? '#ffd23f' : '#fff', 'right');
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x0 + 8, y + 7, 400, 10);
      ctx.fillStyle = sel ? '#ffd23f' : '#9ecbff';
      ctx.fillRect(x0 + 8, y + 7, 400 * v, 10);
      text(ctx, `${Math.round(v * 100)}%`, x0 + 420, y + 18, 13, '#fff');
    });
    // 畫質
    const qy = vy + 66;
    const qsel = this.row === ROW_QUALITY;
    const q = QUALITIES.find((x) => x.id === s.quality) ?? QUALITIES[0];
    text(ctx, '畫質', x0 - 20, qy + 18, 14, qsel ? '#ffd23f' : '#fff', 'right');
    text(ctx, qsel ? `◀ ${q.label} ▶` : q.label, x0 + 8, qy + 18, 14, qsel ? '#ffd23f' : '#fff', 'left');
    // 遊戲速度
    const sy = vy + 88;
    const ssel = this.row === ROW_SPEED;
    const sp = SPEEDS.find((x) => x.id === s.speed) ?? SPEEDS[1];
    text(ctx, '遊戲速度', x0 - 20, sy + 18, 14, ssel ? '#ffd23f' : '#fff', 'right');
    text(ctx, ssel ? `◀ ${sp.label} ▶` : sp.label, x0 + 8, sy + 18, 14, ssel ? '#ffd23f' : '#fff', 'left');
    text(ctx, '連線時以房主的設定為準', x0 + 330, sy + 18, 11, 'rgba(255,255,255,0.55)', 'left', false);
    // 畫面晃動
    const hy = vy + 110;
    const hsel = this.row === ROW_SHAKE;
    const sh = SHAKE_LEVELS.find((x) => x.id === s.shake) ?? SHAKE_LEVELS[0];
    text(ctx, '畫面晃動', x0 - 20, hy + 18, 14, hsel ? '#ffd23f' : '#fff', 'right');
    text(ctx, hsel ? `◀ ${sh.label} ▶` : sh.label, x0 + 8, hy + 18, 14, hsel ? '#ffd23f' : '#fff', 'left');
    text(ctx, '看了頭暈可以調弱或關掉', x0 + 330, hy + 18, 11, 'rgba(255,255,255,0.55)', 'left', false);
    const by = vy + 134;
    text(ctx, '恢復預設按鍵', VW / 2 - 90, by + 16, 15, this.row === ROW_RESET ? '#ffd23f' : '#fff', 'center');
    text(ctx, '返回', VW / 2 + 90, by + 16, 15, this.row === ROW_BACK ? '#ffd23f' : '#fff', 'center');
    hint(ctx, '方向鍵移動　攻擊鍵 / Enter 重新綁定　左右調整音量　Esc 返回　·　P1 坐左、P2 坐右');
  }
}
