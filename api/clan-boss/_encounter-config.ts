import { pveAiMasteryEnabled, sealPveAiMastery } from '../_pve-ai-mastery.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { sealTeamBossChallengeKit } from '../_boss-challenge-kit.js';
import { initializeTowerTactics } from '../towers/_combat-tactics.js';
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
    // clan-pool slice. New operation starts keep the authored enemy strength;
    // ordinary Tower party discounts never apply to this cooperative encounter.
    sealPveDifficultyBand(session, { mode: 'CLAN_BOSS', scaleHp: false, scaleStats: false });
    // Enemy jutsu use their authored mastery instead of the generic 30% fallback.
    sealPveAiMastery(session, { mode: 'CLAN_BOSS' });
    // Only new operation encounters opt in. The existing role/signature layer
    // adds marked attacks, exposed misses, disruptible pylons and add priority.
    initializeTowerTactics(session);
    for (const [index, actor] of session.actors.filter(a => a.side === 'enemy').entries()) {
        sealTeamBossChallengeKit(actor, actor.id === boss.id, index, pveAiMasteryEnabled('CLAN_BOSS'));
        if (actor.id !== boss.id) actor.character.combatRole = index % 2 ? 'skirmisher' : 'controller';
    }
    return boss;
}
