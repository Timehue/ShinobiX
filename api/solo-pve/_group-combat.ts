import { narrativeGroupFor } from '../../shared/narrative-groups.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { SoloPveSession } from './_session.js';
import { projectHuntCombat } from './_hunt-combat.js';
import { createTowerSession, type TowerActor } from '../towers/_tower-session.js';
import { runAiUntilHuman, startRound } from '../towers/_engine.js';
import { makeRng } from '../towers/_sim.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { narrativeEnemyIdentity } from '../../shared/narrative-enemy-identity.js';

/** An additive embedded battlefield: the original solo record still owns auth,
 * action receipts, expiry, inventory costs and its mode's existing reward. */
export function attachNarrativeGroupCombat(session: SoloPveSession, profileId: string, variant?: unknown): void {
    const group = narrativeGroupFor(profileId, variant, session.enemy.name);
    if (!group || session.huntCombat) return;
    const occupied = new Set(session.environment.blockedTiles);
    const enemySpawns = [44, 92, 20, 18, 42, 66, 90, 114, 22, 46, 70, 94, 118];
    const spawn = (preferred: number, enemy = false) => {
        const candidates = [preferred, ...(enemy ? enemySpawns : []), ...Array.from({ length: 120 }, (_, i) => i).filter(i => !enemy || i % 12 >= 6)];
        const tile = candidates.find(i => !occupied.has(i));
        if (tile === undefined) throw new Error('The encounter has no free spawn tiles.');
        occupied.add(tile); return tile;
    };
    const player: TowerActor = { ...structuredClone(session.player), id: 'player', side: 'squad', ownerSlug: session.ownerSlug,
        ai: false, pos: spawn(62), cooldowns: {}, itemCharges: { ...session.itemCharges }, itemsUsed: {} };
    const base = session.enemy;
    const stats = base.character.stats as Record<string, number>;
    const specialty = String(base.character.specialty).toLowerCase();
    const offense = Number(stats[`${specialty}Offense`]) || 1000;
    const defense = Number(stats[`${specialty}Defense`]) || 800;
    const totalWeight = group.members.reduce((n, m) => n + m.weight, 0);
    let remainingHp = base.maxHp;
    const enemies = group.members.map((member, i): TowerActor => {
        const identity = narrativeEnemyIdentity(member.visual);
        const jutsu = resolveAiProfileJutsu(member.jutsuIds).map((j, index) => ({ ...j,
            ...(identity?.moveNames?.[index] ? { name: identity.moveNames[index] } : {}),
            ...(identity?.moveDescriptions?.[index] ? { battleDescription: identity.moveDescriptions[index] } : {}) }));
        const memberStats = { ...stats };
        // Share the previous encounter's health and offensive pressure across
        // actual bodies. Never duplicate a full-strength boss for each guard.
        for (const school of ['ninjutsu', 'taijutsu', 'bukijutsu', 'genjutsu']) {
            memberStats[`${school}Offense`] = Math.max(1, Math.floor(offense * 1.3 * member.weight / totalWeight));
            memberStats[`${school}Defense`] = Math.max(1, Math.floor(defense * .8));
        }
        const hp = i === group.members.length - 1 ? remainingHp : Math.max(1, Math.floor(base.maxHp * member.weight / totalWeight));
        remainingHp -= hp;
        return { ...structuredClone(base), id: member.id, name: member.name, side: 'enemy', ownerSlug: null, ai: true,
            hp, maxHp: hp, pos: spawn(enemySpawns[i] ?? 57, true), cooldowns: {},
            character: { ...structuredClone(base.character), name: member.name, visual: member.visual, avatarImage: member.portrait,
                specialty: member.specialty, stats: memberStats, jutsu, jutsuMastery: jutsu.map(j => ({ jutsuId: j.id, level: 0 })),
                aiRules: [], missionTactics: false, boss: false,
                tacticalTell: 'Each opponent has separate health and takes their own turn. Defeat every member of this group to win.',
                // Existing resolver and damage previews both consume this sealed
                // outgoing factor. HP, turns and catalog effects stay independent.
                towerDmgScale: group.damageScale ?? 1,
                aiRole: member.specialty === 'Genjutsu' ? 'controller' : 'skirmisher' } };
    });
    const floor: TowerFloor = { id: Number(base.character.level) || 1, name: group.name ?? base.name,
        biome: session.environment.biome as TowerFloor['biome'], objective: 'defeat-all', roundBudget: 30,
        map: { width: 12, height: 10 }, fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {}, balanceFor: 1,
        briefing: { situation: `${enemies.length} opponents fight together, each with their own health and turn.`,
            tactics: ['Select any opponent to target them. Defeat every opponent to win.'], warnings: [] } };
    const battle = createTowerSession({ towerId: 'narrative-group', runId: session.sessionId, floor: floor.id, seed: floor.id,
        partySize: 1, now: session.createdAt, actors: [player, ...enemies], objectiveKind: 'defeat-all',
        map: { ...floor.map, biome: floor.biome, blockedTiles: [...session.environment.blockedTiles], hazardTiles: [], objectiveTiles: [] } });
    battle.encounterFloor = floor;
    battle.floorProvenance = { kind: 'embedded', mintedBy: 'authoritative-pve', contentVersion: 'narrative-groups.2', floorId: floor.id };
    if (session.pendingCompanion) battle.pendingCompanion = structuredClone(session.pendingCompanion);
    if (session.difficultyGuard) battle.pveGuard = { enemyLevel: session.difficultyGuard.enemyLevel, turnStartHp: {}, dealtThisTurn: {} };
    battle.weather = { positiveElement: session.environment.weatherPositiveElement, negativeElement: session.environment.weatherNegativeElement };
    session.huntCombat = { purpose: 'narrative-group', groupId: group.id, requiredEnemyIds: enemies.map(a => a.id),
        formation: { version: 1, kind: 'pack', count: enemies.length }, battle };
    battle.log.push(`${floor.name}: ${enemies.map(a => a.name).join(', ')}. Defeat every opponent to win.`);
    startRound(battle);
    player.chakra = session.player.chakra; player.stamina = session.player.stamina;
    runAiUntilHuman(battle, floor, makeRng(battle.seed));
    projectHuntCombat(session);
}
