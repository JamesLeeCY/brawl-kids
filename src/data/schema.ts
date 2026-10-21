import { z } from 'zod';

export const SOUND_KEYS = ['hit_light', 'hit_heavy', 'whoosh', 'jump', 'special', 'ko'] as const;
export const SoundKey = z.enum(SOUND_KEYS);
export type SoundKey = z.infer<typeof SoundKey>;

export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type Box = z.infer<typeof BoxSchema>;

/**
 * 增益 / 狀態。前半是給自己（或隊友）的增益，後半是打在對手身上的狀態。
 * - dmgReduce 減傷、blockProjectile 擋飛行物、hover 懸浮、reflect 反彈飛行物、counter 自動防禦並反擊
 * - crit 下一下爆擊、rage 漲停（血少傷害加倍）、power 攻擊力提高、knock 接下來幾拳擊退加倍
 * - mpRegen MP 回復加倍、clone 分身跟著打
 * - reverse 方向顛倒、vuln 受到傷害增加、stun 定身（value = 外觀：1 冰凍、2 鼓掌、3 搖擺、4 颱風）
 * - silence 不能放招、dot 持續扣血（value = 每半秒扣的血）、atkDown 攻擊力疊層降低（每層 value）
 * - charm 策反（攻擊打自己隊友）、mark 質詢倒數（倒數中放招會被取消並受 value 傷害）、bomb 掛號（時間到爆炸 value 傷害）
 */
export const BUFF_TYPES = [
  'dmgReduce',
  'blockProjectile',
  'hover',
  'reflect',
  'counter',
  'crit',
  'rage',
  'power',
  'knock',
  'mpRegen',
  'clone',
  'reverse',
  'vuln',
  'stun',
  'silence',
  'dot',
  'atkDown',
  'charm',
  'mark',
  'bomb',
] as const;

export const BuffSchema = z.object({
  type: z.enum(BUFF_TYPES),
  value: z.number().default(0),
  duration: z.number().int().positive(),
  /** self 只給自己；team 自己和隊友；allies 給隊友（沒有隊友時給自己） */
  to: z.enum(['self', 'team', 'allies']).default('self'),
  /** 可疊加的層數上限（再中一次 +1 層、時間重算） */
  stack: z.number().int().positive().optional(),
  /** 次數制（例如接下來 3 拳），用完就消失 */
  count: z.number().int().positive().optional(),
});
export type BuffDef = z.infer<typeof BuffSchema>;

export const ItrSchema = BoxSchema.extend({
  damage: z.number().min(0),
  fall: z.number().default(0),
  dvx: z.number().default(0),
  dvy: z.number().default(0),
  hitstop: z.number().int().min(0).optional(),
  /** 同一目標可再次命中的間隔 tick */
  rehit: z.number().int().positive().optional(),
  /** 覆寫 z 容差（範圍技） */
  zRange: z.number().positive().optional(),
  /** 擊退方向依目標相對位置決定（向外推） */
  radial: z.boolean().optional(),
  unblockable: z.boolean().optional(),
  /** 命中（沒被擋下）時給目標的狀態 */
  inflict: BuffSchema.optional(),
  /** 命中時扣掉目標的 MP */
  drainMp: z.number().min(0).optional(),
  /** 命中時把目標拉到施放者面前（舌頭勾） */
  pullToOwner: z.boolean().optional(),
  /** 指令投：不能防禦，把目標摔到身後 */
  throw: z.boolean().optional(),
  /** 打到隊友時改成補血 */
  healAlly: z.number().positive().optional(),
  /** 對特定角色的傷害加成（可附喊話） */
  bonusVs: z.object({ char: z.string(), mul: z.number().positive(), say: z.string().optional() }).optional(),
  /** 蓄力加成：傷害 ×（1 + chargeMul × 蓄力秒數） */
  chargeMul: z.number().min(0).optional(),
});
export type Itr = z.infer<typeof ItrSchema>;

export const SpawnSchema = z.object({
  id: z.string(),
  x: z.number().default(20),
  y: z.number().default(30),
  dz: z.number().default(0),
  vx: z.number().default(0),
  vy: z.number().default(0),
  vz: z.number().default(0),
  /** self：角色前方；random：散落在敵人附近或場上隨機位置 */
  at: z.enum(['self', 'random']).default('self'),
  count: z.number().int().positive().default(1),
});
export type SpawnDef = z.infer<typeof SpawnSchema>;


export const FrameSchema = z.object({
  duration: z.number().int().positive(),
  pose: z.string().default('idle_0'),
  /** 下一幀名稱；"idle" 回到中立狀態，"expire" 令飛行物消失 */
  next: z.string().default('idle'),
  itr: z.array(ItrSchema).optional(),
  bdy: z.array(BoxSchema).optional(),
  sound: SoundKey.optional(),
  /** 本幀期間按攻擊，幀結束後改接此幀（連擊） */
  onA: z.string().optional(),
  spawn: z.array(SpawnSchema).optional(),
  selfVel: z
    .object({ vx: z.number().optional(), vy: z.number().optional(), vz: z.number().optional() })
    .optional(),
  hover: z.boolean().optional(),
  friction: z.number().min(0).max(1).optional(),
  invuln: z.boolean().optional(),
  buff: BuffSchema.optional(),
  throwItem: z.boolean().optional(),
  shake: z.boolean().optional(),
  /** 進入本幀時回復 HP */
  heal: z.number().positive().optional(),
  /** 進入本幀時角色頭上冒出的喊話（純畫面效果，例如「辣台妹！」） */
  say: z.string().optional(),
  /** 幀結束時隨機接其中一幀（取代 next） */
  nextRandom: z.array(z.string()).min(2).optional(),
  /** 按住按鍵時停在這一幀蓄力（最多 max tick） */
  hold: z.object({ btn: z.enum(['A', 'J']), max: z.number().int().positive() }).optional(),
  /** 蓄力中每 10 tick 回復的 HP */
  holdHeal: z.number().positive().optional(),
  /** 進入本幀時瞬間移動到最近敵人的背後 */
  teleport: z.enum(['behind']).optional(),
  /** 進入本幀時往最近的敵人跳過去（值為起跳速度） */
  leap: z.number().positive().optional(),
  /** 進入本幀時對範圍內的敵人施加效果 */
  aura: z
    .object({
      radius: z.number().positive(),
      inflict: BuffSchema.optional(),
      drainMp: z.number().min(0).optional(),
      /** 只影響範圍內最近的一個敵人 */
      nearest: z.boolean().default(false),
    })
    .optional(),
  /** 進入本幀時在身邊放出道具（雙方都能撿） */
  items: z
    .array(z.object({ id: z.string(), x: z.number().default(0), y: z.number().default(30), vx: z.number().default(0), vy: z.number().default(0) }))
    .optional(),
  /** 純畫面：角色騎 / 推的道具（bike 單車、youbike、bear 黑熊、cart 菜車、food 試吃） */
  prop: z.string().optional(),
  /** 本幀命中任何人後立刻接這一幀（例如撞到第一個人就停） */
  onHitNext: z.string().optional(),
});
export type FrameDef = z.infer<typeof FrameSchema>;

export const ProjectileSchema = z.object({
  life: z.number().int().positive(),
  size: z.number().positive().default(12),
  gravity: z.number().default(0),
  homing: z.number().min(0).default(0),
  pull: z.number().min(0).default(0),
  pullRadius: z.number().positive().default(100),
  hitLimit: z.number().int().positive().default(1),
  onHit: z.string().optional(),
  onExpire: z.string().optional(),
  blockable: z.boolean().default(true),
  /** 實體牆：擋住敵方飛行物；blockChars 時也擋住敵人走過（w 寬、h 高，跳得過 h 就能越過） */
  wall: z.object({ w: z.number().positive(), h: z.number().positive(), blockChars: z.boolean().default(true) }).optional(),
  /** 落地時往上彈的速度（地上跳著前進的青蛙、小熊） */
  bounce: z.number().min(0).default(0),
  /** 由別的飛行物生出時的初速度（vx 依母體方向） */
  launch: z.object({ vx: z.number().default(0), vy: z.number().default(0) }).optional(),
  startFrame: z.string(),
  frames: z.record(z.string(), FrameSchema),
});
export type ProjectileDef = z.infer<typeof ProjectileSchema>;

export const MoveSchema = z.object({
  command: z.string().regex(/^D[>^v][AJ]$/, '指令格式須為 D>A / D^A / DvA / D>J / D^J / DvJ'),
  name: z.string(),
  mp: z.number().min(0),
  startFrame: z.string(),
  /** 空中也可施放 */
  air: z.boolean().default(false),
  /** AI 用途提示 */
  role: z.enum(['ranged', 'burst', 'buff', 'rush', 'area']).optional(),
  /** 只有 HP 低於這個比例時才能用（例如 0.3） */
  hpBelow: z.number().positive().max(1).optional(),
});
export type MoveDef = z.infer<typeof MoveSchema>;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '顏色須為 #RRGGBB');

export const CharacterSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  title: z.string().default(''),
  selectable: z.boolean().default(true),
  accessory: z.string().default('none'),
  /** 勝利畫面的招牌口頭禪 */
  quote: z.string().default(''),
  /** 口頭禪太長時，結算畫面放不下改用的短版 */
  shortQuote: z.string().optional(),
  /** 被 KO 時頭上冒出的台詞 */
  koQuote: z.string().optional(),
  stats: z.object({
    hp: z.number().positive(),
    walkSpeed: z.number().positive(),
    runSpeed: z.number().positive(),
    jumpPower: z.number().positive(),
    weight: z.number().positive(),
  }),
  palette: z.object({
    skin: Color,
    main: Color,
    accent: Color,
    hair: Color.default('#3b2a1a'),
  }),
  /** 外型特徵（程式繪圖用）：髮型、眼鏡、領帶 */
  look: z
    .object({
      hair: z.enum(['short', 'sidepart', 'neat', 'receding', 'cap', 'none', 'swoop', 'flattop', 'bob']).default('short'),
      glasses: z.boolean().default(false),
      /** 細框圓眼鏡（預設是粗框圓角方形） */
      roundGlasses: z.boolean().default(false),
      beard: z.boolean().default(false),
      /** 無袖（手臂畫成膚色） */
      sleeveless: z.boolean().default(false),
      tie: Color.optional(),
      shirt: Color.default('#f5f5f5'),
    })
    .prefault({}),
  body: BoxSchema.optional(),
  /** 增益效果的專屬外觀（例如 dmgReduce → spicy 火焰辣椒光環）；沒有就用預設的金色光環 */
  buffFx: z.record(z.string(), z.string()).optional(),
  frames: z.record(z.string(), FrameSchema).default({}),
  moves: z.array(MoveSchema).max(6).default([]),
  projectiles: z.record(z.string(), ProjectileSchema).default({}),
});
export type CharacterRaw = z.infer<typeof CharacterSchema>;

export const BaseFramesSchema = z.object({ frames: z.record(z.string(), FrameSchema) });

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['heavy', 'light', 'weapon', 'consumable']),
  color: Color,
  size: z.number().positive(),
  throwDamage: z.number().min(0).default(0),
  throwFall: z.number().default(50),
  swingFrame: z.string().optional(),
  uses: z.number().int().positive().optional(),
  heal: z.object({ hp: z.number().default(0), mp: z.number().default(0) }).optional(),
  bounces: z.number().int().min(0).default(0),
  breakOnLand: z.boolean().default(false),
  /** 隨機掉落的權重，0 表示不隨機掉落 */
  weight: z.number().min(0).default(1),
});
export type ItemDef = z.infer<typeof ItemSchema>;
export const ItemsFileSchema = z.object({ items: z.array(ItemSchema) });

export const StageSchema = z.object({
  id: z.string(),
  name: z.string(),
  width: z.number().min(800),
  theme: z.string(),
  palette: z.object({
    skyTop: Color,
    skyBottom: Color,
    far: Color,
    near: Color,
    ground: Color,
    groundAlt: Color,
    accent: Color,
  }),
  features: z
    .object({
      neon: z.object({ interval: z.number().int().positive() }).optional(),
      pedestrians: z.object({ count: z.number().int().min(0) }).optional(),
      foodSpawn: z
        .object({ interval: z.number().int().positive(), item: z.string(), x: z.array(z.number()).min(1), max: z.number().int().positive().default(2) })
        .optional(),
      bridge: z
        .object({
          interval: z.number().int().positive(),
          duration: z.number().int().positive(),
          x0: z.number(),
          x1: z.number(),
        })
        .optional(),
      train: z
        .object({ interval: z.number().int().positive(), duration: z.number().int().positive(), shake: z.number().min(0) })
        .optional(),
    })
    .prefault({}),
});
export type StageDef = z.infer<typeof StageSchema>;

export const WaveEnemySchema = z.object({
  char: z.string(),
  count: z.number().int().positive().default(1),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  boss: z.boolean().default(false),
});
export const WaveSchema = z.object({ enemies: z.array(WaveEnemySchema).min(1) });
export type WaveDef = z.infer<typeof WaveSchema>;

export const CampaignDifficultySchema = z.object({
  label: z.string(),
  /** 敵人 AI 難度位移：-1 降一級、+1 升一級 */
  aiShift: z.number().int().min(-2).max(2).default(0),
  /** 每種敵人額外多幾隻（頭目除外） */
  extraEnemies: z.number().int().min(0).default(0),
  enemyHpMul: z.number().positive().default(1),
  bossHpMul: z.number().positive().default(2),
});
export type CampaignDifficultyDef = z.infer<typeof CampaignDifficultySchema>;

export const StagesFileSchema = z.object({
  stages: z.array(StageSchema).min(1),
  campaignDifficulty: z.object({
    easy: CampaignDifficultySchema,
    normal: CampaignDifficultySchema,
    hard: CampaignDifficultySchema,
  }),
  campaign: z.array(z.object({ stage: z.string(), waves: z.array(WaveSchema).min(1) })).min(1),
});
