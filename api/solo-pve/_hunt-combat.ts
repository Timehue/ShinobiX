import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';
import type { HuntCombatAction, HuntFormation } from '../../shared/hunt-combat.js';
import { huntHash } from '../missions/_hunt-trail.js';
import type { PvpFighter } from '../pvp/session.js';
import type { SoloPveAction, SoloPveActionResult, SoloPveSession } from './_session.js';
import { createTowerSession, activeActor, type TowerActor, type TowerSession } from '../towers/_tower-session.js';
import { applyAction, checkTowerWinner, endTurn, humanHasTowerAction, runAiUntilHuman, startRound, type TowerAction } from '../towers/_engine.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import { makeRng } from '../towers/_sim.js';
import { companionConsumableHealPct } from '../combat-core/companion.js';

export type HuntCombatState = {
    formation: HuntFormation;
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
    const occupied = new Set(session.environment.blockedTiles);
    const spawn = (preferred: number) => {
        const pos = [preferred, ...Array.from({ length: 120 }, (_, tile) => tile)].find(tile => !occupied.has(tile));
        if (pos === undefined) throw new Error('The hunt battlefield has no free spawn tiles.');
        occupied.add(pos);
        return pos;
    };
    const player = fighterActor(session.player, 'player', session.ownerSlug, spawn(62));
    player.itemCharges = { ...session.itemCharges };
    const enemies = Array.from({ length: formation.count }, (_, index) => {
        const actor = fighterActor(session.enemy, `hunt-enemy-${index}`, null, spawn([33, 57, 81][index]!));
        // Share the encounter's existing HP budget across the creatures. Packs
        // also split offensive strength because all members can act in one round.
        actor.maxHp = Math.max(1, Math.floor(session.enemy.maxHp / formation.count) + (index === formation.count - 1 ? session.enemy.maxHp % formation.count : 0));
        actor.hp = actor.maxHp;
        if (formation.kind === 'pack') {
            const stats = actor.character.stats as Record<string, number>;
            actor.character.stats = Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Math.max(1, Math.floor(value / Math.sqrt(formation.count)))]));
        }
        const target = context.kind === 'hunt-target' && index === formation.count - 1;
        actor.name = target || formation.count === 1 ? session.enemy.name : `${session.enemy.name} ${index + 1}`;
        actor.character.name = actor.name;
        actor.character.huntContractTarget = target;
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

function projectHuntCombat(session: SoloPveSession): void {
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
        player.hp = Math.max(0, player.hp - cost);
        if (intent.type === 'abandon' || opts.escapeSucceeds?.() === true || player.hp === 0) {
            battle.status = 'done'; battle.winner = 'enemy'; battle.objectiveState.failed = true;
            session.outcome = intent.type === 'flee' && player.hp > 0 ? 'fled' : 'loss';
            battle.log.push(`${player.name} leaves the hunt, losing ${cost} HP.`);
        } else {
            battle.log.push(`${player.name} fails to escape and loses ${cost} HP.`);
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
            const bonus = companionConsumableHealPct(companion.consumableId);
            if (bonus > 0 && player.hp > 0) player.hp = Math.min(player.maxHp, player.hp + Math.max(1, Math.floor(player.maxHp * bonus / 100)));
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
