import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { DEFAULT_RANKED_RATING } from '../_ranked-rating.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { activeBreedingParentIds } from './_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import {
    PET_RANKED_ACTIVE_REGISTRY_KEY,
    PET_RANKED_AUTHORITY,
    PET_RANKED_QUEUE_KEY,
    PET_RANKED_QUEUE_MATCH_TTL_SECONDS,
    PET_RANKED_TOKEN_TTL_SECONDS,
    isPetRankedQueueMatch,
    isRankedPetStartClaim,
    petRankedQueueMatchKey,
    petRankedStartClaimKey,
    pruneRankedPetActiveRegistry,
    type RankedPetActivePointer,
    type RankedPetMatchToken,
    type RankedPetStartClaim,
} from './_ranked-authority.js';

/*
 * /api/pet/ranked-start - POST { opponentName, petId? }
 *
 * Compatibility-only queue binding, not a public direct-challenge endpoint.
 * The live public queue is retired because it launched an unrelated no-reward
 * realtime duel. This handler remains mounted only so a reciprocal pairing that
 * was already minted before retirement can become one server-seeded proof.
 *
 * A single registry record reserves BOTH participants before the token is
 * returned. That gives one-active-match protection without a half-reserved
 * player if a process fails between two independent pointer writes.
 */

const ACTIVE_REGISTRY_TTL_SECONDS = 24 * 60 * 60;

function petRatingOf(save: Record<string, unknown> | null): number {
    const character = (save?.character ?? null) as Record<string, unknown> | null;
    const rating = Number(character?.petRankedRating);
    return Number.isFinite(rating) ? rating : DEFAULT_RANKED_RATING;
}

function rankedPetUnavailable(character: Record<string, unknown>, pet: Record<string, unknown>): boolean {
    const id = String(pet.id ?? '');
    return !id
        || activeBreedingParentIds(character).has(id)
        || !!pet.training
        || !!pet.expedition;
}

function selectRankedPet(character: Record<string, unknown>, requestedId = ''): Record<string, unknown> | null {
    const pets = activeCarriedPets<Record<string, unknown>>(character);
    const requested = requestedId ? pets.find((pet) => String(pet?.id ?? '') === requestedId) : undefined;
    const active = pets.find((pet) => String(pet?.id ?? '') === String(character.activePetId ?? ''));
    const selected = requested ?? active ?? pets.find((pet) => !rankedPetUnavailable(character, pet));
    return selected && !rankedPetUnavailable(character, selected) ? selected : null;
}

function pointerFor(
    claim: RankedPetStartClaim,
    opponent: string,
    initiator: boolean,
): RankedPetActivePointer {
    return {
        matchToken: claim.matchToken,
        pairId: claim.pairId,
        opponent,
        initiator,
        createdAt: claim.token.createdAt,
        expiresAt: claim.expiresAt,
    };
}

function claimNamesMatch(claim: RankedPetStartClaim, me: string, opponent: string): boolean {
    return claim.token.a === me
        && claim.token.b === opponent
        && claim.token.authority === PET_RANKED_AUTHORITY;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) {
        return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    }
    if (!(await enforceRateLimitKv(req, res, 'pet-ranked-start', 12, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const me = identity.name;
        const opponent = safeName(typeof body.opponentName === 'string' ? body.opponentName : '');
        const petId = typeof body.petId === 'string' ? body.petId.slice(0, 64) : '';
        if (!opponent) return res.status(400).json({ error: 'Missing opponentName.' });
        if (opponent === me) return res.status(400).json({ error: 'You cannot start a ranked match against yourself.' });

        const result = await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
            const now = Date.now();
            const registry = pruneRankedPetActiveRegistry(
                await kv.get(PET_RANKED_ACTIVE_REGISTRY_KEY),
                now,
            );

            // Lost-response replay. The reciprocal queue records are consumed
            // only after this shared registry and the proof are both durable.
            const active = registry[me];
            if (active) {
                if (active.opponent !== opponent || active.initiator !== true) {
                    return { status: 409, body: { error: 'You already have an active ranked pet match.' } };
                }
                const claim = await kv.get<RankedPetStartClaim>(petRankedStartClaimKey(active.pairId));
                if (!isRankedPetStartClaim(claim)
                    || claim.matchToken !== active.matchToken
                    || !claimNamesMatch(claim, me, opponent)) {
                    return { status: 409, body: { error: 'Your active ranked match authority is incomplete. Wait for it to expire; new live ranked matchmaking is unavailable.' } };
                }
                if (await kv.get(`pet:ranked-result:${claim.matchToken}`)) {
                    return { status: 409, body: { error: 'That ranked pet match is already settled.' } };
                }
                // Repair either half after a process/storage failure. Updating the
                // registry is one write, so both names point at the same token.
                registry[me] = pointerFor(claim, opponent, true);
                registry[opponent] = pointerFor(claim, me, false);
                await kv.set(PET_RANKED_ACTIVE_REGISTRY_KEY, registry, { ex: ACTIVE_REGISTRY_TTL_SECONDS });
                const remainingTtl = Math.max(1, Math.ceil((claim.expiresAt - now) / 1000));
                await kv.set(`pet:ranked-token:${claim.matchToken}`, claim.token, { ex: remainingTtl });
                return {
                    status: 200,
                    body: { ok: true, replayed: true, matchToken: claim.matchToken, opponentName: opponent, seed: claim.token.seed },
                };
            }

            const [myMatch, opponentMatch] = await Promise.all([
                kv.get(petRankedQueueMatchKey(me)),
                kv.get(petRankedQueueMatchKey(opponent)),
            ]);
            if (!isPetRankedQueueMatch(myMatch)
                || !isPetRankedQueueMatch(opponentMatch)
                || myMatch.opponent !== opponent
                || opponentMatch.opponent !== me
                || myMatch.initiator !== true
                || opponentMatch.initiator !== false
                || myMatch.pairId !== opponentMatch.pairId
                || Number(myMatch.createdAt) !== Number(opponentMatch.createdAt)) {
                return { status: 409, body: { error: 'A retained reciprocal ranked pairing is required; new live ranked matchmaking is unavailable.' } };
            }
            const age = now - Number(myMatch.createdAt);
            if (age < -5_000 || age > PET_RANKED_QUEUE_MATCH_TTL_SECONDS * 1_000) {
                return { status: 409, body: { error: 'That ranked pet compatibility pairing expired; new live ranked matchmaking is unavailable.' } };
            }
            if (registry[opponent]) {
                return { status: 409, body: { error: 'Your opponent already has an active ranked pet match.' } };
            }

            const claimKey = petRankedStartClaimKey(myMatch.pairId);
            let claim = await kv.get<RankedPetStartClaim>(claimKey);
            if (claim && (!isRankedPetStartClaim(claim) || !claimNamesMatch(claim, me, opponent))) {
                return { status: 409, body: { error: 'That queue pairing has conflicting match authority.' } };
            }

            if (!claim) {
                // Both fighters must have a save and an available pet. No request-
                // body seed or opponent snapshot is ever accepted.
                const [meSave, opponentSave] = await Promise.all([
                    kv.get<Record<string, unknown>>(`save:${me}`),
                    kv.get<Record<string, unknown>>(`save:${opponent}`),
                ]);
                if (!meSave?.character) return { status: 400, body: { error: 'Your character save was not found.' } };
                if (!opponentSave?.character) return { status: 404, body: { error: 'Opponent save not found.' } };
                const meCharacter = meSave.character as Record<string, unknown>;
                const opponentCharacter = opponentSave.character as Record<string, unknown>;
                const myPet = selectRankedPet(meCharacter, petId);
                const opponentPet = selectRankedPet(opponentCharacter);
                if (!myPet || !opponentPet) {
                    return { status: 409, body: { error: 'Both players need a pet that is not training, breeding, or on an expedition.' } };
                }

                const matchToken = randomUUID();
                const token: RankedPetMatchToken = {
                    authority: PET_RANKED_AUTHORITY,
                    pairId: myMatch.pairId,
                    a: me,
                    b: opponent,
                    aRating: petRatingOf(meSave),
                    bRating: petRatingOf(opponentSave),
                    aPet: myPet,
                    bPet: opponentPet,
                    seed: randomInt(1, 2 ** 31),
                    createdAt: now,
                };
                const candidate: RankedPetStartClaim = {
                    version: 1,
                    matchToken,
                    pairId: myMatch.pairId,
                    token,
                    expiresAt: now + PET_RANKED_TOKEN_TTL_SECONDS * 1_000,
                };
                const placed = await kv.set(claimKey, candidate, { nx: true, ex: PET_RANKED_TOKEN_TTL_SECONDS });
                claim = placed ? candidate : await kv.get<RankedPetStartClaim>(claimKey);
                if (!isRankedPetStartClaim(claim) || !claimNamesMatch(claim, me, opponent)) {
                    throw new Error('Could not establish one ranked pet start claim.');
                }
            }

            // One atomic registry write reserves both participants before the
            // proof can be returned or a second pairing can start.
            registry[me] = pointerFor(claim, opponent, true);
            registry[opponent] = pointerFor(claim, me, false);
            await kv.set(PET_RANKED_ACTIVE_REGISTRY_KEY, registry, { ex: ACTIVE_REGISTRY_TTL_SECONDS });
            await kv.set(`pet:ranked-token:${claim.matchToken}`, claim.token, { ex: PET_RANKED_TOKEN_TTL_SECONDS });
            await Promise.allSettled([
                kv.del(petRankedQueueMatchKey(me)),
                kv.del(petRankedQueueMatchKey(opponent)),
            ]);
            return {
                status: 200,
                body: { ok: true, matchToken: claim.matchToken, opponentName: opponent, seed: claim.token.seed },
            };
        }, { failClosed: true });

        return res.status(result.status).json(result.body);
    } catch (error) {
        console.error('[pet/ranked-start]', error);
        if (error instanceof LockContendedError) {
            return res.status(503).json({ error: 'Ranked pet compatibility recovery is busy. Please retry.' });
        }
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
