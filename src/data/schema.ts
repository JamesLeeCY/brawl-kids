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

export const BuffSchema = z.object({
  type: z.enum(['dmgReduce', 'blockProjectile', 'hover']),
  value: z.number().default(0),
  duration: z.number().int().positive(),
});
export type BuffDef = z.infer<typeof BuffSchema>;

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
  startFrame: z.string(),
  frames: z.record(FrameSchema),
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
});
export type MoveDef = z.infer<typeof MoveSchema>;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '顏色須為 #RRGGBB');

export const CharacterSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  title: z.string().default(''),
  selectable: z.boolean().default(true),
  accessory: z.string().default('none'),
  quote: z.string().default(''),
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
      hair: z.enum(['short', 'sidepart', 'neat', 'receding', 'none']).default('short'),
      glasses: z.boolean().default(false),
      tie: Color.optional(),
      shirt: Color.default('#f5f5f5'),
    })
    .default({}),
  body: BoxSchema.optional(),
  frames: z.record(FrameSchema).default({}),
  moves: z.array(MoveSchema).max(6).default([]),
  projectiles: z.record(ProjectileSchema).default({}),
});
export type CharacterRaw = z.infer<typeof CharacterSchema>;

export const BaseFramesSchema = z.object({ frames: z.record(FrameSchema) });

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
    .default({}),
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
