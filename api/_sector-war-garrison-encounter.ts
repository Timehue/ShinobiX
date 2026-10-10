/*
 * Sector War Garrison Assault — the liveness-fallback AI defense for a Combat
 * sector-war contest (api/_sector-war.ts isGarrisonAssaultable /
 * GARRISON_UNLOCK_IDLE_MS), rebuilt after the wrong-owner Tower-backed version
 * was retired in d37aa4d62 ("fix(combat): retire wrong-owner sector garrison").
 *
 * Shape mirrors api/_anbu-infiltration-encounter.ts on purpose: one human
 * attacker versus one server-controlled snapshot of a REAL appointed defender —
 * the defending village's ANBU, per owner ruling ("it goes off the defender
 * since it pulls from anbu of the village"), not a generic stat-scaled bot. The
 * snapshot is content, not a live second participant, so — same reasoning as
 * Anbu Infiltration — the fight belongs on the Solo PvE runtime, never Tower
 * (docs/architecture/combat-runtime-boundaries.md). The contest OUTCOME still
 * has to feed the exact same sector-war score a real human PvP duel would
 * (api/pvp/_sector-war-continuation.ts), at garrison weight, which is why
 * the mode is labeled 'pvp' in shared/runtime-mode-registry.ts even though its
 * combat is simulated here: there is no structural rule against reusing the
 * Solo PvE engine under a sector-war-orchestrated, pvp-scored mode — the only
 * rule the retirement enforced was against resolving it with Tower's
 * resolveMercBattle/sealTowerFighter, which this file never touches.
 *
 * A distinct encounter.kind ('sector-war-garrison', not 'anbu-infiltration')
 * keeps the two modes distinguishable in session state/telemetry even though
 * they share a shape and both read a real defender's sealed loadout.
 */
import type { PvpFighter } from './pvp/session.js';
import {
    createSoloPveSession,
    type SoloPveSession,
} from './solo-pve/_session.js';
import { biomeForTerrain } from './_anbu-infiltration-encounter.js';
import type { SealedSectorWeather } from './_sector-weather-seal.js';

export const GARRISON_MAP = { width: 12, height: 10 } as const;
export const GARRISON_ROUND_BUDGET = 25;
export const GARRISON_ENCOUNTER_KIND = 'sector-war-garrison';
/** How long an assault may sit with no action before it lapses. This is the
 *  Solo-PvE GAMEPLAY expiry, and every action slides it forward again
 *  (api/solo-pve/_action-service.ts), so it bounds idleness, not fight length. */
export const GARRISON_ACTIVE_TTL_SECONDS = 45 * 60;

export interface GarrisonFighter {
    slug: string;
    name: string;
    character: Record<string, unknown>;
    itemCharges?: Record<string, number>;
}

function num(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function fighter(input: GarrisonFighter, pos: number, enemy = false): PvpFighter {
    const maxHp = Math.max(1, num(input.character.maxHp, 1_000));
    const maxChakra = Math.max(0, num(input.character.maxChakra, 50));
    const maxStamina = Math.max(0, num(input.character.maxStamina, 50));
    // The attacker walks in with the HP their save holds. Settlement writes the
    // HP the fight ends on back onto that save (settleGarrisonFight, and
    // /api/pve/fight-outcome for a walk-out), so a full-pool seed turned
    // "start an assault, then abandon it" into a free heal for a wounded
    // attacker. Clamped to [0, maxHp] exactly like the generic seeding in
    // api/solo-pve/_ai-encounter.ts. The sealed ANBU is content with no save
    // to write back to, so it always stands at full strength.
    const hp = enemy ? maxHp : Math.max(0, Math.min(maxHp, num(input.character.hp, maxHp)));
    const character = {
        ...input.character,
        name: input.name,
        ...(enemy ? { boss: true, aiTargetMode: 'lowest-hp' } : {}),
    };
    return {
        name: input.name,
        hp,
        maxHp,
        chakra: maxChakra,
        maxChakra,
        stamina: maxStamina,
        maxStamina,
        shield: 0,
        statuses: [],
        character,
        pos,
    };
}

export interface BuildGarrisonParams {
    runId: string;
    now: number;
    attacker: GarrisonFighter;
    anbu: GarrisonFighter;
    terrain: unknown;
    sector: number;
    contestId: string;
    attackerVillage: string;
    defenderVillage: string;
    /** The sector's sky, sealed by the caller (api/_sector-weather-seal.ts) —
     *  the same sky the human sector-war duel this fight stands in for seals. */
    weather?: SealedSectorWeather;
}

export function buildGarrisonEncounter(params: BuildGarrisonParams): SoloPveSession {
    const biome = biomeForTerrain(params.terrain);
    const middleRow = Math.floor(GARRISON_MAP.height / 2);
    const middleColumn = Math.floor(GARRISON_MAP.width / 2);
    const player = fighter(params.attacker, middleRow * GARRISON_MAP.width + middleColumn - 2);
    const enemy = fighter(params.anbu, middleRow * GARRISON_MAP.width + middleColumn + 2, true);
    return createSoloPveSession({
        sessionId: params.runId,
        ownerSlug: params.attacker.slug,
        encounter: {
            kind: GARRISON_ENCOUNTER_KIND,
            id: String(params.sector),
            sourceId: params.anbu.slug,
            bindingId: params.runId,
            level: Math.max(1, Math.floor(num(params.anbu.character.level, 100))),
            metadata: {
                sector: params.sector,
                contestId: params.contestId,
                attackerVillage: params.attackerVillage,
                defenderVillage: params.defenderVillage,
                anbuSlug: params.anbu.slug,
                terrain: biome,
                roundBudget: GARRISON_ROUND_BUDGET,
            },
        },
        player,
        enemy,
        now: params.now,
        environment: { biome, blockedTiles: [], ...params.weather },
        itemCharges: params.attacker.itemCharges,
        activeTtlSeconds: GARRISON_ACTIVE_TTL_SECONDS,
    });
}

/** The exact contest/attacker/ANBU combination a garrison session was minted
 *  for — verified again at resolve so a client can never hand in an arbitrary
 *  finished solo-pve session id and have it accepted as this assault. Mirrors
 *  InfiltrationSessionBinding/infiltrationSessionMatches. */
export type GarrisonSessionBinding = {
    runId: string;
    attackerName: string;
    sector: number;
    contestId: string;
    attackerVillage: string;
    defenderVillage: string;
    anbuSlug: string;
    terrain: string;
};

export function garrisonSessionMatches(
    run: GarrisonSessionBinding,
    session: SoloPveSession | null | undefined,
): session is SoloPveSession {
    return Boolean(session
        && session.runtime === 'solo-pve'
        && session.sessionId === run.runId
        && session.ownerSlug === run.attackerName
        && session.encounter.kind === GARRISON_ENCOUNTER_KIND
        && session.encounter.bindingId === run.runId
        && session.encounter.id === String(run.sector)
        && session.encounter.sourceId === run.anbuSlug
        && session.encounter.metadata?.sector === run.sector
        && session.encounter.metadata?.contestId === run.contestId
        && session.encounter.metadata?.attackerVillage === run.attackerVillage
        && session.encounter.metadata?.defenderVillage === run.defenderVillage
        && session.encounter.metadata?.anbuSlug === run.anbuSlug
        && session.encounter.metadata?.terrain === biomeForTerrain(run.terrain));
}
