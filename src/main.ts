// 進入點：固定時間步長迴圈（accumulator），邏輯 60 tick/秒，繪圖跟隨 requestAnimationFrame。
import { Sfx } from './audio/sfx';
import { CONFIG } from './config';
import { getGameData } from './data';
import { Keyboard } from './input/keyboard';
import { setViewWidth } from './render/view';
import { TouchControls } from './input/touch';
import { text } from './render/text';
import { SceneManager, unionPressed, type App, type MenuInput } from './scenes/scene';
import { defaultSlots } from './scenes/select';
import { JoinScene, OnlineMenuScene } from './scenes/online';
import { TitleScene } from './scenes/title';
import { updateIfStale } from './version';
import { loadSettings } from './settings';
import { emptySnapshot, pressedEdges, type Snapshot } from './sim/snapshot';
import type { World } from './sim/world';
import type { NetSession } from './net/session';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
const STEP = 1000 / CONFIG.tickRate;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

const settings = loadSettings();
const kb = new Keyboard(window);
kb.setBindings(settings.bindings);
const sfx = new Sfx();
sfx.setVolumes(settings.masterVolume, settings.sfxVolume);
kb.onFirstInput = () => sfx.unlock();
const touchUi = new TouchControls(kb, document.body);
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => sfx.unlock());

const app: App = {
  data: getGameData(),
  settings,
  kb,
  sfx,
  scenes: new SceneManager(),
  slots: defaultSlots(),
  showFps: false,
};
app.scenes.push(new TitleScene(app));
// 透過分享連結 ?room=XXXXXX 開啟時直接加入房間
const roomCode = new URLSearchParams(window.location.search).get('room');
if (roomCode) {
  app.scenes.push(new OnlineMenuScene(app));
  app.scenes.push(new JoinScene(app, roomCode));
}
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;

// 正式版：若瀏覽器快取到舊版網頁（和伺服器上的 version.json 不同），自動換到新版
void updateIfStale();
// PWA：可「加入主畫面」，全螢幕橫向開啟，第二次開啟更快（離線快取）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
// 網頁開著放在背景很久（手機常見），回到前景且還在標題畫面時再檢查一次
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.scenes.top instanceof TitleScene) void updateIfStale();
});

// ---------- 畫布縮放 ----------
// 桌機：16:9 等比放大，邊緣留黑。手機橫向：邏輯寬度加寬到螢幕比例，戰鬥畫面填滿整個螢幕（荒野亂鬥式）。
const MAX_WIDE = 1040;
let scale = 1;
let logicalW: number = VW;
function resize(): void {
  const iw = window.innerWidth;
  const ih = window.innerHeight;
  const touch = document.body.classList.contains('touch-mode');
  logicalW = touch && iw > ih ? Math.max(VW, Math.min(MAX_WIDE, Math.round((VH * iw) / ih))) : VW;
  setViewWidth(logicalW);
  const s = Math.min(iw / logicalW, ih / VH);
  canvas.style.width = `${Math.floor(logicalW * s)}px`;
  canvas.style.height = `${Math.floor(VH * s)}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  scale = Math.max(1, Math.min(3, Math.ceil(s * dpr)));
  canvas.width = Math.round(logicalW * scale);
  canvas.height = VH * scale;
}
window.addEventListener('resize', resize);
resize();

/** 非加寬場景（選單）在加寬畫布中置中的偏移 */
function sceneOffset(): number {
  return app.scenes.top?.wide ? 0 : (logicalW - VW) / 2;
}

canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * logicalW - sceneOffset();
  app.scenes.top?.onClick(x, ((e.clientY - r.top) / r.height) * VH);
});

// ---------- 主迴圈 ----------
let prevHeld: Snapshot[] = [0, 1, 2, 3].map(() => emptySnapshot());
let acc = 0;
let last = performance.now();
let fps = 60;
let frames = 0;
let fpsTimer = last;

function tick(codes: string[]): void {
  if (codes.includes('F3')) app.showFps = !app.showFps;
  const held = settings.bindings.map((b, i) => kb.snapshot(b, i));
  kb.endTick();
  const pressed = held.map((h, i) => pressedEdges(h, prevHeld[i]));
  prevHeld = held;
  if (codes.includes('Escape')) {
    app.scenes.top?.onEscape();
    return;
  }
  const inp: MenuInput = { held, pressed, any: unionPressed(pressed, codes.includes('Enter')), codes };
  app.scenes.top?.update(inp);
}

function frame(now: number): void {
  acc += Math.min(now - last, STEP * CONFIG.maxCatchUpTicks);
  last = now;
  let n = 0;
  let codes = kb.drainPressed();
  while (acc >= STEP && n < CONFIG.maxCatchUpTicks) {
    try {
      tick(codes);
    } catch (err) {
      console.error(err);
    }
    codes = [];
    acc -= STEP;
    n++;
  }
  if (n === CONFIG.maxCatchUpTicks) acc = 0;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, logicalW, VH);
  const off = sceneOffset();
  if (off) ctx.translate(off, 0);
  app.scenes.top?.render(ctx);
  if (off) ctx.setTransform(scale, 0, 0, scale, 0, 0);
  touchUi.setCharge(superCharge());
  document.body.classList.toggle('in-battle', !!app.scenes.top?.wide);
  frames++;
  if (now - fpsTimer >= 500) {
    fps = (frames * 1000) / (now - fpsTimer);
    frames = 0;
    fpsTimer = now;
  }
  if (app.showFps) text(ctx, `${fps.toFixed(0)} FPS`, logicalW - 6, VH - 6, 11, "#0f0", "right");
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** 觸控「必殺」鈕的充能比例＝本機玩家目前 MP */
function superCharge(): number {
  const top = app.scenes.top as unknown as { world?: World; net?: NetSession | null } | undefined;
  const w = top?.world;
  if (!w) return 1;
  const slot = top?.net ? top.net.mySlot : 0;
  const me = w.chars().find((c) => c.slot === slot);
  return me ? me.mp / CONFIG.combat.mpMax : 1;
}
