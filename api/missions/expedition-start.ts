import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { safeName, cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { masteryBonus, masteryHasCapstone } from '../_profession-mastery.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { activeBreedingParentIds } from '../pet/_pet-busy.js';
import { activeCarriedPetIds, PET_CAP_SUB } from '../_entitlements.js';
import { claimPetLifecycleLease } from '../pet/_active-battle-lease.js';

/*
 * /api/missions/expedition-start  — POST only
 *
 * Mints a single-use token for a pet expedition. Pet expeditions are otherwise
 * entirely client-driven, so /api/missions/report-pet-event used to grant Ryo +
 * premium drops (Fate Shards) + Tamer XP purely on the client's claim — a
 * zero-effort farm bounded only by the daily cap. This endpoint couples the
 * reward to a real expedition: the client must mint a token at launch (consuming
 * a daily-mint slot) and can only redeem it after the expedition's real duration
 * has elapsed (see report-pet-event's time-gate), turning "12 free fabricated
 * claims/day" into "12 actually-run expeditions/day".
 *
 * The reward-relevant fields (expType, duration, petLevel) are sealed into the
 * token here so the redeemer can't tamper with them. Crucially the duration is
 * DERIVED from expType server-side, so a client can't pair scout's high Ryo
 * multiplier with ruins' 4h duration.
 *
 * Token: `pet-exp-token:<player>:<uuid>` = { playerName, petId, expType,
 * durationMinutes, petLevel, mintedAt, endsAt }, TTL = 5h (covers the 4h max
 * expedition + collect slack). Single-use: report-pet-event deletes it on redeem.
 *
 * Body: { playerName, petId?, expType }. Legacy `petLevel` input is ignored;
 * reward level always comes from the saved pet selected by `petId`.
 *
 * The burst limit follows the supporter carried-pet cap so every eligible pet
 * can be launched back-to-back without weakening the separate 12/day ceiling.
 * + a hard 12/day mint cap (matches report-pet-event's MAX_EXPEDITIONS_PER_DAY).
 */

const VALID_EXPEDITION_TYPES = ['scout', 'forage', 'ruins'] as const;
type ExpType = typeof VALID_EXPEDITION_TYPES[number];

// Canonical duration per expedition type (minutes). DERIVED here, never taken
// from the client — mirrors petExpeditionOptions in shinobij.client/src/data/
// pet-config.ts (45m / 2h / 4h). Keep in sync with that table.
const EXP_DURATION_MINUTES: Record<ExpType, number> = { scout: 45, forage: 120, ruins: 240 };

// Matches report-pet-event.MAX_EXPEDITIONS_PER_DAY — the daily reward ceiling.
const MAX_EXPEDITION_STARTS_PER_DAY = 12;
const EXPEDITION_DAILY_COUNT_TTL_SECONDS = 25 * 60 * 60;
// 7 days: must comfortably outlast the longest expedition (4h) PLUS however
// long a player takes to come back and collect (they may close the game for
// days). The endsAt time-gate, single-use deletion, and 12/day mint cap are the
// real bounds — a generous TTL just avoids voiding a legitimately-earned reward.
const EXPEDITION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

function utcDateKey(): string {
    return new Date().toISOString().slice(0, 10);
}

async function releaseFailedStartReservation(dailyKey: string, tokenKey: string | null): Promise<void> {
    let tokenCleanupError: unknown = null;
    if (tokenKey) {
        try {
            // This key contains this request's random id, so cleanup cannot
            // erase a successor token minted by a later successful request.
            await kv.del(tokenKey);
        } catch (error) {
            tokenCleanupError = error;
        }
    }

    let counterCleanupError: unknown = null;
    try {
        // Another request may have incremented after this one reserved. Adjust
        // the current aggregate under the same lock instead of restoring a
        // stale pre-increment snapshot.
        await withKvLock(dailyKey, async () => {
            const current = Math.max(0, Math.floor(Number((await kv.get<number>(dailyKey)) ?? 0) || 0));
            if (current <= 1) await kv.del(dailyKey);
            else await kv.set(dailyKey, current - 1, { ex: EXPEDITION_DAILY_COUNT_TTL_SECONDS });
        }, { failClosed: true });
    } catch (error) {
        counterCleanupError = error;
    }

    if (tokenCleanupError && counterCleanupError) {
        throw new AggregateError([tokenCleanupError, counterCleanupError], 'Failed to release expedition start reservation.');
    }
    if (tokenCleanupError) throw tokenCleanupError;
    if (counterCleanupError) throw counterCleanupError;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Pre-auth rate limit so spam at unknown names also throttles.
    const bodyPeek = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const peekName: string | undefined = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!enforceRateLimit(req, res, 'expedition-start', PET_CAP_SUB, 30_000, peekName)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = safeName(String(body.playerName ?? ''));
        const expType = (body.expType && VALID_EXPEDITION_TYPES.includes(body.expType) ? body.expType : null) as ExpType | null;
        const petIdRaw = typeof body.petId === 'string' ? body.petId.trim().slice(0, 64) : '';
        const petId = /^[A-Za-z0-9:_-]+$/.test(petIdRaw) ? petIdRaw : '';

        if (!playerName) return res.status(400).json({ error: 'Invalid player name.' });
        if (!expType) return res.status(400).json({ error: 'Invalid expedition type.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only start your own expeditions.' });
        }
        const lifecycleLease = await claimPetLifecycleLease(kv, playerName, 'expedition');
        if (!lifecycleLease) {
            return res.status(409).json({ error: 'pet-is-in-active-battle', message: 'Finish or settle your active pet battle before starting an expedition.' });
        }
        try {

        // Pet Tamers earn FULL expedition currency/Tamer rewards. Non-Tamers earn
        // nothing from expeditions normally — EXCEPT once a pet is fully maxed
        // (level >= maxLevel), when it earns HALF a Tamer's base ryo + half the
        // base drop chances (and no pet XP/stats, which a maxed pet can't gain).
        // Both paths are token-gated so the currency stays server-authoritative.
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = record?.character as Record<string, unknown> | undefined;
        const isTamer = char?.profession === 'petTamer';
        // Verify the pet's REAL level from the save for every profession. Reward
        // inputs must never let even a Pet Tamer forge a stronger expedition pet.
        const pets = Array.isArray(char?.pets) ? (char.pets as Array<Record<string, unknown>>) : [];
        const thePet = petId ? pets.find((p) => p && p.id === petId) : undefined;
        const realLevel = Number(thePet?.level ?? 0);
        const realMaxLevel = Number(thePet?.maxLevel ?? 100);
        const petMaxed = !!thePet && realLevel >= realMaxLevel;
        if (!thePet) return res.status(404).json({ error: 'Pet not found.' });
        if (!activeCarriedPetIds(char, pets).includes(petId)) {
            return res.status(409).json({
                error: 'pet-preserved-overflow',
                message: 'Move this companion into the carried roster through the Sanctuary before starting an expedition.',
            });
        }
        if (activeBreedingParentIds(char ?? {}, Date.now()).has(petId)) return res.status(409).json({ error: 'This pet is in the breeding barn.' });
        if (realLevel < 20) return res.status(409).json({ error: 'Pet must reach level 20.' });
        if (thePet.training || thePet.expedition) return res.status(409).json({ error: 'Pet is already busy.' });
        // Half rate for the non-Tamer maxed-pet path; full rate for Pet Tamers.
        const rewardScale = isTamer ? 1 : petMaxed ? 0.5 : 0;
        // Seal only the authoritative saved level used by the Ryo formula.
        const sealedPetLevel = Math.max(1, Math.min(100, Math.floor(realLevel)));

        // Daily mint cap (separate counter from report-pet-event's claim cap;
        // a mint without a redeem still counts so the two can't be played off
        // each other).
        const today = utcDateKey();
        const dailyKey = `pet-exp-start-count:${playerName}:${today}`;
        // Read-check-increment under a lock so concurrent -start calls can't both
        // read N and both write N+1, slipping past the cap on the boundary
        // (mirrors report-raid.ts). Defense-in-depth only — the real currency
        // payout in report-pet-event has its own locked claim cap. Fail closed on
        // lock contention here because rollback must adjust this exact aggregate,
        // never a value concurrently written by another launch.
        // Caravan Master capstone raises the daily reward cap by 2; mirror it on
        // the mint cap so the extra tokens can actually be minted.
        const caravanBonus = masteryHasCapstone(char?.profession, char?.masterySpec, 'caravan-master') ? 2 : 0;
        const capCheck = await withKvLock(dailyKey, async () => {
            const startedToday = Number((await kv.get<number>(dailyKey)) ?? 0);
            if (startedToday >= MAX_EXPEDITION_STARTS_PER_DAY + caravanBonus) {
                return { capped: true as const };
            }
            const intendedCount = startedToday + 1;
            try {
                const result = await kv.set(dailyKey, intendedCount, { ex: EXPEDITION_DAILY_COUNT_TTL_SECONDS });
                if (result !== 'OK') throw new Error('expedition-daily-reservation-failed');
            } catch (error) {
                // Plain SET can commit and then lose its acknowledgement. The
                // daily lock makes an exact readback authoritative for this
                // writer, so later save cleanup still knows whether to decrement.
                const readback = await kv.get<number>(dailyKey).catch(() => null);
                if (Number(readback) !== intendedCount) throw error;
            }
            return { capped: false as const, reserved: true as const };
        }, { failClosed: true });
        if (capCheck.capped) {
            return res.status(200).json({ ok: true, petTamer: isTamer, reason: 'daily-mint-cap', token: null });
        }

        const durationMinutes = EXP_DURATION_MINUTES[expType];
        const mintedAt = Date.now();
        const endsAt = mintedAt + durationMinutes * 60_000;

        // Seal the Pet Tamer mastery reward multipliers (Expeditioner path) into
        // the token so the redeemer can't tamper with them and they're fixed at
        // launch-time spec. PvE currency only. Non-Tamers get no mastery (×1).
        const expRewardMult = isTamer ? 1 + masteryBonus(char?.profession, char?.masterySpec, 'expRewardPct') / 100 : 1;
        const expMaterialMult = isTamer ? 1 + masteryBonus(char?.profession, char?.masterySpec, 'expMaterialPct') / 100 : 1;

        const tokenId = randomUUID().replace(/-/g, '');
        const tokenKey = `pet-exp-token:${playerName}:${tokenId}`;
        const releaseArtifacts = async () => {
            if (capCheck.reserved) await releaseFailedStartReservation(dailyKey, tokenKey);
            else await kv.del(tokenKey);
        };
        const mutation = await (async () => {
            try {
                await kv.set(tokenKey, {
                    playerName,
                    petId: petId || undefined,
                    expType,
                    durationMinutes,
                    petLevel: sealedPetLevel,
                    mintedAt,
                    endsAt,
                    expRewardMult,
                    expMaterialMult,
                    // Reward scale (1 = full Tamer, 0.5 = non-Tamer maxed pet) and whether
                    // this is a Tamer token, both sealed so the redeemer pays accordingly.
                    rewardScale,
                    tamer: isTamer,
                }, { ex: EXPEDITION_TOKEN_TTL_SECONDS });
                return await mutatePlayerSave(playerName, ({ character }) => {
                    const storedPets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
                    const currentIndex = storedPets.findIndex((pet) => String(pet?.id ?? '') === petId);
                    if (currentIndex < 0) return { ok: false as const, status: 404, error: 'Pet not found.' };
                    if (!activeCarriedPetIds(character, storedPets).includes(petId)) {
                        return { ok: false as const, status: 409, error: 'pet-preserved-overflow' };
                    }
                    const currentPet = storedPets[currentIndex];
                    if (activeBreedingParentIds(character, mintedAt).has(petId)) return { ok: false as const, status: 409, error: 'This pet is in the breeding barn.' };
                    if (currentPet.training || currentPet.expedition) return { ok: false as const, status: 409, error: 'Pet is already busy.' };
                    const nextPets = storedPets.map((pet, i) => i === currentIndex ? {
                        ...pet,
                        expedition: {
                            type: expType, startedAt: mintedAt, endsAt, durationMs: durationMinutes * 60_000, token: tokenId,
                            // Durable, server-owned fallback authority. The generic save
                            // sanitizer preserves expedition state from the stored pet.
                            serverSeal: { petLevel: sealedPetLevel, expRewardMult, expMaterialMult, rewardScale, tamer: isTamer },
                        },
                    } : pet);
                    return { ok: true as const, character: { ...character, pets: nextPets }, value: { petId } };
                });
            } catch (error) {
                // A thrown CAS acknowledgement is ambiguous until the
                // authoritative save is read back. If this exact token landed
                // (even with a later autosave version), treat the start as
                // committed and retain both its daily slot and reward token.
                // If readback itself fails, preserve the artifacts so a
                // possibly-committed expedition never loses reward authority.
                let recoveredRecord: Record<string, unknown> | null;
                try {
                    recoveredRecord = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                } catch {
                    throw error;
                }
                const recoveredCharacter = recoveredRecord?.character as Record<string, unknown> | undefined;
                const recoveredPets = Array.isArray(recoveredCharacter?.pets)
                    ? recoveredCharacter.pets as Array<Record<string, unknown>>
                    : [];
                const recoveredPet = recoveredPets.find((pet) => String(pet?.id ?? '') === petId);
                const recoveredExpedition = recoveredPet?.expedition as Record<string, unknown> | undefined;
                if (recoveredRecord && recoveredCharacter && recoveredExpedition?.token === tokenId) {
                    return {
                        ok: true as const,
                        value: { petId },
                        record: recoveredRecord,
                        character: recoveredCharacter,
                        _saveVersion: Number(recoveredRecord._saveVersion ?? 0),
                    };
                }
                await releaseArtifacts();
                throw error;
            }
        })();
        if (!mutation.ok) {
            await releaseArtifacts();
            return res.status(mutation.status).json({ error: mutation.error });
        }

        return res.status(200).json({ ok: true, petTamer: isTamer, token: tokenId, durationMinutes, endsAt, character: mutation.character, _saveVersion: mutation._saveVersion });
        } finally {
            await lifecycleLease.release();
        }
    } catch (err) {
        console.error('[missions/expedition-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
