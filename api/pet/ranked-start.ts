import { randomInt } from 'node:crypto';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import {
    chooseAuthoritativeRankedPet,
    claimPetRankedStartingPair,
    commitPetRankedStartingPair,
    isPetRankedMatchId,
    petRankedMatchIdFromStartingLease,
    petRankedActiveKey,
    petRankedQueueMatchKey,
    resolveAuthoritativePetRankedMatch,
    releasePetRankedStartingPair,
    validateReciprocalPetRankedQueueMatch,
    type PetRankedQueueMatch,
    type ServerResolvedPetRankedToken,
} from './_ranked-engine.js';
import {
    PET_RANKED_DISABLED_REASON,
    petRankedStartsEnabled,
    settlePetRankedMatchDurably,
} from './_ranked-settlement.js';
import {
    loadPetRankedAuthorityToken,
    getPetRankedJournal,
    petRankedRecoveryKey,
} from './_ranked-journal.js';
import {
    assertPetRankedPreparationAdmitted,
    completePetRankedPreparation,
    ensurePetRankedSeasonGate,
    findPetRankedPreparationForPlayer,
    loadPetRankedPreparation,
    makePetRankedPreparation,
    readPetRankedSeasonGateFresh,
    reservePetRankedPreparation,
    type PetRankedPreparation,
} from './_ranked-preparation.js';

/*
 * /api/pet/ranked-start — POST only.
 *
 * This is a PRIVATE, fail-closed ranked authority path. The authenticated
 * player must already own one half of a reciprocal pairing minted by the pet
 * ranked queue. Request-body opponent, pet, seed, rating, outcome, and reward
 * fields are deliberately ignored. The server selects both entitlement-eligible
 * pets, runs the deterministic duel, admits one immutable preparation in the
 * current season epoch, and settles both ratings before returning a replay
 * seed. A lost response resumes that same preparation; it can never mint a
 * second seed for the pairing.
 */

type StartResult =
    | { status: 200; token: ServerResolvedPetRankedToken; resumed: boolean }
    | { status: 409 | 503; error: string };

const lock = <T>(key: string, action: () => Promise<T>): Promise<T> =>
    withKvLock(key, action, { failClosed: true });
const RANKED_SEASON_CURRENT_KEY = 'ranked:season:current';

function tokenNames(token: ServerResolvedPetRankedToken): [string, string] {
    return [safeName(token.a), safeName(token.b)];
}

function tokenMatchesPair(
    token: ServerResolvedPetRankedToken | null,
    matchId: string,
    players: readonly [string, string],
): token is ServerResolvedPetRankedToken {
    if (!token || token.matchId !== matchId) return false;
    const actual = tokenNames(token).sort();
    const expected = [...players].map(safeName).sort();
    return actual[0] === expected[0] && actual[1] === expected[1];
}

function publicStartBody(token: ServerResolvedPetRankedToken, playerName: string, resumed: boolean) {
    const meIsA = safeName(token.a) === safeName(playerName);
    return {
        ok: true,
        matchToken: token.matchId,
        opponentName: meIsA ? token.b : token.a,
        seed: token.seed,
        playerPetId: meIsA ? token.aPetId : token.bPetId,
        opponentPetId: meIsA ? token.bPetId : token.aPetId,
        engineVersion: token.resolution.engineVersion,
        settled: true,
        ...(resumed ? { resumed: true } : {}),
        // Outcome, digest, rating snapshots, and rating reward stay private.
    };
}

async function settleStoredToken(token: ServerResolvedPetRankedToken): Promise<void> {
    await settlePetRankedMatchDurably(kv, {
        matchToken: token.matchId,
        token,
        lock,
    });
}

async function settlePreparation(preparation: PetRankedPreparation): Promise<StartResult> {
    const journal = await getPetRankedJournal(kv, preparation.matchId);
    if (journal?.state !== 'completed') {
        // A stale starter may resume after rollover already completed and
        // removed this admission. Only unresolved work is required to remain in
        // the exact season gate; completed replay can finish compaction safely.
        await assertPetRankedPreparationAdmitted(kv, preparation);
        const claimed = await commitPetRankedStartingPair(
            kv,
            [preparation.a, preparation.b],
            preparation.matchId,
        );
        if (!claimed.ok) {
            return { status: 503, error: 'This admitted ranked match is waiting for a participant battle lease. Retry shortly.' };
        }
    }
    await settleStoredToken(preparation.token);
    await completePetRankedPreparation(kv, preparation);
    await clearQueuePair([preparation.a, preparation.b], preparation.matchId);
    return { status: 200, token: preparation.token, resumed: true };
}

/**
 * Legacy short tokens are recoverable, but may not open an unregistered
 * journal behind a closing season scan. Existing journals are already durable;
 * a token with no journal must first win admission in the current open epoch.
 */
async function settleAuthorityToken(token: ServerResolvedPetRankedToken): Promise<StartResult> {
    const journal = await getPetRankedJournal(kv, token.matchId);
    if (journal) {
        await settleStoredToken(token);
        await clearQueuePair(tokenNames(token), token.matchId);
        return { status: 200, token, resumed: true };
    }
    const [gate, season] = await Promise.all([
        readPetRankedSeasonGateFresh(kv),
        kv.get<{ id?: unknown }>(RANKED_SEASON_CURRENT_KEY),
    ]);
    if (!gate
        || gate.state !== 'open'
        || gate.seasonId !== Number(season?.id)) {
        return { status: 409, error: 'The ranked season is closing; recovery will resume with the transition.' };
    }
    const preparation = await reservePetRankedPreparation(
        kv,
        makePetRankedPreparation(token, { seasonId: gate.seasonId, epoch: gate.epoch }),
    );
    return settlePreparation(preparation);
}

async function clearQueuePair(players: readonly [string, string], matchId: string): Promise<void> {
    await Promise.all(players.map(async (name) => {
        const key = petRankedQueueMatchKey(name);
        const current = await kv.get<unknown>(key).catch(() => null);
        if (!current || typeof current !== 'object' || Array.isArray(current)) return;
        if ((current as { matchId?: unknown }).matchId !== matchId) return;
        const tombstone = `pet-ranked-queue-cleared:${matchId}`;
        try {
            if (!await kv.compareSet(key, current, tombstone, { ex: 2 })) return;
        } catch (error) {
            if (await kv.get<string>(key).catch(() => null) !== tombstone) throw error;
        }
        // CAS already fenced the exact old pairing. Deletion is only cosmetic;
        // if its acknowledgement is lost, the two-second tombstone self-clears.
        await kv.delIfEqual(key, tombstone).catch(() => false);
    }));
}

async function resumeActive(playerName: string): Promise<StartResult | null> {
    const activeLease = await kv.get<string>(petRankedActiveKey(playerName));
    const recovery = activeLease
        ? null
        : await kv.get<string>(petRankedRecoveryKey(playerName));
    const prepared = await findPetRankedPreparationForPlayer(kv, playerName);
    const startingMatchId = petRankedMatchIdFromStartingLease(activeLease);
    const active = startingMatchId ?? activeLease ?? recovery ?? prepared?.matchId;
    if (!active) return null;
    if (isPetRankedMatchId(active)) {
        return lock(`pet-ranked-start:${active}`, async (): Promise<StartResult | null> => {
            const preparation = prepared?.matchId === active
                ? prepared
                : await loadPetRankedPreparation(kv, active);
            if (preparation) {
                if (preparation.a !== playerName && preparation.b !== playerName) {
                    return { status: 409, error: 'The ranked preparation belongs to a different participant pair.' };
                }
                return settlePreparation(preparation);
            }
            if (startingMatchId === active) {
                // The process died after reversible lease preflight but before
                // economic admission. No outcome exists; release both exact
                // sentinels and let the reciprocal pairing start cleanly.
                const queueMine = await kv.get<PetRankedQueueMatch>(petRankedQueueMatchKey(playerName));
                const opponent = safeName(queueMine?.opponent ?? '');
                if (opponent) {
                    await releasePetRankedStartingPair(kv, [playerName, opponent], active);
                }
                return null;
            }
            // Re-read authority only after acquiring the same match lock used by
            // token minting. A concurrent start cannot have its first durable
            // lease mistaken for an orphan and deleted before its token lands.
            const current = await loadPetRankedAuthorityToken(kv, active);
            if (current) {
                if (!tokenNames(current).includes(playerName)) {
                    return { status: 409, error: 'The active ranked match belongs to a different participant pair.' };
                }
                return settleAuthorityToken(current);
            }

            // Never guess that a shared ranked lease is orphaned merely because
            // its later journal is absent. New starts always have a durable
            // preparation; legacy/corrupt rows fail closed for operator repair.
            return { status: 409, error: 'The ranked preparation is pending recovery.' };
        });
    }
    return { status: 409, error: 'Finish or settle your active pet battle first.' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    if (!(await enforceRateLimitKv(req, res, 'pet-ranked-start', 12, 60_000, identity.name))) return;

    try {
        const me = identity.name;
        const resumed = await resumeActive(me);
        if (resumed) {
            if (resumed.status !== 200) return res.status(resumed.status).json({ error: resumed.error });
            return res.status(200).json(publicStartBody(resumed.token, me, true));
        }

        // The rollout switch blocks only fresh admission. Recovery is checked
        // first so either authenticated participant can help a durable preclaim
        // or partial settlement forward during an emergency disable/rollback.
        if (!petRankedStartsEnabled()) {
            return res.status(503).json({ error: PET_RANKED_DISABLED_REASON });
        }

        const season = await kv.get<{ id?: unknown }>(RANKED_SEASON_CURRENT_KEY);
        const seasonId = Number(season?.id);
        if (!Number.isSafeInteger(seasonId) || seasonId <= 0) {
            return res.status(503).json({ error: 'A ranked season is not active.' });
        }
        await ensurePetRankedSeasonGate(kv, seasonId, Date.now());

        const mine = await kv.get<PetRankedQueueMatch>(petRankedQueueMatchKey(me));
        const opponent = safeName(mine?.opponent ?? '');
        const theirs = opponent
            ? await kv.get<PetRankedQueueMatch>(petRankedQueueMatchKey(opponent))
            : null;
        const pairing = validateReciprocalPetRankedQueueMatch(me, mine, theirs);
        if (!pairing.ok) {
            return res.status(409).json({ error: 'A fresh reciprocal server-ranked pairing is required.' });
        }

        const players = [me, pairing.opponent].sort() as [string, string];
        const result = await lock(`pet-ranked-start:${pairing.matchId}`, async (): Promise<StartResult> => {
            const existingPreparation = await loadPetRankedPreparation(kv, pairing.matchId);
            if (existingPreparation) {
                if (existingPreparation.a !== players[0] || existingPreparation.b !== players[1]) {
                    return { status: 409, error: 'The ranked preparation does not match this pairing.' };
                }
                return settlePreparation(existingPreparation);
            }
            // A concurrent caller may already have won the NX receipt. Reuse it
            // only if it is bound to this exact server pairing.
            const existing = await loadPetRankedAuthorityToken(kv, pairing.matchId);
            if (existing) {
                if (!tokenMatchesPair(existing, pairing.matchId, players)) {
                    return { status: 409, error: 'The ranked match receipt does not match this pairing.' };
                }
                return settleAuthorityToken(existing);
            }

            // Re-read both queue records inside the match lock so a stale browser
            // cannot race a leave/requeue and resolve an obsolete opponent.
            const [lockedMine, lockedTheirs] = await Promise.all([
                kv.get<PetRankedQueueMatch>(petRankedQueueMatchKey(me)),
                kv.get<PetRankedQueueMatch>(petRankedQueueMatchKey(pairing.opponent)),
            ]);
            const lockedPairing = validateReciprocalPetRankedQueueMatch(me, lockedMine, lockedTheirs);
            if (!lockedPairing.ok || lockedPairing.matchId !== pairing.matchId) {
                return { status: 409, error: 'The server-ranked pairing expired or changed.' };
            }

            try {
                const gate = await readPetRankedSeasonGateFresh(kv);
                const currentSeason = await kv.get<{ id?: unknown }>(RANKED_SEASON_CURRENT_KEY);
                if (!gate
                    || gate.state !== 'open'
                    || gate.seasonId !== seasonId
                    || Number(currentSeason?.id) !== seasonId) {
                    return { status: 409, error: 'The ranked season is closing; wait for the next season.' };
                }

                // Reversible preflight comes before save snapshots, simulation,
                // and season admission. A foreign/second-key conflict releases
                // the first exact sentinel and returns 409 with no economic work.
                const starting = await claimPetRankedStartingPair(kv, players, pairing.matchId);
                if (!starting.ok) {
                    return { status: 409, error: 'One participant is already committed to another pet battle.' };
                }
                let preparationCommitted = false;

                try {

                    const [aSave, bSave] = await Promise.all([
                        kv.get<Record<string, unknown>>(`save:${players[0]}`),
                        kv.get<Record<string, unknown>>(`save:${players[1]}`),
                    ]);
                    const aCharacter = aSave?.character as Record<string, unknown> | undefined;
                    const bCharacter = bSave?.character as Record<string, unknown> | undefined;
                    const now = Date.now();
                    const aChoice = chooseAuthoritativeRankedPet(aCharacter, now);
                    const bChoice = chooseAuthoritativeRankedPet(bCharacter, now);
                    if (!aChoice.ok || !bChoice.ok) {
                        const reason = !aChoice.ok
                            ? aChoice.reason
                            : !bChoice.ok
                                ? bChoice.reason
                                : 'no-entitled-pet';
                        const error = reason === 'all-entitled-pets-busy'
                            ? 'Both players need an entitlement-eligible pet that is not breeding, training, or on an expedition.'
                            : 'Both players need an entitlement-eligible carried pet.';
                        return { status: 409, error };
                    }

                // The body is not parsed: even a forged opponent/pet/seed/outcome
                // is incapable of becoming an engine input.
                    const candidate = resolveAuthoritativePetRankedMatch({
                    matchId: pairing.matchId,
                    a: players[0],
                    b: players[1],
                    aCharacter: aCharacter!,
                    bCharacter: bCharacter!,
                    aPet: aChoice.pet,
                    bPet: bChoice.pet,
                    seed: randomInt(1, 0x80000000),
                    now,
                });
                    const proposed = makePetRankedPreparation(candidate, {
                        seasonId: gate.seasonId,
                        epoch: gate.epoch,
                    });
                    const preparation = await reservePetRankedPreparation(kv, proposed);
                    preparationCommitted = true;
                    const settled = await settlePreparation(preparation);
                    return settled.status === 200
                        ? { ...settled, resumed: preparation.tokenFingerprint !== proposed.tokenFingerprint }
                        : settled;
                } finally {
                    if (!preparationCommitted) {
                        await releasePetRankedStartingPair(kv, players, pairing.matchId);
                    }
                }
            } catch (writeOrSettleError) {
                throw writeOrSettleError;
            }
        });

        if (result.status !== 200) return res.status(result.status).json({ error: result.error });
        return res.status(200).json(publicStartBody(result.token, me, result.resumed));
    } catch (error) {
        console.error('[pet/ranked-start]', safeLogValue(error));
        return res.status(503).json({ error: 'Could not resolve the server-ranked pet match. Retry the same pairing.' });
    }
}
