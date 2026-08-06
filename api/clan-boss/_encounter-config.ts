import { sealPveAiMastery } from '../_pve-ai-mastery.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { MAX_ROUNDS } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { getActor, type TowerActor, type TowerSession } from '../towers/_tower-session.js';

/** Apply the operation-only invariants after the shared encounter builder. */
export function configureClanBossEncounter(session: TowerSession, floor: TowerFloor, bossHp: number): TowerActor {
    const bossId = session.phaseState.bossId;
    const boss = bossId ? getActor(session, bossId) : undefined;
    if (!boss) throw new Error(`Clan Boss floor ${floor.id} did not create a boss actor.`);
    const boundedBossHp = Math.max(1, Math.floor(Number(bossHp) || 1));
    boss.hp = boundedBossHp;
    boss.maxHp = boundedBossHp;

    // The authored operation budget is a real deadline. Ordinary story floors
    // keep their existing global cap; this seal is applied only by Clan Boss.
    session.roundCap = Math.max(1, Math.min(MAX_ROUNDS, Math.floor(floor.roundBudget)));

    // Guard only—no level-keyed HP/stat band. Boss vitality is the persistent
    // clan-pool slice, and the shared builder already scaled adds/outgoing damage.
    sealPveDifficultyBand(session, { mode: 'CLAN_BOSS', scaleHp: false, scaleStats: false });
    // Enemy jutsu use their authored mastery instead of the generic 30% fallback.
    sealPveAiMastery(session, { mode: 'CLAN_BOSS' });
    return boss;
}
