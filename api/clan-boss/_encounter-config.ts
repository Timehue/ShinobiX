import { pveAiMasteryEnabled, sealPveAiMastery } from '../_pve-ai-mastery.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { sealTeamBossChallengeKit } from '../_boss-challenge-kit.js';
import { initializeTowerTactics } from '../towers/_combat-tactics.js';
import { MAX_ROUNDS } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { getActor, type TowerActor, type TowerSession } from '../towers/_tower-session.js';

/** Apply the operation-only invariants after the shared encounter builder. */
export function configureClanBossEncounter(session: TowerSession, floor: TowerFloor, bossHp: number, receipt?: { rulesVersion?: 1 | 2; poolAtStart?: number; poolMax?: number }): TowerActor {
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
    // clan-pool slice. The shared builder has already applied the sealed rules'
    // party scaling: legacy discounts or version-two authored enemy strength.
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
    if (receipt?.rulesVersion === 2) {
        session.clanBossGuard = { version: 2, bossId: boss.id, round: 0, openThroughRound: 0,
            contributors: [], openings: {}, sharedHp: { remainingAtStart: receipt.poolAtStart ?? bossHp,
                poolMax: Math.max(1, receipt.poolMax ?? bossHp), assaultHp: bossHp } };
        session.log.push('Boss phases follow the shared HP snapshot sealed at assault start; concurrent assaults bank separately.');
    }
    return boss;
}
