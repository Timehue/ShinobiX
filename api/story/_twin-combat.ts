import { storyTwinTrial } from '../../shared/story-twin-trials.js';
import { resolveAiProfileJutsu, withPveGapClosingJutsu, type AiOpponentJutsu } from '../_ai-opponent-loadout.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { projectHuntCombat } from '../solo-pve/_hunt-combat.js';
import { createTowerSession, type TowerActor } from '../towers/_tower-session.js';
import { runAiUntilHuman, startRound } from '../towers/_engine.js';
import { makeRng } from '../towers/_sim.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { combatFormationPositions } from '../combat-core/spawns.js';
import { pveAiItemCharges, distributePveAiItems } from '../combat-core/ai-items.js';

/** Reuse the existing embedded multi-actor engine and Solo-PvE lifecycle.
 * The legacy huntCombat field is also used by these two authored pair trials;
 * its purpose marker prevents hunt-specific presentation from leaking through. */
export function attachStoryTwinCombat(session: SoloPveSession): void {
    const twins = storyTwinTrial(session.encounter.sourceId ?? '');
    if (!twins || session.encounter.kind !== 'story-boss') return;
    const spawns = combatFormationPositions(session.sessionId, { allies: [62], enemies: [45, 81], blockedTiles: session.environment.blockedTiles });
    const player: TowerActor = { ...structuredClone(session.player), id: 'player', side: 'squad', ownerSlug: session.ownerSlug,
        ai: false, pos: spawns.allies[0]!, cooldowns: {}, itemCharges: { ...session.itemCharges }, itemsUsed: {} };
    const base = session.enemy;
    const stats = base.character.stats as Record<string, number>;
    const primary = String(base.character.specialty).toLowerCase();
    const offense = Number(stats[`${primary}Offense`]) || 1000;
    const defense = Number(stats[`${primary}Defense`]) || 800;
    const bladeHp = Math.floor(base.maxHp * .55);
    const enemies = twins.map((twin, index): TowerActor => {
        const jutsu = withPveGapClosingJutsu(resolveAiProfileJutsu([...twin.jutsuIds]).map((move, i) => ({ ...move,
            name: twin.moveNames[i], battleDescription: twin.descriptions[i] })), (base.character.jutsu ?? []) as AiOpponentJutsu[]);
        const twinStats = { ...stats };
        // Two turns now exert pressure each round. Split the old total HP and
        // reduce each fighter's offense, instead of duplicating a full boss.
        for (const school of ['ninjutsu', 'taijutsu', 'bukijutsu', 'genjutsu']) {
            twinStats[`${school}Offense`] = Math.floor(offense * .65);
            twinStats[`${school}Defense`] = Math.floor(defense * .8);
        }
        const hp = index === 0 ? bladeHp : base.maxHp - bladeHp;
        return { ...structuredClone(base), id: twin.id, side: 'enemy', ownerSlug: null, ai: true,
            name: twin.name, hp, maxHp: hp, pos: spawns.enemies[index]!, cooldowns: {}, itemCharges: pveAiItemCharges(base.character), itemsUsed: {},
            character: { ...structuredClone(base.character), name: twin.name, visual: twin.id, avatarImage: twin.art,
                specialty: twin.specialty, stats: twinStats, jutsu, jutsuMastery: jutsu.map(move => ({ jutsuId: move.id, level: 0 })),
                aiRole: index === 0 ? 'skirmisher' : 'controller', storyTwin: true },
        };
    });
    const floor: TowerFloor = { id: 50, name: base.name, biome: session.environment.biome as TowerFloor['biome'],
        objective: 'defeat-all', roundBudget: 30, map: { width: 12, height: 10 }, fieldRule: { kind: 'none' },
        enemies: [], firstClearReward: {}, balanceFor: 1,
        briefing: { situation: 'Both twins fight at once, each with their own health, turns and techniques.',
            tactics: ['Defeat both twins to pass the trial.', 'Select either twin on the field to target them. The surviving twin keeps fighting.'], warnings: ['Two independent opponents'] } };
    distributePveAiItems(enemies, pveAiItemCharges(base.character));
    const battle = createTowerSession({ towerId: 'story-twin-trial', runId: session.sessionId, floor: 50,
        seed: 50, partySize: 1, now: session.createdAt, actors: [player, ...enemies],
        map: { ...floor.map, biome: floor.biome, blockedTiles: [...session.environment.blockedTiles], hazardTiles: [], objectiveTiles: [] },
        objectiveKind: 'defeat-all' });
    battle.encounterFloor = floor;
    battle.floorProvenance = { kind: 'embedded', mintedBy: 'authoritative-pve', contentVersion: 'story-twins.1', floorId: 50 };
    if (session.pendingCompanion) battle.pendingCompanion = structuredClone(session.pendingCompanion);
    if (session.difficultyGuard) battle.pveGuard = { enemyLevel: session.difficultyGuard.enemyLevel, turnStartHp: {}, dealtThisTurn: {} };
    battle.weather = { positiveElement: session.environment.weatherPositiveElement, negativeElement: session.environment.weatherNegativeElement };
    session.huntCombat = { purpose: 'story-twins', formation: { version: 1, kind: 'pack', count: 2 }, battle };
    battle.log.push(`${twins[0].name} and ${twins[1].name} enter the trial. Defeat both to win.`);
    // The embedded scheduler queues the squad before enemies, so the player
    // is primed first without changing the queue after turn-start effects.
    startRound(battle);
    // Preserve sealed vitals: opening the screen must not refill resources.
    player.chakra = session.player.chakra;
    player.stamina = session.player.stamina;
    runAiUntilHuman(battle, floor, makeRng(battle.seed));
    projectHuntCombat(session);
}
