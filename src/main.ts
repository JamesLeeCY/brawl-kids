// 進入點：固定時間步長迴圈（accumulator），邏輯 60 tick/秒，繪圖跟隨 requestAnimationFrame。
import { musicCue } from './audio/director';
import { Music } from './audio/music';
import { Sfx } from './audio/sfx';
import { trackFor } from './audio/tracks';
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
import { extractReplayCode, HASH_PREFIX } from './replay/replay';
import { clearReplayHash } from './replay/share';
import { ReplayLoadScene } from './scenes/replay';
import { emptySnapshot, pressedEdges, type Snapshot } from './sim/snapshot';
import type { World } from './sim/world';
import type { NetSession } from './net/session';
import { AutoQuality, applyQualitySetting, lowQuality, onQualityChange } from './render/quality';
import { setGameSpeed, speedValue, tickMs } from './speed';

const VW = CONFIG.view.width;
const VH = CONFIG.view.height;
// 一個邏輯 tick 的毫秒數依目前的遊戲速度（快 / 中 / 慢）而定

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d', { alpha: false })!;

const settings = loadSettings();
const kb = new Keyboard(window);
kb.setBindings(settings.bindings);
const sfx = new Sfx();
sfx.setVolumes(settings.masterVolume, settings.sfxVolume);
const music = new Music(sfx);
music.setVolume(settings.musicVolume);
kb.onFirstInput = () => sfx.unlock();
const touchUi = new TouchControls(kb, document.body);
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('pointerdown', () => sfx.unlock());

const data = getGameData();
const app: App = {
  data,
  settings,
  kb,
  sfx,
  music,
  scenes: new SceneManager(),
  slots: defaultSlots(data.selectable.length),
  showFps: false,
};
app.scenes.push(new TitleScene(app));
// 透過分享連結 ?room=XXXXXX 開啟時直接加入房間
const roomCode = new URLSearchParams(window.location.search).get('room');
if (roomCode) {
  app.scenes.push(new OnlineMenuScene(app));
  app.scenes.push(new JoinScene(app, roomCode));
}
// 透過分享連結 #replay=... 開啟時直接播放重播；離開後回到標題
function openReplay(code: string): void {
  const home = app.scenes.stack.slice(0, 1);
  app.scenes.reset([
    ...home,
    new ReplayLoadScene(app, code, () => {
      clearReplayHash();
      app.scenes.reset(home);
    }),
  ]);
}
if (location.hash.startsWith(HASH_PREFIX)) openReplay(location.hash.slice(HASH_PREFIX.length));
// 已開著遊戲時貼上重播連結（只改 hash，不會重新載入）
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith(HASH_PREFIX)) openReplay(location.hash.slice(HASH_PREFIX.length));
});
// 標題畫面 Ctrl+V 貼上重播代碼或連結（網址太長時分享的是代碼文字）
window.addEventListener('paste', (e) => {
  if (!(app.scenes.top instanceof TitleScene)) return;
  const s = e.clipboardData?.getData('text') ?? '';
  const code = s.length >= 40 ? extractReplayCode(s) : null;
  if (code) openReplay(code);
});
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
  music.setHidden(document.visibilityState === 'hidden');
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
  // 低畫質：用 1 倍解析度繪製（手機上像素量少一半以上）
  scale = lowQuality ? 1 : Math.max(1, Math.min(3, Math.ceil(s * dpr)));
  canvas.width = Math.round(logicalW * scale);
  canvas.height = VH * scale;
}
window.addEventListener('resize', resize);
applyQualitySetting(app.settings.quality);
setGameSpeed(speedValue(app.settings.speed));
onQualityChange(resize);
resize();
const autoQuality = new AutoQuality();

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
  const STEP = tickMs();
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
  // 背景音樂只讀取場景狀態；Music 在使用者第一次操作（解鎖 AudioContext）前不會出聲
  music.play(trackFor(musicCue(app)));
  document.body.classList.toggle('in-battle', !!app.scenes.top?.wide && !app.scenes.top.noTouchPad);
  frames++;
  if (now - fpsTimer >= 500) {
    fps = (frames * 1000) / (now - fpsTimer);
    frames = 0;
    fpsTimer = now;
    // 自動畫質：戰鬥中（開場之後）跑太慢就降成低畫質
    const top = app.scenes.top as { wide?: boolean; intro?: number } | undefined;
    autoQuality.sample(fps, app.settings.quality, !!top?.wide && !(top.intro && top.intro > 0), now);
  }
  if (now < autoQuality.noticeUntil) text(ctx, '畫面較慢，已自動切換為低畫質（設定可調整）', logicalW / 2, 22, 12, '#fde68a', 'center', true, true);
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
