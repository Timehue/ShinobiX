import {
    actorId as canonicalActorId,
    controllerId as canonicalControllerId,
    teamId as canonicalTeamId,
    type CombatActorRef,
} from '../combat-core/n-actor.js';
import type {
    TowerPvpBinding,
    TowerPvpMatch,
    TowerPvpMatchView,
    TowerPvpRosterMember,
    TowerPvpTeamId,
} from '../../shared/tower-pvp.js';
import { TOWER_PVP_MATCH_SIZE, TOWER_PVP_TEAM_SIZE, TOWER_PVP_TURN_MS } from '../../shared/tower-pvp.js';
import { MAX_ROUNDS } from '../combat-core/constants.js';
import type { TowerFloor } from './_floor-catalog.js';
import {
    activeActor,
    createTowerSession,
    type TowerActor,
    type TowerSession,
} from './_tower-session.js';
import {
    checkTowerWinner,
    endTurn,
    runAiUntilHuman,
    startRound,
} from './_engine.js';
import { makeRng } from './_sim.js';
import { isAfkHumanTurnDue } from './_tower-mp.js';
import {
    bumpTowerActionVersion,
    initializeTowerActionVersion,
    towerActionVersion,
} from './_action-idempotency.js';

export const TOWER_PVP_ID = /^tpvp-[a-f0-9]{32}$/;
/**
 * Session-level marker for a human-vs-human tower match. Exported so the engine
 * can rule out PvE-only power for the WHOLE session rather than per target:
 * the per-target AI check reads the PRIMARY target, so an AOE aimed at an NPC
 * could otherwise splash a human with a PvE bonus attached.
 */
export const TOWER_PVP_TOWER_ID = 'tower-mpvp-v1';
export const TOWER_PVP_READY_MS = 90_000;
export const TOWER_PVP_AFK_STRIKES_TO_FORFEIT = 2;

/**
 * A neutral, symmetric arena. It is embedded and can never pass Story/Spire
 * settlement identity.
 *
 * The board is the CANONICAL 12x10 hex grid (combat-core GRID_W/GRID_H) that
 * 1v1 PvP and solo PvE fight on — shinobi PvP is one battlefield regardless of
 * team size. The round cap is likewise the canonical MAX_ROUNDS rather than a
 * Tower-specific budget: a 2v2 is shinobi PvP and must not end sooner than the
 * 1v1 it is scored beside. Story/Spire floors keep their own per-floor budgets.
 */
export const TOWER_PVP_FLOOR: TowerFloor = {
    id: 0,
    name: 'Team Arena',
    biome: 'central',
    objective: 'defeat-all',
    roundBudget: MAX_ROUNDS,
    map: { width: 12, height: 10 },
    fieldRule: { kind: 'none' },
    enemies: [],
    firstClearReward: {},
};

export type TowerPvpFighterSeed = {
    slug: string;
    displayName: string;
    skill: number;
    character: Record<string, unknown>;
    /**
     * Sealed per-fight consumable budget, or omitted for a consumable-free
     * match. The open Team Arena omits it because it settles no economy, so
     * spending a real potion there would be a pure loss. A clan-war 2v2 IS
     * reward-bearing and seals real charges, matching clan-war 1v1 on the PvP
     * engine — see api/clan/war/_mpvp.ts.
     */
    itemCharges?: Record<string, number>;
};

export type StoredTowerPvpMatch = TowerPvpMatch<TowerSession>;

function vitals(character: Record<string, unknown>): { maxHp: number; maxChakra: number; maxStamina: number } {
    return {
        maxHp: Math.max(1, Math.floor(Number(character.maxHp ?? 1_000) || 1_000)),
        maxChakra: Math.max(0, Math.floor(Number(character.maxChakra ?? 50) || 50)),
        maxStamina: Math.max(0, Math.floor(Number(character.maxStamina ?? 50) || 50)),
    };
}

function fighterActor(
    fighter: TowerPvpFighterSeed,
    member: TowerPvpRosterMember,
    pos: number,
): TowerActor {
    const { maxHp, maxChakra, maxStamina } = vitals(fighter.character);
    return {
        id: member.actorId,
        side: member.teamId === 'amber' ? 'squad' : 'enemy',
        name: fighter.displayName,
        ownerSlug: fighter.slug,
        ai: false,
        hp: maxHp,
        maxHp,
        chakra: maxChakra,
        maxChakra,
        stamina: maxStamina,
        maxStamina,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos,
        character: fighter.character,
        // Hand weapons are always reusable. Consumables and thrown ammunition
        // fail closed at zero UNLESS the caller sealed a real budget: the open
        // queue settles no economy so it spends nothing, while a reward-bearing
        // clan-war duel must behave like every other rated fight.
        itemCharges: { ...(fighter.itemCharges ?? {}) },
    };
}

function assertExactUniqueRoster(fighters: readonly TowerPvpFighterSeed[]): void {
    if (fighters.length !== TOWER_PVP_MATCH_SIZE) {
        throw new RangeError(`Tower MPvP needs exactly ${TOWER_PVP_MATCH_SIZE} fighters.`);
    }
    const unique = new Set(fighters.map(fighter => fighter.slug));
    if (unique.size !== TOWER_PVP_MATCH_SIZE) throw new TypeError('Tower MPvP fighter slugs must be unique.');
}

/**
 * Build the canonical roster from an explicit, caller-owned team split.
 *
 * Public matchmaking balances teams by skill, but a clan-war 2v2 must field
 * challengers against defenders — the split is a fact of the challenge, not a
 * fairness decision. Validated exactly as strictly as the balanced path: four
 * unique fighters, two per side, every named slug present.
 */
export function assignFixedTowerPvpTeams(
    fighters: readonly TowerPvpFighterSeed[],
    assignment: Readonly<Record<TowerPvpTeamId, readonly string[]>>,
): TowerPvpRosterMember[] {
    assertExactUniqueRoster(fighters);
    const bySlug = new Map(fighters.map(fighter => [fighter.slug, fighter] as const));
    const named = [...assignment.amber, ...assignment.violet];
    if (named.length !== TOWER_PVP_MATCH_SIZE || new Set(named).size !== TOWER_PVP_MATCH_SIZE) {
        throw new TypeError('Tower MPvP fixed teams must name four unique fighters.');
    }
    if (assignment.amber.length !== TOWER_PVP_TEAM_SIZE || assignment.violet.length !== TOWER_PVP_TEAM_SIZE) {
        throw new RangeError(`Tower MPvP fixed teams need exactly ${TOWER_PVP_TEAM_SIZE} fighters per side.`);
    }
    if (named.some(slug => !bySlug.has(slug))) {
        throw new TypeError('Tower MPvP fixed teams named a fighter that is not in the roster.');
    }
    return buildTowerPvpRoster({
        amber: assignment.amber.map(slug => bySlug.get(slug)!),
        violet: assignment.violet.map(slug => bySlug.get(slug)!),
    });
}

/**
 * Server-owned, deterministic 2v2 assignment. The strongest and weakest seed
 * face the middle pair, which is substantially fairer than queue-order teams.
 */
export function assignTowerPvpTeams(fighters: readonly TowerPvpFighterSeed[]): TowerPvpRosterMember[] {
    assertExactUniqueRoster(fighters);
    const ranked = [...fighters].sort((a, b) =>
        b.skill - a.skill || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    return buildTowerPvpRoster({
        amber: [ranked[0]!, ranked[3]!],
        violet: [ranked[1]!, ranked[2]!],
    });
}

function buildTowerPvpRoster(teams: Record<TowerPvpTeamId, TowerPvpFighterSeed[]>): TowerPvpRosterMember[] {
    const roster: TowerPvpRosterMember[] = [];
    for (const team of ['amber', 'violet'] as const) {
        canonicalTeamId(`tower-pvp:${team}`);
        teams[team].forEach((fighter, index) => {
            const actor = `${team}-${index}`;
            const controller = `player:${fighter.slug}`;
            canonicalActorId(actor);
            canonicalControllerId(controller);
            roster.push({
                slug: fighter.slug,
                displayName: fighter.displayName,
                teamId: team,
                actorId: actor,
                controllerId: controller,
                ready: false,
            });
        });
    }
    return roster;
}

/** Canonical N-actor identity projection used by tests and future team-target planning. */
export function towerPvpCombatRoster(match: StoredTowerPvpMatch): CombatActorRef[] {
    return match.roster.map((member, rosterOrder) => ({
        actorId: canonicalActorId(member.actorId),
        teamId: canonicalTeamId(`tower-pvp:${member.teamId}`),
        controllerId: canonicalControllerId(member.controllerId),
        rosterOrder,
        state: match.combat.actors.find(actor => actor.id === member.actorId)?.hp === 0 ? 'defeated' : 'active',
    }));
}

export function createTowerPvpMatch(input: {
    matchId: string;
    fighters: readonly TowerPvpFighterSeed[];
    seed: number;
    now: number;
    /** Omitted for the public queue, which balances teams by skill instead. */
    teams?: Readonly<Record<TowerPvpTeamId, readonly string[]>>;
    /** Defaults to the open Team Arena queue. */
    binding?: TowerPvpBinding;
}): StoredTowerPvpMatch {
    if (!TOWER_PVP_ID.test(input.matchId)) throw new TypeError('Invalid Tower MPvP match ID.');
    const binding: TowerPvpBinding = input.binding ?? { kind: 'public-queue' };
    // A clan-war challenge fields clan against clan; only the open queue may
    // reshuffle sides for fairness.
    if (binding.kind !== 'public-queue' && !input.teams) {
        throw new TypeError('A bound Tower MPvP match must supply its fixed teams.');
    }
    const roster = input.teams
        ? assignFixedTowerPvpTeams(input.fighters, input.teams)
        : assignTowerPvpTeams(input.fighters);
    const bySlug = new Map(input.fighters.map(fighter => [fighter.slug, fighter] as const));
    const positions: Record<string, number> = {
        'amber-0': 25,
        'amber-1': 85,
        'violet-0': 34,
        'violet-1': 94,
    };
    const actors = roster.map(member => fighterActor(bySlug.get(member.slug)!, member, positions[member.actorId]!));
    const combat = createTowerSession({
        towerId: TOWER_PVP_TOWER_ID,
        runId: input.matchId,
        floor: TOWER_PVP_FLOOR.id,
        seed: input.seed,
        partySize: TOWER_PVP_TEAM_SIZE,
        map: {
            width: TOWER_PVP_FLOOR.map.width,
            height: TOWER_PVP_FLOOR.map.height,
            biome: TOWER_PVP_FLOOR.biome,
            blockedTiles: [],
            hazardTiles: [],
            objectiveTiles: [],
        },
        actors,
        objectiveKind: TOWER_PVP_FLOOR.objective,
        now: input.now,
    });
    combat.encounterFloor = structuredClone(TOWER_PVP_FLOOR);
    // This mode has a separate, intentionally empty settlement policy. Mark the
    // embedded combat record settled from birth so it cannot look reward-pending.
    combat.rewardSettlementState = 'settled';
    combat.roundCap = TOWER_PVP_FLOOR.roundBudget;
    initializeTowerActionVersion(combat);
    return {
        contractVersion: 1,
        matchId: input.matchId,
        binding,
        ...(input.fighters.some(f => f.itemCharges !== undefined)
            ? {
                sealedItemCharges: Object.fromEntries(input.fighters.map(f => (
                    [f.slug, { ...(f.itemCharges ?? {}) }]
                ))),
            }
            : {}),
        status: 'ready',
        version: 0,
        createdAt: input.now,
        updatedAt: input.now,
        readyDeadlineAt: input.now + TOWER_PVP_READY_MS,
        roster,
        combat,
        winner: null,
        afkStrikes: Object.fromEntries(roster.map(member => [member.slug, 0])),
        recentCommands: [],
        settlement: { policy: 'no-progression-v1', acknowledgements: [] },
        rules: {
            teamSize: TOWER_PVP_TEAM_SIZE,
            // Driven by whether a budget was SEALED, not by whether anyone
            // happens to be carrying something: a clan-war duel where nobody
            // packed a potion still plays by consumable rules.
            consumables: input.fighters.some(fighter => fighter.itemCharges !== undefined)
                ? 'enabled'
                : 'disabled',
            rewards: 'none',
            afkStrikesToForfeit: TOWER_PVP_AFK_STRIKES_TO_FORFEIT,
        },
    };
}

export function towerPvpMember(match: StoredTowerPvpMatch, slug: string): TowerPvpRosterMember | undefined {
    return match.roster.find(member => member.slug === slug);
}

/**
 * BattleTowerFight renders `squad` as "us". Violet therefore receives a deep,
 * response-only side/ground-owner/winner swap while storage stays in one stable
 * amber=squad authority frame. Actor IDs and absolute roster teams never change.
 */
export function projectTowerPvpMatchForViewer(
    match: StoredTowerPvpMatch,
    slug: string,
): TowerPvpMatchView<TowerSession> | null {
    const member = towerPvpMember(match, slug);
    if (!member) return null;
    const projected = structuredClone(match) as StoredTowerPvpMatch;
    if (member.teamId === 'violet') {
        for (const actor of projected.combat.actors) {
            if (actor.side === 'squad') actor.side = 'enemy';
            else if (actor.side === 'enemy') actor.side = 'squad';
        }
        for (const effect of projected.combat.groundEffects) {
            effect.owner = effect.owner === 'p1' ? 'p2' : 'p1';
        }
        projected.combat.winner = projected.combat.winner === 'squad' ? 'enemy'
            : projected.combat.winner === 'enemy' ? 'squad' : projected.combat.winner;
    }
    const startedAt = Number(projected.combat.turnStartedAt);
    return {
        ...projected,
        viewer: { teamId: member.teamId, actorId: member.actorId },
        turnDeadlineAt: projected.status === 'active' && Number.isFinite(startedAt)
            ? startedAt + TOWER_PVP_TURN_MS
            : null,
    };
}

export function towerPvpTeamForActor(match: StoredTowerPvpMatch, actorId: string): TowerPvpTeamId | undefined {
    return match.roster.find(member => member.actorId === actorId)?.teamId;
}

function totalVitality(match: StoredTowerPvpMatch, team: TowerPvpTeamId): number {
    return match.roster
        .filter(member => member.teamId === team)
        .reduce((sum, member) => {
            const actor = match.combat.actors.find(entry => entry.id === member.actorId);
            return sum + (actor ? Math.max(0, actor.hp) / Math.max(1, actor.maxHp) : 0);
        }, 0);
}

/** Convert engine sides to public team IDs and make round-cap adjudication symmetric. */
export function projectTowerPvpTerminal(match: StoredTowerPvpMatch): boolean {
    if (match.combat.status !== 'done') return false;
    const amberAlive = match.combat.actors.some(actor => actor.side === 'squad' && actor.hp > 0);
    const violetAlive = match.combat.actors.some(actor => actor.side === 'enemy' && actor.hp > 0);
    const timedOut = match.combat.log.at(-1)?.includes('Round limit reached') === true;
    let winner: TowerPvpTeamId | 'draw';
    if (!amberAlive && !violetAlive) winner = 'draw';
    else if (!amberAlive) winner = 'violet';
    else if (!violetAlive) winner = 'amber';
    else if (timedOut) {
        const amber = totalVitality(match, 'amber');
        const violet = totalVitality(match, 'violet');
        winner = Math.abs(amber - violet) < 0.000_001 ? 'draw' : amber > violet ? 'amber' : 'violet';
        match.combat.winner = winner === 'draw' ? 'draw' : winner === 'amber' ? 'squad' : 'enemy';
        match.combat.log.push(`Team Arena adjudication: ${winner === 'draw' ? 'draw' : `${winner} wins`} on remaining vitality.`);
    } else {
        winner = match.combat.winner === 'squad' ? 'amber'
            : match.combat.winner === 'enemy' ? 'violet' : 'draw';
    }
    match.status = 'done';
    match.winner = winner;
    match.combat.rewardSettlementState = 'settled';
    return true;
}

export function bumpTowerPvpVersion(match: StoredTowerPvpMatch, now: number): number {
    const version = bumpTowerActionVersion(match.combat);
    match.version = version;
    match.updatedAt = now;
    return version;
}

/** Start combat only after all four server roster entries have explicitly readied. */
export function activateReadyTowerPvpMatch(match: StoredTowerPvpMatch, now: number): boolean {
    if (match.status !== 'ready' || !match.roster.every(member => member.ready)) return false;
    match.status = 'active';
    startRound(match.combat);
    match.combat.turnStartedAt = now;
    match.combat.log.push('Both Tower teams are ready. The 2v2 match begins.');
    bumpTowerPvpVersion(match, now);
    return true;
}

/**
 * Authoritative AFK discipline: the first expired turn auto-passes, the second
 * consecutive expiry defeats only that player's actor. Their teammate may play on.
 */
export function advanceExpiredTowerPvpTurn(match: StoredTowerPvpMatch, now: number): boolean {
    if (match.status !== 'active' || !isAfkHumanTurnDue(match.combat, now)) return false;
    const actor = activeActor(match.combat);
    if (!actor?.ownerSlug) return false;
    const slug = actor.ownerSlug;
    const strikes = Math.max(0, Math.floor(Number(match.afkStrikes[slug] ?? 0))) + 1;
    match.afkStrikes[slug] = strikes;
    if (strikes >= TOWER_PVP_AFK_STRIKES_TO_FORFEIT) {
        actor.hp = 0;
        match.combat.log.push(`${actor.name} forfeits their place after two consecutive expired turns.`);
        checkTowerWinner(match.combat, TOWER_PVP_FLOOR);
    } else {
        match.combat.log.push(`${actor.name}'s turn expired and was passed.`);
    }
    if (match.combat.status === 'active') {
        endTurn(match.combat, TOWER_PVP_FLOOR);
        runAiUntilHuman(match.combat, TOWER_PVP_FLOOR, makeRng(match.combat.seed));
        match.combat.turnStartedAt = now;
    }
    projectTowerPvpTerminal(match);
    bumpTowerPvpVersion(match, now);
    return true;
}

/** Defeat one member's actor without granting the client control of team/winner state. */
export function forfeitTowerPvpActor(match: StoredTowerPvpMatch, slug: string, now: number): boolean {
    if (match.status !== 'active') return false;
    const member = towerPvpMember(match, slug);
    const actor = member && match.combat.actors.find(entry => entry.id === member.actorId);
    if (!actor || actor.hp <= 0) return false;
    const wasActive = activeActor(match.combat)?.id === actor.id;
    actor.hp = 0;
    match.combat.log.push(`${actor.name} forfeits the match.`);
    checkTowerWinner(match.combat, TOWER_PVP_FLOOR);
    if (match.combat.status === 'active' && wasActive) {
        endTurn(match.combat, TOWER_PVP_FLOOR);
        runAiUntilHuman(match.combat, TOWER_PVP_FLOOR, makeRng(match.combat.seed));
        match.combat.turnStartedAt = now;
    }
    projectTowerPvpTerminal(match);
    bumpTowerPvpVersion(match, now);
    return true;
}

export function resetTowerPvpAfkStrikes(match: StoredTowerPvpMatch, slug: string): void {
    match.afkStrikes[slug] = 0;
}

export function assertTowerPvpVersionInvariant(match: StoredTowerPvpMatch): void {
    if (match.version !== towerActionVersion(match.combat)) {
        throw new Error('Tower MPvP match/combat versions diverged.');
    }
}
