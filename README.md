# 混戰小英雄 Brawl Kids

瀏覽器上的 2.5D 亂鬥格鬥遊戲：最多 2 名玩家共用一副鍵盤，再加上最多 2 名電腦，在台北街頭互毆、丟道具、放必殺技。所有美術與音效都以程式即時繪製 / 合成。

> 角色為諧音梗命名的 Q 版戲仿造型（僅以髮型、眼鏡、配件與代表色呈現），純屬虛構娛樂，與任何真實人物無關。

## 快速開始

在 Windows PowerShell 中（PowerShell 5.1 不支援 `&&`，請分兩行或用 `;`）：

```bash
cd D:\side_project\LF2_Game\brawl-kids
```

```bash
npm run dev
```

接著開啟 http://localhost:5173 。其他指令：`npm test`（自動測試）、`npm run build`（輸出 `dist/`，可直接部署到靜態主機）。

## 操作鍵位（兩人一副鍵盤，間隔加寬）

P1 坐左邊、P2 坐右邊。按鍵可在標題畫面「設定」重新綁定（存於 localStorage）。

| 玩家 | 上 / 下 / 左 / 右 | 攻擊 | 跳躍 | 防禦 |
| --- | --- | --- | --- | --- |
| P1 | W / S / A / D（左手） | J | K | L（右手） |
| P2 | ↑ / ↓ / ← / →（左手） | 數字鍵 1 | 數字鍵 2 | 數字鍵 3（右手） |

> 筆電沒有數字鍵盤時，請到「設定」把 P2 的攻擊 / 跳躍 / 防禦改成例如 `,` `.` `/` 或 `[` `]` `\`。

其他按鍵：`Esc` 回上一頁 / 戰鬥中暫停，`Enter` 在選單中等同攻擊，`F3` 顯示 FPS。

### 基本動作

- **連擊**：攻擊 ×3（間隔 15 tick 內），第 3 段擊倒
- **跑步**：前方向鍵快速連按兩次（按住持續跑）
- **跑步中**：攻擊 = 衝撞、跳躍 = 衝刺跳、防禦 = 翻滾（無敵）
- **空中攻擊**：飛踢
- **防禦**：按住減傷 90%，防禦值歸零會破防硬直
- **道具**：靠近按攻擊撿起；持有時攻擊揮擊，跑步 / 跳躍中攻擊投出；木箱只能投擲
- **抓摔**：走向暈眩中的敵人自動抓住，攻擊 = 揍打、方向 + 攻擊 = 摔出

### 角色與必殺技（防禦 → 方向 → 攻擊/跳躍，20 tick 內）

「→」為角色面向的前方；按左或右的同時角色會轉向該方向。

| 角色 | 特色 | 招式 |
| --- | --- | --- |
| 講萬安（首都市粘） | 平衡、速度快 | D→A 市政公文 60 · D→J 捷運衝刺 80 · D↑A 市民護盾 150 |
| 柯問哲（白袍狂人） | 力量型 | D→A ECMO 電擊 90（可空中）· D↑A 白色力量 180 · D→J 急診衝刺 80 |
| 來清德（醫師元首） | 血厚、穩重 | D→A 處方籤追蹤 80 · D↑A 仁心回春（回血）160 · D↓A 穩健震地 100 |
| 神伯洋（黑熊教頭） | 快、血薄 | D→A 黑熊出擊 75 · D↓A 反滲透漩渦 110 · D↑A 識讀護盾 100 |

## 場地

| 場地 | 特色 |
| --- | --- |
| 台灣大學・椰林大道 | 總圖書館、傅鐘、椰子樹，騎腳踏車的學生經過 |
| 台北西門町 | 紅磚八角樓、霓虹招牌閃爍、路人走過 |
| 東區・台北大巨蛋 | 大巨蛋與國父紀念館、演唱會燈光，攤前會冒出珍珠奶茶 |
| 台北信義區・101 | 101 燈光變色、空橋、夜空煙火，偶爾出現便當 |

## 闖關模式三種難度

選模式畫面選「闖關模式」後，用 ← → 切換難度：

| 難度 | 敵人 AI | 每波敵人 | 敵人血量 | 頭目血量 |
| --- | --- | --- | --- | --- |
| 簡單 | 降一級 | 標準 | 80% | ×1.5 |
| 普通 | 標準 | 標準 | 100% | ×2 |
| 困難 | 升一級 | 每種多 1 隻 | 130% | ×2.5 |

關卡順序：台灣大學 → 西門町 → 東區大巨蛋 → 信義區（最後一波頭目）。數值在 `src/data/stages.json` 的 `campaignDifficulty` 可調整。

## 連線對戰（2 人，各自一台電腦）

標題畫面選「連線對戰」：

1. **房主**選「建立房間」，畫面會顯示 6 碼房間代碼與分享連結，按攻擊鍵（或點畫面）複製連結傳給朋友。
2. **朋友**打開連結就會自動加入；或選「加入房間」手動輸入代碼。
3. 兩人各自選角，房主用 ↑↓ 選模式：對戰（4 個場地）或合作闖關（簡單 / 普通 / 困難）。
4. 兩人都按「跳躍」確定後自動開始。結算後房主按攻擊「再來一場」，任一方按防禦回到連線選角。

連線時你可以用 WASD + J/K/L 或 方向鍵 + 數字鍵 1/2/3 任一組操作。遊戲中按 Esc 會開選單，但**連線時遊戲不會暫停**。

**運作方式**：使用 WebRTC 點對點（PeerJS）直接連接兩位玩家的瀏覽器，不需要自架遊戲伺服器。PeerJS 的免費配對伺服器只負責「介紹」雙方，遊戲資料直接在兩台電腦之間傳送。遊戲是決定論 lockstep：雙方只交換按鍵，各自計算同一個世界；輸入延遲依實際網路延遲自動調整（3–12 tick）。

**注意事項**：

- 雙方都要開啟同一個網址（同一版本）；版本不同會提示重新整理。
- 切換到其他分頁會讓瀏覽器暫停遊戲，對手會看到「等待對手…」。
- 少數公司 / 學校網路會擋 WebRTC，若一直「連線中」，請換手機熱點試試。
- 畫面左下顯示延遲（ms）；若出現「⚠ 畫面可能不同步」請回選角重開一局。

## 部署到 GitHub Pages（免費、可分享網址）

專案已內建 GitHub Actions（`.github/workflows/deploy.yml`）：推到 `main` 分支就會自動測試、建置並部署。

1. 在 GitHub 建立新的 repository，例如 `brawl-kids`（Public；私人 repo 需付費方案才能開 Pages）。
2. 在本機 `brawl-kids` 資料夾初始化並推上去：

   ```bash
   git init
   ```

   ```bash
   git add .
   ```

   ```bash
   git commit -m "Brawl Kids"
   ```

   ```bash
   git branch -M main
   ```

   ```bash
   git remote add origin https://github.com/<你的帳號>/brawl-kids.git
   ```

   ```bash
   git push -u origin main
   ```

3. 到 repo 的 **Settings → Pages**，把 **Source** 設為 **GitHub Actions**。
4. 到 **Actions** 分頁等「Deploy to GitHub Pages」跑完（約 1–2 分鐘），網址會是 `https://<你的帳號>.github.io/brawl-kids/`。
5. 之後每次修改只要 `git add .`、`git commit -m "..."`、`git push`，網站就會自動更新。



標題 → 選角 → 選模式與場地 → 戰鬥 → 結算（再來一場 / 回選角）。

選角畫面：1P、2P 按自己的攻擊鍵加入，←→ 選角、↑↓ 選隊伍、跳躍確定、防禦退出；3、4 號欄位只能放電腦。
**P1 確定後按 ← / →** 可把空欄位設為電腦對手：攻擊鍵在「簡單 → 普通 → 困難 → 移除」間切換，↑↓ 換角色，跳躍換隊伍，防禦結束設定。全員確定 1 秒後自動進入下一頁。

## 如何新增角色

1. 在 `src/data/characters/` 新增一個 JSON 檔（可複製 `jiang.json` 修改），**不需要改任何程式碼**，重新整理即出現在選角畫面。
2. 必填欄位：`id`（小寫英數與底線）、`name`、`stats`（hp / walkSpeed / runSpeed / jumpPower / weight）、`palette`（skin / main / accent，`#RRGGBB`）。
3. 基本動作（連擊、跑攻、飛踢、揮擊、投擲）來自 `src/data/base_frames.json`；角色 `frames` 中的同名幀會覆寫它們（見 `guardbot.json`）。
4. 必殺技：在 `moves` 加入最多 4 招，`command` 為 `D>A`、`D^A`、`DvA`、`D>J`、`D^J`、`DvJ`，`startFrame` 指向 `frames` 中的幀。
5. 幀欄位：`duration`（tick）、`pose`（`src/render/poses.ts` 的姿勢名）、`next`（下一幀，`"idle"` 回到站立）、`itr` 攻擊框、`bdy` 受擊框、`spawn` 產生飛行物、`selfVel` 自身速度、`buff` 增益（`dmgReduce` / `blockProjectile` / `hover`）、`onA` 連擊接續、`heal` 回復 HP、`sound` 音效。
6. 飛行物定義在角色的 `projectiles` 中，本身也是帶 `frames` 的實體；`onHit` / `onExpire` 可接續另一個飛行物（例如爆炸），`homing` 追蹤、`pull` 吸引敵人。
7. `accessory` 決定辨識配件（`pin`、`bear`、`stethoscope`、`headmirror`、`robot`；其他值則不畫配件）；`look` 設定髮型（`short` / `sidepart` / `neat` / `receding` / `none`）、`glasses`、`tie` 領帶色。`selectable: false` 可讓角色只當闖關雜兵。

載入時以 zod 驗證，格式錯誤會在瀏覽器主控台列出檔名與欄位，並略過該角色。`npm test` 也會檢查所有 `next` / `startFrame` 參照。

新增場地同理：在 `src/data/stages.json` 的 `stages` 加一筆；`theme` 不認得時使用通用背景（依 `palette` 上色）。

## 專案結構

```
src/
  config.ts        全域數值（物理、戰鬥、AI、道具）
  sim/             純邏輯（無 DOM）：world、fsm、combat、commands、ai、items、projectiles、rng
  input/           鍵盤 → 每 tick 按鍵快照
  render/          Canvas 繪圖：姿勢、角色、場地、特效、HUD
  audio/           Web Audio 合成音效
  scenes/          標題、設定、選角、選模式、戰鬥、結算
  data/            角色 / 道具 / 場地 JSON 與 schema
tests/             Vitest：決定論、指令、戰鬥、資料、AI、闖關
```
