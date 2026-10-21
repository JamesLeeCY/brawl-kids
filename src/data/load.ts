// 資料載入與驗證：純函式，不依賴瀏覽器，測試可直接呼叫。
import type { ZodError } from 'zod';
import {
  BaseFramesSchema,
  CharacterSchema,
  ItemsFileSchema,
  StagesFileSchema,
  type CampaignDifficultyDef,
  type CharacterRaw,
  type FrameDef,
  type ItemDef,
  type ProjectileDef,
  type StageDef,
  type WaveDef,
} from './schema';

export interface RawFile {
  path: string;
  json: unknown;
}

export interface CharacterDef extends CharacterRaw {
  /** 共用基本幀 + 角色自訂幀（同名時角色覆寫） */
  frames: Record<string, FrameDef>;
}

export interface GameData {
  characters: Record<string, CharacterDef>;
  /** 可在選角畫面選擇的角色 id（依檔名排序） */
  selectable: string[];
  /** 鍵為 `${角色id}.${飛行物id}` */
  projectiles: Record<string, ProjectileDef>;
  items: Record<string, ItemDef>;
  itemOrder: string[];
  stages: Record<string, StageDef>;
  stageOrder: string[];
  campaign: { stage: string; waves: WaveDef[] }[];
  campaignDifficulty: Record<'easy' | 'normal' | 'hard', CampaignDifficultyDef>;
  errors: string[];
}

const RESERVED_NEXT = new Set(['idle', 'expire']);

function zodErrors(path: string, err: ZodError): string[] {
  return err.issues.map((i) => `${path}: 欄位 ${i.path.join('.') || '(root)'} — ${i.message}`);
}

export function loadGameData(input: {
  characters: RawFile[];
  baseFrames: RawFile;
  items: RawFile;
  stages: RawFile;
}): GameData {
  const errors: string[] = [];
  const data: GameData = {
    characters: {},
    selectable: [],
    projectiles: {},
    items: {},
    itemOrder: [],
    stages: {},
    stageOrder: [],
    campaign: [],
    campaignDifficulty: {
      easy: { label: '簡單', aiShift: -1, extraEnemies: 0, enemyHpMul: 0.8, bossHpMul: 1.5 },
      normal: { label: '普通', aiShift: 0, extraEnemies: 0, enemyHpMul: 1, bossHpMul: 2 },
      hard: { label: '困難', aiShift: 1, extraEnemies: 1, enemyHpMul: 1.3, bossHpMul: 2.5 },
    },
    errors,
  };

  const base = BaseFramesSchema.safeParse(input.baseFrames.json);
  const baseFrames: Record<string, FrameDef> = base.success ? base.data.frames : {};
  if (!base.success) errors.push(...zodErrors(input.baseFrames.path, base.error));

  const items = ItemsFileSchema.safeParse(input.items.json);
  if (items.success) {
    for (const it of items.data.items) {
      data.items[it.id] = it;
      data.itemOrder.push(it.id);
    }
  } else errors.push(...zodErrors(input.items.path, items.error));

  const stages = StagesFileSchema.safeParse(input.stages.json);
  if (stages.success) {
    for (const s of stages.data.stages) {
      data.stages[s.id] = s;
      data.stageOrder.push(s.id);
    }
    data.campaign = stages.data.campaign;
    data.campaignDifficulty = stages.data.campaignDifficulty;
  } else errors.push(...zodErrors(input.stages.path, stages.error));

  const files = [...input.characters].sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const res = CharacterSchema.safeParse(file.json);
    if (!res.success) {
      errors.push(...zodErrors(file.path, res.error));
      continue;
    }
    const raw = res.data;
    if (data.characters[raw.id]) {
      errors.push(`${file.path}: 欄位 id — 角色 id "${raw.id}" 重複`);
      continue;
    }
    const def: CharacterDef = { ...raw, frames: { ...baseFrames, ...raw.frames } };
    const refErrors = validateCharacterRefs(def, data.items);
    if (refErrors.length) {
      errors.push(...refErrors.map((e) => `${file.path}: ${e}`));
      continue;
    }
    data.characters[def.id] = def;
    if (def.selectable) data.selectable.push(def.id);
    for (const [pid, p] of Object.entries(def.projectiles)) data.projectiles[`${def.id}.${pid}`] = p;
  }

  // 闖關與道具交叉檢查
  for (const [i, c] of data.campaign.entries()) {
    if (!data.stages[c.stage]) errors.push(`stages.json: 欄位 campaign.${i}.stage — 找不到場地 "${c.stage}"`);
    for (const [wi, w] of c.waves.entries())
      for (const en of w.enemies)
        if (en.char !== 'random_main' && !data.characters[en.char])
          errors.push(`stages.json: 欄位 campaign.${i}.waves.${wi} — 找不到角色 "${en.char}"`);
  }
  for (const s of Object.values(data.stages)) {
    const food = s.features.foodSpawn;
    if (food && !data.items[food.item]) errors.push(`stages.json: 欄位 ${s.id}.features.foodSpawn.item — 找不到道具 "${food.item}"`);
  }

  return data;
}

export function validateCharacterRefs(def: CharacterDef, items: Record<string, ItemDef>): string[] {
  const errs: string[] = [];
  const checkFrames = (frames: Record<string, FrameDef>, where: string) => {
    for (const [name, f] of Object.entries(frames)) {
      if (!RESERVED_NEXT.has(f.next) && !frames[f.next]) errs.push(`欄位 ${where}${name}.next — 幀 "${f.next}" 不存在`);
      if (f.onA && !frames[f.onA]) errs.push(`欄位 ${where}${name}.onA — 幀 "${f.onA}" 不存在`);
      for (const s of f.spawn ?? [])
        if (!def.projectiles[s.id]) errs.push(`欄位 ${where}${name}.spawn — 飛行物 "${s.id}" 不存在`);
      for (const n of [...(f.nextRandom ?? []), ...(f.onHitNext ? [f.onHitNext] : [])])
        if (!frames[n]) errs.push(`欄位 ${where}${name} — 接續的幀 "${n}" 不存在`);
      for (const it of f.items ?? []) if (!items[it.id]) errs.push(`欄位 ${where}${name}.items — 道具 "${it.id}" 不存在`);
    }
  };
  checkFrames(def.frames, 'frames.');
  for (const [pid, p] of Object.entries(def.projectiles)) {
    checkFrames(p.frames, `projectiles.${pid}.frames.`);
    if (!p.frames[p.startFrame]) errs.push(`欄位 projectiles.${pid}.startFrame — 幀 "${p.startFrame}" 不存在`);
    for (const k of ['onHit', 'onExpire'] as const) {
      const ref = p[k];
      if (ref && !def.projectiles[ref]) errs.push(`欄位 projectiles.${pid}.${k} — 飛行物 "${ref}" 不存在`);
    }
  }
  for (const [i, m] of def.moves.entries())
    if (!def.frames[m.startFrame]) errs.push(`欄位 moves.${i}.startFrame — 幀 "${m.startFrame}" 不存在`);
  for (const it of Object.values(items))
    if (it.swingFrame && !def.frames[it.swingFrame]) errs.push(`道具 ${it.id} 的 swingFrame "${it.swingFrame}" 不存在`);
  for (const req of ['punch_1', 'run_attack', 'jump_attack', 'throw'])
    if (!def.frames[req]) errs.push(`欄位 frames.${req} — 缺少必要的基本幀`);
  return errs;
}
