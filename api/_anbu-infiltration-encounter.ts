/*
 * Anbu Vault Infiltration is one human raider versus one server-controlled
 * snapshot of a real appointed defender. The snapshot is content, not a live
 * second participant, so the fight belongs on the Solo PvE runtime.
 */
import type { PvpFighter } from './pvp/session.js';
import {
    createSoloPveSession,
    type SoloPveSession,
} from './solo-pve/_session.js';

export const INFILTRATION_MAP = { width: 12, height: 10 } as const;
export const INFILTRATION_ROUND_BUDGET = 25;
export type InfiltrationBiome = 'forest' | 'snow' | 'volcano' | 'shadow' | 'central';

const VALID_BIOMES: readonly InfiltrationBiome[] = ['forest', 'snow', 'volcano', 'shadow', 'central'];

export interface InfiltrationFighter {
    slug: string;
    name: string;
    character: Record<string, unknown>;
    itemCharges?: Record<string, number>;
}

function num(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function biomeForTerrain(terrain: unknown): InfiltrationBiome {
    const value = String(terrain ?? '').toLowerCase() as InfiltrationBiome;
    return VALID_BIOMES.includes(value) ? value : 'central';
}

function fighter(input: InfiltrationFighter, pos: number, enemy = false): PvpFighter {
    const maxHp = Math.max(1, num(input.character.maxHp, 1_000));
    const maxChakra = Math.max(0, num(input.character.maxChakra, 50));
    const maxStamina = Math.max(0, num(input.character.maxStamina, 50));
    const character = {
        ...input.character,
        name: input.name,
        ...(enemy ? { boss: true, aiTargetMode: 'lowest-hp' } : {}),
    };
    return {
        name: input.name,
        hp: maxHp,
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

export interface BuildInfiltrationParams {
    runId: string;
    now: number;
    raider: InfiltrationFighter;
    anbu: InfiltrationFighter;
    terrain: unknown;
    sector: number;
    targetVillage: string;
}

export function buildInfiltrationEncounter(params: BuildInfiltrationParams): SoloPveSession {
    const biome = biomeForTerrain(params.terrain);
    const middleRow = Math.floor(INFILTRATION_MAP.height / 2);
    const middleColumn = Math.floor(INFILTRATION_MAP.width / 2);
    const player = fighter(params.raider, middleRow * INFILTRATION_MAP.width + middleColumn - 2);
    const enemy = fighter(params.anbu, middleRow * INFILTRATION_MAP.width + middleColumn + 2, true);
    return createSoloPveSession({
        sessionId: params.runId,
        ownerSlug: params.raider.slug,
        encounter: {
            kind: 'anbu-infiltration',
            id: String(params.sector),
            sourceId: params.anbu.slug,
            bindingId: params.runId,
            level: Math.max(1, Math.floor(num(params.anbu.character.level, 100))),
            metadata: {
                sector: params.sector,
                targetVillage: params.targetVillage,
                anbuSlug: params.anbu.slug,
                terrain: biome,
                roundBudget: INFILTRATION_ROUND_BUDGET,
            },
        },
        player,
        enemy,
        now: params.now,
        environment: { biome, blockedTiles: [] },
        itemCharges: params.raider.itemCharges,
        activeTtlSeconds: 45 * 60,
    });
}

export type InfiltrationSessionBinding = {
    runId: string;
    raiderSlug: string;
    sector: number;
    targetVillage: string;
    anbuSlug: string;
    terrain: string;
};

export function infiltrationSessionMatches(
    run: InfiltrationSessionBinding,
    session: SoloPveSession | null | undefined,
): session is SoloPveSession {
    return Boolean(session
        && session.runtime === 'solo-pve'
        && session.sessionId === run.runId
        && session.ownerSlug === run.raiderSlug
        && session.encounter.kind === 'anbu-infiltration'
        && session.encounter.bindingId === run.runId
        && session.encounter.id === String(run.sector)
        && session.encounter.sourceId === run.anbuSlug
        && session.encounter.metadata?.sector === run.sector
        && session.encounter.metadata?.targetVillage === run.targetVillage
        && session.encounter.metadata?.anbuSlug === run.anbuSlug
        && session.encounter.metadata?.terrain === biomeForTerrain(run.terrain));
}
