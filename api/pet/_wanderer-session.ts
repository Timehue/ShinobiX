/*
 * Natural sector pet-wanderer kickoff authority.
 *
 * One immutable NX session owns the chosen pet snapshot, server-built beast,
 * seed, Showdown script and verdict. The ordinary battle token is a short-lived
 * projection of that session and can be republished on response-loss recovery.
 * The wanderer cooldown is claimed only after the immutable session and token
 * are readable, and its proof id makes the subsequent save mutation retry-safe.
 */

import { randomInt, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { resolveWarDuel } from '../_pet-showdown/war-duel.js';
import { kv } from '../_storage.js';
import { activeCarriedPets } from '../_entitlements.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { savedCurrentSector } from '../missions/_mission-progress-receipt.js';
import { resolveNaturalWorldWanderer } from '../missions/_world-ai-fight.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    claimWandererUseCooldown,
    currentWandererCooldownUntil,
    parseNaturalWandererId,
    WANDERER_ENCOUNTER_COOLDOWN_MS,
    WANDERER_ENCOUNTER_COOLDOWN_SECONDS,
    WANDERER_SECTOR_COUNT,
    withWandererUseState,
} from '../sector/_wanderer-encounter.js';
import { buildWarTeam } from '../_pet-showdown/war-team.js';
import { casualPvePetSnapshot, parseSealedPetSnapshots } from './_casual-pve-seal.js';
import { petArenaRyoRewardForTeam } from './_arena-reward.js';
import { petCombatBusyReason } from './_pet-busy.js';
import { buildWandererBeast } from './_wanderer-duel.js';

const SESSION_VERSION = 1 as const;
const TOKEN_TTL_SECONDS = 15 * 60;

type NaturalWandererContext = {
    id: string;
    sector: number;
    homeSector: number;
    bucket: number;
    rosterIndex: number;
    archetypeId: string;
    verb: 'petDuel';
    name: string;
};

export type NaturalWandererPetSession = {
    version: typeof SESSION_VERSION;
    kind: 'natural-pet-wanderer';
    playerName: string;
    token: string;
    reportKey: string;
    proofId: string;
    seed: number;
    createdAt: number;
    cooldownUntil: number;
    moveToSector: number;
    wanderer: NaturalWandererContext;
    playerPetIds: [string];
    playerPets: [Pet];
    opponentPets: [Pet];
    outcome: 'win' | 'loss';
    showdownScript: ShowdownReplayScript;
};

export type NaturalWandererPetStartResult =
    | {
        ok: true;
        session: NaturalWandererPetSession;
        resumed: boolean;
        character: Record<string, unknown>;
        _saveVersion: number;
    }
    | { ok: false; status: number; error: string };

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function cleanRequest(body: Record<string, unknown>): {
    wandererId: string;
    sector: number;
    playerPetId: string;
} | { error: string } {
    const wanderer = record(body.wanderer);
    const wandererId = typeof wanderer?.id === 'string' ? wanderer.id.trim().slice(0, 96) : '';
    const parsedWandererId = parseNaturalWandererId(wandererId);
    const sector = Math.floor(Number(wanderer?.sector));
    const petIds = Array.isArray(body.playerPetIds) ? body.playerPetIds.map(String) : [];
    const hasOpponentContext = (typeof body.opponentName === 'string' && body.opponentName.trim().length > 0)
        || (Array.isArray(body.opponentPetIds) && body.opponentPetIds.length > 0)
        || (typeof body.pvpChallengeId === 'string' && body.pvpChallengeId.trim().length > 0)
        || (typeof body.matchToken === 'string' && body.matchToken.trim().length > 0)
        || body.opponentLevel !== undefined
        || body.seed !== undefined
        || body.ranked === true
        || body.hollowGate != null
        || body.dungeon != null;
    if (!wandererId || !parsedWandererId
        || !Number.isSafeInteger(parsedWandererId.sector)
        || parsedWandererId.sector < 1 || parsedWandererId.sector > WANDERER_SECTOR_COUNT
        || !Number.isSafeInteger(parsedWandererId.dayBucket) || parsedWandererId.dayBucket < 0
        || !Number.isSafeInteger(parsedWandererId.index) || parsedWandererId.index < 0 || parsedWandererId.index > 1
        || !Number.isFinite(sector) || sector < 1 || sector > WANDERER_SECTOR_COUNT) {
        return { error: 'A current natural wanderer id and sector are required.' };
    }
    if ((body.mode !== undefined && body.mode !== '1v1') || hasOpponentContext) {
        return { error: 'A natural wanderer duel cannot carry opponent, PvP, ranked, Hollow Gate, or Dungeon authority.' };
    }
    if (petIds.length !== 1 || !petIds[0] || new Set(petIds).size !== 1) {
        return { error: 'A natural wanderer duel requires one stored player pet.' };
    }
    return { wandererId, sector, playerPetId: petIds[0] };
}

function withoutConsumable(pet: Pet): Pet {
    if (!pet.loadout) return pet;
    return { ...pet, loadout: { ...pet.loadout, consumable: undefined } };
}

function validReplayScript(value: unknown): value is ShowdownReplayScript {
    const script = record(value);
    return Boolean(script && record(script.initialState) && record(script.finalState) && Array.isArray(script.events));
}

export function parseNaturalWandererPetSession(value: unknown): NaturalWandererPetSession | null {
    const session = record(value) as Partial<NaturalWandererPetSession> | null;
    if (!session || session.version !== SESSION_VERSION || session.kind !== 'natural-pet-wanderer') return null;
    const parsedId = parseNaturalWandererId(String(session.wanderer?.id ?? ''));
    const playerPetIds = Array.isArray(session.playerPetIds) ? session.playerPetIds.map(String) : [];
    const playerPets = parseSealedPetSnapshots(session.playerPets, playerPetIds);
    const opponentIds = Array.isArray(session.opponentPets)
        ? session.opponentPets.map((pet) => String(pet?.id ?? ''))
        : [];
    const opponentPets = parseSealedPetSnapshots(session.opponentPets, opponentIds);
    if (typeof session.playerName !== 'string' || !session.playerName
        || typeof session.token !== 'string' || !/^[0-9a-f]{32}$/.test(session.token)
        || session.reportKey !== `pet:${session.token}`
        || session.proofId !== `pet-wanderer:${session.token}`
        || !Number.isSafeInteger(session.seed) || Number(session.seed) < 1 || Number(session.seed) >= 0x7fffffff
        || !Number.isSafeInteger(session.createdAt) || Number(session.createdAt) <= 0
        || session.cooldownUntil !== Number(session.createdAt) + WANDERER_ENCOUNTER_COOLDOWN_MS
        || !Number.isSafeInteger(session.moveToSector) || Number(session.moveToSector) < 1 || Number(session.moveToSector) > WANDERER_SECTOR_COUNT
        || !parsedId
        || session.wanderer?.sector == null || Number(session.wanderer.sector) < 1 || Number(session.wanderer.sector) > WANDERER_SECTOR_COUNT
        || session.wanderer.homeSector !== parsedId.sector
        || session.wanderer.bucket !== parsedId.dayBucket
        || session.wanderer.rosterIndex !== parsedId.index
        || session.wanderer.verb !== 'petDuel'
        || typeof session.wanderer.archetypeId !== 'string' || !session.wanderer.archetypeId
        || typeof session.wanderer.name !== 'string' || !session.wanderer.name
        || playerPetIds.length !== 1 || !playerPets || playerPets.length !== 1
        || !opponentPets || opponentPets.length !== 1
        || (session.outcome !== 'win' && session.outcome !== 'loss')
        || !validReplayScript(session.showdownScript)) return null;
    return session as NaturalWandererPetSession;
}

function sessionKey(playerName: string, wandererId: string): string {
    return `pet:wanderer-duel:${playerName}:${wandererId}`;
}

function tokenKey(session: NaturalWandererPetSession): string {
    return `pet:battle-token:${session.playerName}:${session.token}`;
}

function sameSessionRequest(
    session: NaturalWandererPetSession,
    playerName: string,
    wandererId: string,
    sector: number,
    playerPetId: string,
): boolean {
    return session.playerName === playerName
        && session.wanderer.id === wandererId
        && session.wanderer.sector === sector
        && session.playerPetIds[0] === playerPetId;
}

function exactNaturalWanderer(
    character: Record<string, unknown>,
    wandererId: string,
    sector: number,
    at: number,
): ReturnType<typeof resolveNaturalWorldWanderer> {
    const resolved = resolveNaturalWorldWanderer(wandererId, character, sector, at);
    return resolved?.verb === 'petDuel' ? resolved : null;
}

function selectedPlayerPet(character: Record<string, unknown>, playerPetId: string): Pet | null {
    const carried = activeCarriedPets<Record<string, unknown>>(character);
    const stored = carried.find((pet) => String(pet.id ?? '') === playerPetId);
    if (!stored || petCombatBusyReason(character, stored)) return null;
    const team = buildWarTeam(character, [playerPetId]);
    return team?.[0]?.id === playerPetId ? team[0] : null;
}

function buildSession(
    playerName: string,
    character: Record<string, unknown>,
    wandererId: string,
    sector: number,
    playerPetId: string,
    now: number,
): NaturalWandererPetSession | null {
    const natural = exactNaturalWanderer(character, wandererId, sector, now);
    const parsed = parseNaturalWandererId(wandererId);
    const playerPet = selectedPlayerPet(character, playerPetId);
    const beast = buildWandererBeast(Number(character.level ?? 1));
    if (!natural || !parsed || !playerPet || !beast) return null;
    const token = randomUUID().replace(/-/g, '');
    const seed = randomInt(1, 0x7fffffff);
    const playerSnapshot = casualPvePetSnapshot(withoutConsumable(playerPet));
    const opponentSnapshot = casualPvePetSnapshot(withoutConsumable(beast));
    const resolution = resolveWarDuel({
        sessionId: `pet-wanderer:${token}`,
        seed,
        fromName: playerName,
        toName: natural.name,
        fromPets: [playerSnapshot],
        toPets: [opponentSnapshot],
        format: '1v1',
    });
    const moved = withWandererUseState(character, wandererId, now, sector);
    return {
        version: SESSION_VERSION,
        kind: 'natural-pet-wanderer',
        playerName,
        token,
        reportKey: `pet:${token}`,
        proofId: `pet-wanderer:${token}`,
        seed,
        createdAt: now,
        cooldownUntil: now + WANDERER_ENCOUNTER_COOLDOWN_MS,
        moveToSector: moved.moveToSector,
        wanderer: {
            id: wandererId,
            sector,
            homeSector: parsed.sector,
            bucket: parsed.dayBucket,
            rosterIndex: parsed.index,
            archetypeId: natural.id,
            verb: 'petDuel',
            name: natural.name,
        },
        playerPetIds: [playerPetId],
        playerPets: [playerSnapshot],
        opponentPets: [opponentSnapshot],
        outcome: resolution.outcome === 'from' ? 'win' : 'loss',
        showdownScript: resolution.script,
    };
}

type ExactLeaseState = 'refreshed' | 'absent' | 'conflict';

async function refreshExactLease(key: string, value: unknown, ttlSeconds: number): Promise<ExactLeaseState> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        let current: unknown;
        try {
            current = await kv.get(key);
        } catch (error) {
            lastError = error;
            continue;
        }
        if (current === null) return 'absent';
        if (!isDeepStrictEqual(current, value)) return 'conflict';
        try {
            // expected===replacement preserves the immutable proof while
            // atomically granting the recovered browser a complete lease.
            // A readback alone cannot prove that this TTL refresh committed.
            if (await kv.compareSet(key, current, current, { ex: ttlSeconds })) return 'refreshed';
        } catch (error) {
            // A commit-with-lost-ack is safe to retry because the value is
            // unchanged. Only a later successful CAS confirms the full TTL.
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    throw new Error(`wanderer-exact-lease-busy:${key}`);
}

async function publishExactNx(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const state = await refreshExactLease(key, value, ttlSeconds);
        if (state === 'refreshed') return true;
        if (state === 'conflict') return false;
        try {
            // Do not return from the NX write. The following loop confirms the
            // exact value and refreshes its TTL through full-value CAS.
            await kv.set(key, value, { nx: true, ex: ttlSeconds });
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) throw lastError;
    throw new Error(`wanderer-exact-publication-busy:${key}`);
}

async function claimActiveBattle(session: NaturalWandererPetSession): Promise<boolean> {
    const key = `pet:battle-active:${session.playerName}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const active = await kv.get<string>(key);
        if (active === session.token) {
            if (await publishExactNx(key, session.token, TOKEN_TTL_SECONDS)) return true;
            continue;
        }
        if (active) {
            const proof = await kv.get(`pet:battle-token:${session.playerName}:${active}`);
            if (proof !== null) return false;
            await kv.delIfEqual(key, active).catch(() => false);
            continue;
        }
        if (await publishExactNx(key, session.token, TOKEN_TTL_SECONDS)) return true;
    }
    return false;
}

function battleTokenData(session: NaturalWandererPetSession) {
    return {
        playerName: session.playerName,
        opponentLevel: Math.max(1, Math.min(100, Math.floor(Number(session.opponentPets[0].level) || 1))),
        rewardRyo: petArenaRyoRewardForTeam(session.opponentPets),
        reportKey: session.reportKey,
        seed: session.seed,
        mode: '1v1',
        createdAt: session.createdAt,
        playerPetIds: session.playerPetIds,
        opponentPetIds: session.opponentPets.map((pet) => pet.id),
        wanderer: session.wanderer,
        wandererParticipatingPets: session.playerPets,
        settlementPolicy: 'casual-no-progression',
        authoritativeOutcome: session.outcome,
    };
}

export async function startNaturalWandererPetSession(
    playerName: string,
    body: Record<string, unknown>,
): Promise<NaturalWandererPetStartResult> {
    const request = cleanRequest(body);
    if ('error' in request) return { ok: false, status: 400, error: request.error };

    const mutation = await mutatePlayerSave(playerName, async ({ record: save, character }) => {
        const key = sessionKey(playerName, request.wandererId);
        const rawExisting = await kv.get(key);
        let session = parseNaturalWandererPetSession(rawExisting);
        let resumed = session !== null;
        if (rawExisting !== null && !session) {
            return { ok: false as const, status: 409, error: 'The retained wanderer duel proof is malformed.' };
        }
        if (session && !sameSessionRequest(session, playerName, request.wandererId, request.sector, request.playerPetId)) {
            return { ok: false as const, status: 409, error: 'This wanderer is already bound to a different pet duel.' };
        }

        const redeemed = Array.isArray(character.redeemedPetBattleTokens)
            ? character.redeemedPetBattleTokens.filter((entry): entry is string => typeof entry === 'string')
            : [];
        if (session && redeemed.includes(session.token)) {
            return { ok: false as const, status: 409, error: 'This wanderer duel has already been settled.' };
        }

        const alreadyApplied = session
            ? Number(record(character.wandererCooldowns)?.[request.wandererId]) === session.cooldownUntil
                && Number(record(character.wandererMoves)?.[request.wandererId]) === session.moveToSector
            : false;
        if (!alreadyApplied) {
            if (savedCurrentSector(save) !== request.sector) {
                return { ok: false as const, status: 409, error: 'You are not in that sector.' };
            }
            const presence = sectorPresenceBlock(playerName, request.sector);
            if (presence) return { ok: false as const, status: presence.status, error: presence.error };
            const at = session?.createdAt ?? Date.now();
            const natural = exactNaturalWanderer(character, request.wandererId, request.sector, at);
            if (!natural) {
                return { ok: false as const, status: 409, error: 'That exact current wanderer is not offering a pet duel.' };
            }
            if (session && (natural.id !== session.wanderer.archetypeId || natural.name !== session.wanderer.name)) {
                return { ok: false as const, status: 409, error: 'The retained wanderer roster proof no longer matches.' };
            }
            if (!selectedPlayerPet(character, request.playerPetId)) {
                return { ok: false as const, status: 409, error: 'The selected stored pet is no longer available.' };
            }
            const savedCooldown = currentWandererCooldownUntil(character, request.wandererId, Date.now());
            if (!session && savedCooldown) {
                return { ok: false as const, status: 409, error: 'That wanderer has already moved on.' };
            }
        }

        if (!session) {
            const candidate = buildSession(
                playerName,
                character,
                request.wandererId,
                request.sector,
                request.playerPetId,
                Date.now(),
            );
            if (!candidate) {
                return { ok: false as const, status: 409, error: 'The exact wanderer duel could not be reconstructed.' };
            }
            let claimed = false;
            try {
                claimed = await kv.set(key, candidate, { nx: true, ex: WANDERER_ENCOUNTER_COOLDOWN_SECONDS }) === 'OK';
            } catch (error) {
                const readback = parseNaturalWandererPetSession(await kv.get(key).catch(() => null));
                if (!readback || !isDeepStrictEqual(readback, candidate)) throw error;
                claimed = true;
            }
            session = parseNaturalWandererPetSession(await kv.get(key));
            if (!session || !sameSessionRequest(session, playerName, request.wandererId, request.sector, request.playerPetId)) {
                return { ok: false as const, status: 409, error: 'Another immutable wanderer duel proof won the start race.' };
            }
            resumed = !claimed || !isDeepStrictEqual(session, candidate);
        }

        const tokenPublished = await publishExactNx(tokenKey(session), battleTokenData(session), TOKEN_TTL_SECONDS);
        if (!tokenPublished) {
            return { ok: false as const, status: 409, error: 'The wanderer battle token conflicts with its immutable session.' };
        }
        if (!await claimActiveBattle(session)) {
            return { ok: false as const, status: 409, error: 'Finish or settle your active pet battle first.' };
        }

        const claim = await claimWandererUseCooldown(
            kv,
            playerName,
            request.wandererId,
            Date.now(),
            session.proofId,
            session.createdAt,
        );
        if (!claim.ok || claim.cooldownUntil !== session.cooldownUntil) {
            await kv.delIfEqual(`pet:battle-active:${playerName}`, session.token).catch(() => false);
            return { ok: false as const, status: 409, error: 'That wanderer has already moved on.' };
        }

        const next = withWandererUseState(character, request.wandererId, session.createdAt, request.sector);
        const applied = Number(record(character.wandererCooldowns)?.[request.wandererId]) === session.cooldownUntil
            && Number(record(character.wandererMoves)?.[request.wandererId]) === session.moveToSector;
        return {
            ok: true as const,
            character: applied ? character : next.character,
            value: { session, resumed },
            write: !applied,
        };
    });

    if (!mutation.ok) return mutation;
    return {
        ok: true,
        session: mutation.value.session,
        resumed: mutation.value.resumed,
        character: mutation.character,
        _saveVersion: mutation._saveVersion,
    };
}
