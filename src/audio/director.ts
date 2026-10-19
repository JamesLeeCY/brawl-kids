// 依目前最上層場景決定背景音樂。只讀取畫面與模擬狀態（場地、頭目是否存活、勝負），從不寫入，
// 因此連線對戰不會因音樂而不同步。
import type { NetSession } from '../net/session';
import { BattleScene } from '../scenes/battle';
import { ResultScene } from '../scenes/result';
import type { App } from '../scenes/scene';
import { isAlive, type Entity } from '../sim/entity';
import type { MatchSetup } from '../sim/world';
import type { MusicCue } from './tracks';

export function musicCue(app: App): MusicCue {
  const top = app.scenes.top;
  if (top instanceof BattleScene) {
    const w = top.world;
    let boss = false;
    if (w.waves) for (const e of w.entities) if (e.boss && isAlive(e)) boss = true;
    return { kind: 'battle', stageId: w.stage.id, boss };
  }
  if (top instanceof ResultScene) {
    const r = top as unknown as { winners: Entity[]; net: NetSession | null; setup: MatchSetup };
    const human = (slot: number) => r.setup.players.some((p) => p.slot === slot && p.controller === 'human');
    const won = r.winners.some((c) => (r.net ? c.slot === r.net.mySlot : human(c.slot)));
    return { kind: 'result', won };
  }
  return { kind: 'menu' };
}
