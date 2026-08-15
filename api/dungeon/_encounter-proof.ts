import { createHash } from 'node:crypto';
import { dungeonWardenWasDefeated } from './_ai-fight.js';
import { safeName } from '../_utils.js';

export const DUNGEON_CARD_AUTHORITY_VERSION = 1;
export const DUNGEON_PET_AUTHORITY_VERSION = 1;

export type DungeonCardOutcome = 'player' | 'opponent' | 'draw';
export type DungeonPetOutcome = 'win' | 'loss' | 'draw';

type DungeonRunAuthority = {
    dungeonRunToken: string;
    activeRun: Record<string, unknown>;
};

type ApplyTerminalResult =
    | { ok: true; alreadyApplied: boolean; character: Record<string, unknown> }
    | { ok: false; error: string };

const RUN_TOKEN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const PROOF_ID_RE = /^[A-Za-z0-9_-]{8,96}$/;
const PET_ID_RE = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanRunToken(value: unknown): string {
    const token = typeof value === 'string' ? value.trim().slice(0, 80) : '';
    return RUN_TOKEN_RE.test(token) ? token : '';
}

function cleanProofId(value: unknown): string {
    const proofId = typeof value === 'string' ? value.trim().slice(0, 96) : '';
    return PROOF_ID_RE.test(proofId) ? proofId : '';
}

function cleanPlayerName(value: unknown): string {
    return safeName(typeof value === 'string' ? value : '');
}

function cleanPetIds(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length < 1 || value.length > 4) return null;
    const ids = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
    if (ids.some((id) => !PET_ID_RE.test(id)) || new Set(ids).size !== ids.length) return null;
    return ids;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Resolve one exact, still-active Dungeon run. An abandoned, redeemed, or
 * replaced run never inherits encounter evidence from an earlier token. */
export function resolveExactDungeonRun(
    character: Record<string, unknown>,
    dungeonRunTokenRaw: unknown,
): DungeonRunAuthority {
    const dungeonRunToken = cleanRunToken(dungeonRunTokenRaw);
    const activeRun = character.activeDungeonRun
        && typeof character.activeDungeonRun === 'object'
        && !Array.isArray(character.activeDungeonRun)
        ? character.activeDungeonRun as Record<string, unknown>
        : null;
    if (!dungeonRunToken || !activeRun || activeRun.token !== dungeonRunToken) {
        throw new Error('The encounter proof no longer matches the active Dungeon run.');
    }
    return { dungeonRunToken, activeRun };
}

/** One run has one deterministic Chronicle session identity. This prevents a
 * client from substituting an unrelated external-stakes win at the Card seal. */
export function dungeonCardMatchId(playerNameRaw: unknown, dungeonRunTokenRaw: unknown): string {
    const playerName = cleanPlayerName(playerNameRaw);
    const dungeonRunToken = cleanRunToken(dungeonRunTokenRaw);
    if (!playerName || !dungeonRunToken) throw new Error('A player and valid Dungeon run token are required.');
    return createHash('sha256')
        .update(`shinobix:dungeon-card:v${DUNGEON_CARD_AUTHORITY_VERSION}:${playerName}:${dungeonRunToken}`)
        .digest('hex');
}

export function resolveDungeonCardAuthority(params: {
    playerName: unknown;
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
}): DungeonRunAuthority & { playerName: string; matchId: string } {
    const exact = resolveExactDungeonRun(params.character, params.dungeonRunToken);
    if (!dungeonWardenWasDefeated(exact.activeRun)) {
        throw new Error('The authoritative Dungeon Warden win is required before the Card seal.');
    }
    const playerName = cleanPlayerName(params.playerName);
    if (!playerName) throw new Error('A player is required for the Dungeon Card seal.');
    if (cleanPlayerName(params.character.name) !== playerName) {
        throw new Error('The Dungeon Card player does not match the active save.');
    }
    return {
        ...exact,
        playerName,
        matchId: dungeonCardMatchId(playerName, exact.dungeonRunToken),
    };
}

export function resolveDungeonPetAuthority(params: {
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
}): DungeonRunAuthority {
    const exact = resolveExactDungeonRun(params.character, params.dungeonRunToken);
    if (!dungeonWardenWasDefeated(exact.activeRun)) {
        throw new Error('The authoritative Dungeon Warden win is required before the Pet seal.');
    }
    if (!dungeonCardWasWon(exact.activeRun)) {
        throw new Error('The authoritative Dungeon Card win is required before the Pet seal.');
    }
    return exact;
}

function cardTerminalMatches(
    activeRun: Record<string, unknown>,
    matchId: string,
    outcome: DungeonCardOutcome,
): boolean {
    if (activeRun.cardAuthorityVersion !== DUNGEON_CARD_AUTHORITY_VERSION
        || activeRun.cardLastProofId !== matchId
        || activeRun.cardLastOutcome !== outcome
        || !Number.isFinite(activeRun.cardSettledAt)) return false;
    if (outcome !== 'player') return activeRun.cardDefeated !== true;
    return activeRun.cardDefeated === true
        && activeRun.cardProofId === matchId
        && Number.isFinite(activeRun.cardDefeatedAt);
}

export function applyDungeonCardTerminal(params: {
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
    matchId: unknown;
    outcome: DungeonCardOutcome;
    now?: number;
}): ApplyTerminalResult {
    let exact: DungeonRunAuthority;
    try {
        exact = resolveExactDungeonRun(params.character, params.dungeonRunToken);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'The Dungeon Card proof is invalid.' };
    }
    if (!dungeonWardenWasDefeated(exact.activeRun)) {
        return { ok: false, error: 'The authoritative Dungeon Warden win is required before the Card seal.' };
    }
    if (!(['player', 'opponent', 'draw'] as const).includes(params.outcome)) {
        return { ok: false, error: 'The Dungeon Card outcome is invalid.' };
    }
    const matchId = cleanProofId(params.matchId);
    let expectedMatchId = '';
    try {
        expectedMatchId = dungeonCardMatchId(params.character.name, exact.dungeonRunToken);
    } catch {
        return { ok: false, error: 'The Dungeon Card proof has no authoritative player binding.' };
    }
    if (!matchId || matchId !== expectedMatchId) {
        return { ok: false, error: 'The Chronicle proof does not belong to this Dungeon run.' };
    }

    const priorProofId = typeof exact.activeRun.cardLastProofId === 'string'
        ? exact.activeRun.cardLastProofId
        : '';
    if (priorProofId === matchId) {
        if (cardTerminalMatches(exact.activeRun, matchId, params.outcome)) {
            return { ok: true, alreadyApplied: true, character: params.character };
        }
        return { ok: false, error: 'The Chronicle proof conflicts with its recorded Dungeon outcome.' };
    }
    if (exact.activeRun.cardDefeated === true) {
        return { ok: false, error: 'The Dungeon Card seal was already won by another proof.' };
    }

    const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();
    const activeRun: Record<string, unknown> = {
        ...exact.activeRun,
        cardAuthorityVersion: DUNGEON_CARD_AUTHORITY_VERSION,
        cardLastOutcome: params.outcome,
        cardLastProofId: matchId,
        cardSettledAt: now,
        ...(params.outcome === 'player' ? {
            cardDefeated: true,
            cardProofId: matchId,
            cardDefeatedAt: now,
        } : {}),
    };
    return {
        ok: true,
        alreadyApplied: false,
        character: { ...params.character, activeDungeonRun: activeRun },
    };
}

function petTerminalMatches(
    activeRun: Record<string, unknown>,
    proofId: string,
    outcome: DungeonPetOutcome,
    petIds: readonly string[],
): boolean {
    const recordedPetIds = cleanPetIds(activeRun.petLastPetIds);
    if (activeRun.petAuthorityVersion !== DUNGEON_PET_AUTHORITY_VERSION
        || activeRun.petLastProofId !== proofId
        || activeRun.petLastOutcome !== outcome
        || !Number.isFinite(activeRun.petSettledAt)
        || !recordedPetIds
        || !sameStrings(recordedPetIds, petIds)) return false;
    if (outcome !== 'win') return activeRun.petDefeated !== true;
    return activeRun.petDefeated === true
        && activeRun.petProofId === proofId
        && Number.isFinite(activeRun.petDefeatedAt);
}

export function applyDungeonPetTerminal(params: {
    character: Record<string, unknown>;
    dungeonRunToken: unknown;
    proofId: unknown;
    outcome: DungeonPetOutcome;
    petIds: unknown;
    now?: number;
}): ApplyTerminalResult {
    let exact: DungeonRunAuthority;
    try {
        exact = resolveDungeonPetAuthority({
            character: params.character,
            dungeonRunToken: params.dungeonRunToken,
        });
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'The Dungeon Pet proof is invalid.' };
    }
    if (!(['win', 'loss', 'draw'] as const).includes(params.outcome)) {
        return { ok: false, error: 'The Dungeon Pet outcome is invalid.' };
    }
    const proofId = cleanProofId(params.proofId);
    const petIds = cleanPetIds(params.petIds);
    if (!proofId || !petIds) {
        return { ok: false, error: 'The Dungeon Pet proof is incomplete.' };
    }

    const priorProofId = typeof exact.activeRun.petLastProofId === 'string'
        ? exact.activeRun.petLastProofId
        : '';
    if (priorProofId === proofId) {
        if (petTerminalMatches(exact.activeRun, proofId, params.outcome, petIds)) {
            return { ok: true, alreadyApplied: true, character: params.character };
        }
        return { ok: false, error: 'The Pet proof conflicts with its recorded Dungeon outcome.' };
    }
    if (exact.activeRun.petDefeated === true) {
        return { ok: false, error: 'The Dungeon Pet seal was already won by another proof.' };
    }

    const now = Number.isFinite(params.now) ? Number(params.now) : Date.now();
    const activeRun: Record<string, unknown> = {
        ...exact.activeRun,
        petAuthorityVersion: DUNGEON_PET_AUTHORITY_VERSION,
        petLastOutcome: params.outcome,
        petLastProofId: proofId,
        petSettledAt: now,
        petLastPetIds: petIds,
        ...(params.outcome === 'win' ? {
            petDefeated: true,
            petProofId: proofId,
            petDefeatedAt: now,
        } : {}),
    };
    return {
        ok: true,
        alreadyApplied: false,
        character: { ...params.character, activeDungeonRun: activeRun },
    };
}

export function dungeonCardWasWon(activeRun: Record<string, unknown> | null): boolean {
    if (!activeRun || activeRun.cardAuthorityVersion !== DUNGEON_CARD_AUTHORITY_VERSION
        || activeRun.cardDefeated !== true
        || activeRun.cardLastOutcome !== 'player'
        || !Number.isFinite(activeRun.cardSettledAt)
        || !Number.isFinite(activeRun.cardDefeatedAt)) return false;
    const proofId = cleanProofId(activeRun.cardProofId);
    return !!proofId && activeRun.cardLastProofId === proofId;
}

export function dungeonPetWasWon(activeRun: Record<string, unknown> | null): boolean {
    if (!activeRun || activeRun.petAuthorityVersion !== DUNGEON_PET_AUTHORITY_VERSION
        || activeRun.petDefeated !== true
        || activeRun.petLastOutcome !== 'win'
        || !Number.isFinite(activeRun.petSettledAt)
        || !Number.isFinite(activeRun.petDefeatedAt)
        || !cleanPetIds(activeRun.petLastPetIds)) return false;
    const proofId = cleanProofId(activeRun.petProofId);
    return !!proofId && activeRun.petLastProofId === proofId;
}
