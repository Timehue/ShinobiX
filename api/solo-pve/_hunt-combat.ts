import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';
import type { HuntCombatAction, HuntFormation } from '../../shared/hunt-combat.js';
import { huntHash } from '../missions/_hunt-trail.js';
import type { PvpFighter } from '../pvp/session.js';
import type { SoloPveAction, SoloPveActionResult, SoloPveSession } from './_session.js';
import { createTowerSession, activeActor, type TowerActor, type TowerSession } from '../towers/_tower-session.js';
import { applyAction, checkTowerWinner, endTurn, humanHasTowerAction, runAiUntilHuman, startRound, type TowerAction } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { makeRng } from '../towers/_sim.js';
import { huntMissionById } from '../missions/_mission-catalog.js';
import { HUNT_AI_POLICY, HUNT_REACTIVE_POLICY } from '../towers/_hunt-ai.js';
import { pveEasyBandHoldsBurst, pveDifficultyBand } from '../_pve-difficulty.js';
import { combatFormationPositions } from '../combat-core/spawns.js';
import { pveAiItemCharges } from '../combat-core/ai-items.js';
import { isDamagingAiGapCloser, isAiFlicker } from '../combat-core/ai-mobility.js';
import type { CombatJutsu } from '../combat-core/types.js';

export type HuntCombatState = {
    purpose?: 'story-twins' | 'narrative-group';
    groupId?: string;
    requiredEnemyIds?: string[];
    formation: Omit<HuntFormation, 'count'> & { count: number };
    battle: TowerSession;
    usedJutsuIds?: string[];
};

function fighterActor(fighter: PvpFighter, id: string, ownerSlug: string | null, pos: number): TowerActor {
    return { ...structuredClone(fighter), id, side: ownerSlug ? 'squad' : 'enemy', ownerSlug, ai: !ownerSlug, pos, cooldowns: {} };
}

/** The Tower record is the combat authority. The outer fight record owns the
 * existing authenticated lifecycle, move receipts, expiry and hunt settlement. */
export function attachHuntCombat(session: SoloPveSession, context: WorldAiFightContext): void {
    const formation = context.huntFormation;
    if (!formation || !context.huntRunId || (context.kind !== 'hunt-pack' && context.kind !== 'hunt-target')) return;
    const spawns = combatFormationPositions(session.sessionId, { allies: [62], enemies: [33, 57, 81].slice(0, formation.count), blockedTiles: session.environment.blockedTiles });
    const player = fighterActor(session.player, 'player', session.ownerSlug, spawns.allies[0]!);
    const requirement = huntMissionById(context.missionId ?? context.sourceId)?.levelReq ?? 1;
    const rank = requirement >= 70 ? 'S' : requirement >= 50 ? 'A' : requirement >= 30 ? 'B' : requirement >= 15 ? 'C' : 'D';
    // Simultaneous easy-band packs already chain several enemy turns. Preserve
    // their original chooser instead of compounding the onboarding pressure.
    const tacticalHunt = formation.kind !== 'pack' || pveDifficultyBand(Number(session.enemy.character.level)) !== 'easy';
    const reactiveHunt = tacticalHunt && formation.kind === 'single' && rank !== 'D'
        && Number(player.character.level) > 15 && Number(session.enemy.character.level) > 15
        && pveDifficultyBand(Number(session.enemy.character.level)) === 'easy';
    player.itemCharges = { ...session.itemCharges };
    const enemies = Array.from({ length: formation.count }, (_, index) => {
        const actor = fighterActor(session.enemy, `hunt-enemy-${index}`, null, spawns.enemies[index]!);
        actor.itemCharges = pveAiItemCharges(actor.character);
        // Every creature keeps the encounter's full HP, so a pack costs as much
        // effort as the three fights it replaces. Only a simultaneous pack trims
        // offensive strength, because all members can act in the same round.
        if (formation.kind === 'pack') {
            const stats = actor.character.stats as Record<string, number>;
            actor.character.stats = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Math.max(1, Math.floor(value / Math.sqrt(formation.count)))]));
        }
        const target = context.kind === 'hunt-target' && index === formation.count - 1;
        actor.name = target || formation.count === 1 ? session.enemy.name : `${session.enemy.name} ${index + 1}`;
        actor.character.name = actor.name;
        actor.character.huntContractTarget = target;
        if (tacticalHunt) actor.character.huntAiPolicy = HUNT_AI_POLICY;
        else delete actor.character.huntAiPolicy;
        actor.character.huntRank = rank;
        if (reactiveHunt) actor.character.huntReactivePolicy = HUNT_REACTIVE_POLICY;
        else delete actor.character.huntReactivePolicy;
        return actor;
    });
    const label = formation.kind === 'single' ? 'Lone creature'
        : formation.kind === 'waves' ? `${formation.count} creatures in succession` : `${formation.count} creatures together`;
    const floor: TowerFloor = {
        id: 9501, name: `${session.enemy.name} · ${label}`, biome: session.environment.biome as TowerFloor['biome'],
        objective: 'defeat-all', roundBudget: 30, map: { width: 12, height: 10 },
        fieldRule: { kind: 'none' }, enemies: [], firstClearReward: {}, balanceFor: 1,
        briefing: { situation: label, tactics: [formation.kind === 'waves' ? 'Defeat each creature to bring the next onto the field.' : 'Defeat every creature to finish this encounter.'], warnings: [] },
    };
    const battle = createTowerSession({ towerId: 'hunt', runId: session.sessionId, floor: floor.id,
        seed: huntHash(`${context.huntRunId}:${context.decisionId ?? 'target'}`), partySize: 1, now: session.createdAt,
        actors: [player, ...(formation.kind === 'waves' ? enemies.slice(0, 1) : enemies)],
        map: { ...floor.map, biome: floor.biome, blockedTiles: [...session.environment.blockedTiles], hazardTiles: [], objectiveTiles: [] },
        objectiveKind: floor.objective });
    battle.encounterFloor = floor;
    battle.floorProvenance = { kind: 'embedded', mintedBy: 'authoritative-pve', contentVersion: 'hunt.1', floorId: floor.id };
    if (formation.kind === 'waves') battle.pendingEnemyWaves = enemies.slice(1).map(actor => ({ round: 1, afterClear: true, actors: [actor] }));
    if (session.pendingCompanion) battle.pendingCompanion = structuredClone(session.pendingCompanion);
    if (session.difficultyGuard) battle.pveGuard = { enemyLevel: session.difficultyGuard.enemyLevel, turnStartHp: {}, dealtThisTurn: {} };
    battle.weather = { positiveElement: session.environment.weatherPositiveElement, negativeElement: session.environment.weatherNegativeElement };
    battle.log.push(`${label}: ${session.enemy.name}.`);
    const heavyRound = !pveEasyBandHoldsBurst(Number(session.enemy.character.level), 1) ? 1 : 3;
    const hasFlicker = enemies.some(enemy => (enemy.character.jutsu as CombatJutsu[]).some(isAiFlicker));
    if (hasFlicker) battle.log.push('Flicker can close the gap and enable follow-up attacks during the opening round.');
    if(tacticalHunt&&pveDifficultyBand(Number(session.enemy.character.level))==='easy' && !hasFlicker)
        battle.log.push('The creature spends the opening round approaching and preparing. Basic attacks begin on round 2.');
    battle.log.push(`${rank}-rank hunt: watch for afflictions and gap-closing techniques. Heavy techniques begin on round ${heavyRound}${hasFlicker ? ', or earlier after Flicker' : ''}. Cleanse removes afflictions; Clear strips active defenses.`);
    if (enemies.some(enemy => (enemy.character.jutsu as CombatJutsu[]).some(isDamagingAiGapCloser)))
        battle.log.push('Gap-closing movement strikes can hit during the opening approach from long range.');
    if (reactiveHunt) battle.log.push('Wounded retaliation: this lone creature can use heavy techniques from round 2 at 75% HP or below. Use defensive techniques to blunt the response or create distance before wounding it.');
    session.huntCombat = { formation, battle };
    startRound(battle);
    // The encounter already sealed the player's current resources. Tower turn
    // priming must not grant an extra refill just for opening a hunt screen.
    player.chakra = session.player.chakra;
    player.stamina = session.player.stamina;
    runAiUntilHuman(battle, floor, makeRng(battle.seed));
    projectHuntCombat(session);
}

function projectedFighter(actor: TowerActor, previous: PvpFighter): PvpFighter {
    const { hp, maxHp, chakra, maxChakra, stamina, maxStamina, shield, statuses, pos, character } = actor;
    return { ...previous, hp, maxHp, chakra, maxChakra, stamina, maxStamina, shield, statuses, pos, character };
}

export function projectHuntCombat(session: SoloPveSession): void {
    const battle = session.huntCombat!.battle;
    const player = battle.actors.find(actor => actor.id === 'player')!;
    const enemies = [...battle.actors, ...(battle.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)].filter(actor => actor.side === 'enemy');
    const target = enemies.find(actor => actor.character.huntContractTarget === true) ?? enemies[0]!;
    session.player = projectedFighter(player, session.player);
    session.enemy = projectedFighter(target, session.enemy);
    session.itemsUsed = { ...player.itemsUsed };
    session.itemCharges = { ...player.itemCharges };
    session.round = battle.round;
    session.activeSide = activeActor(battle)?.side === 'enemy' ? 'enemy' : 'player';
    session.ap[session.activeSide] = battle.activeAp;
    session.actionsThisTurn = battle.actionsThisTurn;
    session.log = [...battle.log];
    session.status = battle.status;
    session.winner = battle.winner === 'squad' ? 'player' : battle.winner === 'enemy' ? 'enemy' : battle.winner === 'draw' ? 'draw' : null;
    if (battle.status === 'done') session.outcome = session.outcome === 'fled' ? 'fled' : session.winner === 'player' ? 'win' : session.winner === 'draw' ? 'draw' : 'loss';
}

export function applyHuntCombatAction(source: SoloPveSession, command: SoloPveAction, opts: { escapeSucceeds?: () => boolean }): SoloPveActionResult {
    if (source.status !== 'active') return { applied: false, reason: 'session-done', session: source };
    if (command.type !== 'huntAction' && command.type !== 'abandon' && command.type !== 'flee') {
        return { applied: false, reason: 'hunt-action-required', session: source };
    }
    const session = structuredClone(source);
    const battle = session.huntCombat!.battle;
    const floor = battle.encounterFloor!;
    const player = battle.actors.find(actor => actor.id === 'player')!;
    const intent: HuntCombatAction | { type: 'abandon' } = command.type === 'huntAction' ? command.action : command;
    const rng = makeRng(huntHash(`${battle.seed}:${session.version}`));
    if (intent.type === 'abandon' || intent.type === 'flee') {
        if (intent.type === 'flee' && (activeActor(battle)?.id !== player.id || battle.activeAp < 100)) return { applied: false, reason: 'cannot-act', session: source };
        const cost = Math.max(1, Math.floor(player.maxHp * .1));
        const lostHp = Math.min(player.hp, cost);
        player.hp = Math.max(0, player.hp - cost);
        if (intent.type === 'abandon' || opts.escapeSucceeds?.() === true || player.hp === 0) {
            battle.status = 'done'; battle.winner = 'enemy'; battle.objectiveState.failed = true;
            session.outcome = intent.type === 'flee' && player.hp > 0 ? 'fled' : 'loss';
            battle.log.push(`${player.name} leaves the ${session.huntCombat?.purpose === 'story-twins' ? 'trial' : session.huntCombat?.purpose === 'narrative-group' ? 'encounter' : 'hunt'}, losing ${lostHp} HP.`);
        } else {
            battle.log.push(`${player.name} fails to escape and loses ${lostHp} HP.`);
            endTurn(battle, floor);
            runAiUntilHuman(battle, floor, rng);
        }
    } else {
        if (activeActor(battle)?.id !== player.id) return { applied: false, reason: 'not-your-turn', session: source };
        const companion = battle.pendingCompanion;
        const result = applyAction(battle, floor, { ...intent, actorId: player.id } as TowerAction, rng);
        if (!result.applied) return { ...result, session: source };
        if (intent.type === 'jutsu') session.huntCombat!.usedJutsuIds = [...new Set([...(session.huntCombat!.usedJutsuIds ?? []), intent.jutsuId])];
        if (intent.type === 'summon' && companion && !battle.pendingCompanion) {
            session.companionUsage = { petId: companion.petId, ...(companion.pveGearId ? { pveGearId: companion.pveGearId } : {}), ...(companion.consumableId ? { consumableId: companion.consumableId } : {}) };
            delete session.pendingCompanion;
            // applyAction already paid the sealed gear/consumable heal. Only
            // carry its usage receipt into the outer Solo-PvE settlement.
        }
        checkTowerWinner(battle, floor);
        if (battle.status === 'active' && (intent.type === 'wait' || !humanHasTowerAction(battle, player))) {
            endTurn(battle, floor);
            runAiUntilHuman(battle, floor, rng);
        }
    }
    session.eventSeq += 1;
    projectHuntCombat(session);
    return { applied: true, session };
}
