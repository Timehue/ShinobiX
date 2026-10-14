import { kv } from '../_storage.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { applyAiMasteryToActor } from '../_pve-ai-mastery.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { runAiUntilHuman, startRound } from '../towers/_engine.js';
import { CLAN_BOSS_FLOORS, type TowerFloor } from '../towers/_floor-catalog.js';
import { requireEnemyTemplate, type EnemyTemplate } from '../towers/_enemy-templates.js';
import { makeRng } from '../towers/_sim.js';
import { setTowerInvite, writeSession } from '../towers/_tower-store.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases } from '../towers/_battle-lease.js';
import { findTowerBattleStartConflict } from '../_tower-battle-guard.js';
import { worldBossBattleVisual, worldBossGuardVisual, worldBossCrystalEffects, worldBossDefinition, type WorldBossId } from '../../shared/world-boss-event.js';
import { WORLD_BOSS_MATCH_HP_PER_PLAYER, type WorldBossEventRecord, type WorldBossMatchRecord } from './_event.js';

const WORLD_BOSS_FLOOR_ID = 9_800;

/** Shared-health budget for one sealed fight, scaled to the actual queue size. */
export function worldBossMatchHpForParty(eventHp: number, partySize: number): number {
    const teamSize = Math.max(1, Math.min(3, Math.floor(Number(partySize) || 1)));
    const remainingHp = Math.max(0, Math.floor(Number(eventHp) || 0));
    return Math.max(1, Math.min(remainingHp, 0x7fffffff, WORLD_BOSS_MATCH_HP_PER_PLAYER * teamSize));
}

export function worldBossFloor(bossId: WorldBossId, bossName: string): TowerFloor {
    const source = CLAN_BOSS_FLOORS[3];
    if (!source) throw new Error('World boss encounter base floor is missing.');
    const definition = worldBossDefinition(bossId);
    const defenses = definition.combatTrait === 'regen'
        ? { mechanic: 'regen' as const }
        : definition.combatTrait === 'bulwark'
            ? { mechanic: 'bulwark' as const }
            : { aegis: { shieldPct: 10 } };
    const signatureStrike = definition.combatTrait === 'regen'
        ? { kind: 'nova' as const, pct: 14, radius: 2, everyRounds: 2 }
        : definition.combatTrait === 'bulwark'
            ? { kind: 'slam' as const, pct: 14, radius: 1, everyRounds: 2 }
            : { kind: 'volley' as const, pct: 14, radius: 1, everyRounds: 2 };
    return {
        ...structuredClone(source),
        id: WORLD_BOSS_FLOOR_ID,
        name: `${bossName}: Raid`,
        biome: 'forest',
        objective: 'defeat-boss',
        roundBudget: 18,
        enemies: [{ aiId: 'world-boss-guard', count: 2 }],
        boss: {
            aiId: 'clan-boss-golem',
            phases: [75, 50, 25],
            ...defenses,
            targetMode: 'lowest-hp',
            strike: signatureStrike,
        },
        features: [],
        balanceFor: 3,
        firstClearReward: {},
        chapterTitle: 'World Boss Event',
        chapterSubtitle: 'World Threat · Cooperative Raid',
        chapterSummary: `${bossName} has crossed the highland roads. Hold the line together.`,
        briefing: {
            situation: `${bossName} is cutting a path through the borderlands. Reach your team's raid damage target to drive it back. It is defeated only when its shared world health reaches zero.`,
            tactics: [definition.traitDescription, 'Keep allies standing; verified healing and shielding count toward event contribution.', 'The boss marks the ground before its heavy strike. Reposition before the next round.'],
            warnings: ['The roaming event tracks damage in a separate shared-health pool.', 'The party will contain one, two, or three players depending on the queue.'],
        },
    };
}

/** Sealed event-specific roster. HP scales with the team; attacks retain their threat. */
export function buildWorldBossTeamEncounter(input: {
    event: Pick<WorldBossEventRecord, 'eventId' | 'bossId' | 'bossName' | 'hp' | 'hollowShardsDeposited'>;
    matchId: string;
    squad: SquadMemberInput[];
    runId: string;
    seed: number;
    now: number;
}) {
    const floor = worldBossFloor(input.event.bossId, input.event.bossName);
    const bossTemplate: EnemyTemplate = {
        ...structuredClone(requireEnemyTemplate('clan-boss-golem')),
        name: input.event.bossName,
        visual: worldBossBattleVisual(input.event.bossId),
        armorRawDR: 0.22,
        stats: { taijutsuOffense: 3000, taijutsuDefense: 1550, strength: 1000, speed: 450 },
        jutsu: [{ id: 'world-boss-quake', name: 'Hollow Quake', type: 'Taijutsu', element: 'Earth', ap: 60, range: 4, effectPower: 90, method: 'AOE_BURST' }],
    };
    const guard: EnemyTemplate = {
        ...structuredClone(requireEnemyTemplate('grunt-brute')),
        name: `${input.event.bossName} Broodguard`,
        visual: worldBossGuardVisual(input.event.bossId),
        level: 80,
        hp: 4500,
        stats: { taijutsuOffense: 1800, taijutsuDefense: 1000, strength: 650, speed: 350 },
        jutsu: [{ id: 'world-boss-guard-rush', name: 'Hollow Rush', type: 'Taijutsu', element: 'Earth', ap: 60, range: 2, effectPower: 38, cooldown: 2, tags: [{ name: 'Push', amount: 2 }], aiPriority: 45 }],
    };
    const session = buildTowerEncounter({
        floor, squad: input.squad, runId: input.runId, seed: input.seed,
        partySize: input.squad.length, bossTemplate,
        enemyTemplates: { 'world-boss-guard': guard },
        embedFloor: true, towerId: 'world-boss-event', now: input.now,
    });
    // The world-event entry point bypasses Tower start's mastery seal. Without
    // it these level-80 enemies cast every signature at untrained damage.
    for (const actor of session.actors) if (actor.side === 'enemy') applyAiMasteryToActor(actor);
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId);
    if (!boss) throw new Error('World boss encounter did not create its boss actor.');
    const crystalEffects = worldBossCrystalEffects(input.event.hollowShardsDeposited ?? 0);
    // The shared HP budget already scales for smaller teams. Tower's additional
    // outgoing-damage discount made solo world bosses harmless.
    boss.character.towerDmgScale = crystalEffects.bossDamageDealtMultiplier;
    const matchHp = worldBossMatchHpForParty(input.event.hp, input.squad.length);
    boss.hp = matchHp;
    boss.maxHp = matchHp;
    if (worldBossDefinition(input.event.bossId).combatTrait === 'regen') session.regenFlatCap = Math.max(1, Math.floor(matchHp * 0.01));
    boss.character.name = input.event.bossName;
    session.roundCap = 20;
    session.worldBossEvent = {
        eventId: input.event.eventId, matchId: input.matchId, matchHpAtStart: matchHp,
        bossDamageDealtMultiplier: crystalEffects.bossDamageDealtMultiplier,
        bossDamageReceivedMultiplier: crystalEffects.bossDamageReceivedMultiplier,
    };
    session.worldBossContributions = {};
    return session;
}

/** Build one sealed 1–3 player team encounter from authoritative saves. */
export async function createWorldBossEncounter(input: {
    event: WorldBossEventRecord;
    match: WorldBossMatchRecord;
    expectedSector: number;
    now: number;
}): Promise<{ session: Awaited<ReturnType<typeof buildTowerEncounter>>; leaseMembers: string[] }> {
    const members = input.match.members;
    const slugs = members.map(member => member.slug);
    if (slugs.length < 1 || slugs.length > 3 || new Set(slugs).size !== slugs.length) {
        throw new Error('World boss team size is invalid.');
    }
    if (await findTowerBattleStartConflict(slugs)) throw new Error('One or more players are already in another battle.');

    const proposedRunId = input.match.runId;
    const lease = await claimTowerBattleLeases({ runId: proposedRunId, members: slugs });
    if (!lease.ok) throw new Error('One or more players are already in another battle.');
    try {
        const [admin, saves] = await Promise.all([
            loadAdminCombatContent(),
            kv.mget<Record<string, unknown>[]>(...slugs.map(slug => `save:${slug}`)),
        ]);
        const squad: SquadMemberInput[] = [];
        for (let index = 0; index < members.length; index += 1) {
            const member = members[index]!;
            const record = await augmentSaveWithForgedDefs(saves[index] ?? null);
            const character = record?.character as Record<string, unknown> | undefined;
            if (!record || !character) throw new Error(`${member.name}'s save is unavailable. The queue was released.`);
            if (Math.floor(Number(record.currentSector)) !== input.expectedSector) {
                throw new Error(`${member.name} left the boss's sector before the team formed.`);
            }
            if (isIncapacitated(character)) throw new Error(`${member.name} needs to recover before joining the raid.`);
            const actorId = `sq-${squad.length}`;
            squad.push({
                id: actorId,
                name: String(character.name ?? member.name),
                ownerSlug: member.slug,
                ai: false,
                character: sealTowerFighter(character, record, member.loadout ?? {}, admin),
                itemCharges: sealTowerItemCharges(character),
            });
        }

        const session = buildWorldBossTeamEncounter({
            event: input.event, matchId: input.match.matchId, squad, runId: proposedRunId,
            seed: Number.parseInt(input.match.matchId.slice(0, 8), 16) || input.now,
            now: input.now,
        });
        const floor = session.encounterFloor!;
        startRound(session);
        runAiUntilHuman(session, floor, makeRng(session.seed));
        stampTurnClock(session, input.now);
        await writeSession(session);
        for (const slug of slugs) await setTowerInvite(slug, proposedRunId).catch(() => undefined);
        return { session, leaseMembers: slugs };
    } catch (error) {
        await releaseTowerBattleLeases(proposedRunId, slugs).catch(() => undefined);
        throw error;
    }
}
