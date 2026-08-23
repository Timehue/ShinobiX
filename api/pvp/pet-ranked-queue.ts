import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { ATTACKABLE_MIN_LEVEL, isBelowAttackableFloor } from '../_realtime/presence-gating.js';
import {
    PET_RANKED_ACTIVE_REGISTRY_KEY,
    PET_RANKED_QUEUE_KEY,
    PET_RANKED_QUEUE_MATCH_TTL_SECONDS,
    isPetRankedQueueMatch,
    petRankedQueueMatchKey,
    pruneRankedPetActiveRegistry,
    type PetRankedQueueMatch,
    type RankedPetActivePointer,
} from '../pet/_ranked-authority.js';
import { hasRankedReadyPet, petRatingOf } from '../pet/_ranked-eligibility.js';
import { petRankedQueueEnabled, PET_RANKED_QUEUE_DISABLED_REASON } from '../pet/_ranked-settlement.js';

/*
 * /api/pvp/pet-ranked-queue — live ranked pet matchmaking.
 *
 * This is the piece the ranked pet mode was missing. Everything downstream of a
 * pairing already existed and is server-authoritative:
 *
 *   /api/pet/ranked-start  mints ONE sealed match token for the pair
 *   /api/pet/ranked-watch  re-derives the rated fight for BOTH players
 *   settlement             rates that same derivation
 *
 * The old public queue was retired because it launched an unrelated no-reward
 * realtime duel, so what a player watched had no relationship to their Elo.
 * That is fixed: resolveRankedPetDuel is the single resolution, and this queue
 * only produces the reciprocal pairing records ranked-start already requires.
 * It never resolves a fight, mints a seed, or writes a rating.
 *
 * Actions (POST { action, ... }):
 *   join   → { state: 'queued' | 'paired' }
 *   poll   → current state, including the active match token once minted
 *   leave  → drop out of the waiting list
 */

export const PET_RANKED_WAITING_KEY = `${PET_RANKED_QUEUE_KEY}:waiting`;
/** A waiting entry older than this is treated as an abandoned tab. */
export const PET_RANKED_WAITING_TTL_MS = 3 * 60_000;
/** Widen by this each second waited, so a lone high-rated player still matches. */
const RATING_WINDOW_PER_SECOND = 25;
const RATING_WINDOW_BASE = 150;

export type PetRankedWaitingEntry = {
    slug: string;
    rating: number;
    level: number;
    joinedAt: number;
};

function ratingWindow(entry: PetRankedWaitingEntry, now: number): number {
    return RATING_WINDOW_BASE + Math.max(0, (now - entry.joinedAt) / 1_000) * RATING_WINDOW_PER_SECOND;
}

/**
 * Both sides must accept the gap, so a freshly-joined player is never dragged
 * into a mismatch by someone who has been waiting a long time.
 */
export function petRankedPairable(a: PetRankedWaitingEntry, b: PetRankedWaitingEntry, now: number): boolean {
    if (a.slug === b.slug) return false;
    const gap = Math.abs(a.rating - b.rating);
    return gap <= ratingWindow(a, now) && gap <= ratingWindow(b, now);
}

export function pruneWaiting(value: unknown, now: number): PetRankedWaitingEntry[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((raw): raw is PetRankedWaitingEntry => {
        const entry = raw as Partial<PetRankedWaitingEntry>;
        const slug = safeName(entry?.slug ?? '');
        const joinedAt = Number(entry?.joinedAt);
        if (!slug || seen.has(slug) || !Number.isFinite(joinedAt)) return false;
        if (joinedAt > now + 60_000 || now - joinedAt >= PET_RANKED_WAITING_TTL_MS) return false;
        seen.add(slug);
        return true;
    });
}

/** Oldest-waiting first, so nobody starves behind a churn of new joiners. */
export function selectPetRankedOpponent(
    joiner: PetRankedWaitingEntry,
    waiting: readonly PetRankedWaitingEntry[],
    now: number,
): PetRankedWaitingEntry | null {
    const ordered = [...waiting].sort((a, b) => a.joinedAt - b.joinedAt);
    return ordered.find(candidate => petRankedPairable(joiner, candidate, now)) ?? null;
}

function queueMatch(opponent: PetRankedWaitingEntry, initiator: boolean, pairId: string, now: number): PetRankedQueueMatch {
    return {
        opponent: opponent.slug,
        opponentElo: Math.round(opponent.rating),
        opponentLevel: Math.round(opponent.level),
        initiator,
        createdAt: now,
        pairId,
    };
}

async function currentState(slug: string): Promise<Record<string, unknown>> {
    const [pairing, registryRaw, waitingRaw] = await Promise.all([
        kv.get(petRankedQueueMatchKey(slug)),
        kv.get(PET_RANKED_ACTIVE_REGISTRY_KEY),
        kv.get(PET_RANKED_WAITING_KEY),
    ]);
    const registry = pruneRankedPetActiveRegistry(registryRaw, Date.now());
    const active: RankedPetActivePointer | undefined = registry[slug];
    if (active) {
        // The pair already minted its sealed token; both players watch and settle
        // from here. The non-initiator learns the token through this pointer.
        return {
            state: 'active',
            matchToken: active.matchToken,
            opponent: active.opponent,
            initiator: active.initiator,
        };
    }
    if (isPetRankedQueueMatch(pairing)) {
        return {
            state: 'paired',
            opponent: pairing.opponent,
            opponentElo: pairing.opponentElo,
            // Only the initiator may call /api/pet/ranked-start; the other side
            // waits for the pointer above to appear.
            initiator: pairing.initiator,
            expiresAt: Number(pairing.createdAt) + PET_RANKED_QUEUE_MATCH_TTL_SECONDS * 1_000,
        };
    }
    const waiting = pruneWaiting(waitingRaw, Date.now());
    const index = waiting.findIndex(entry => entry.slug === slug);
    return index >= 0
        ? { state: 'queued', queuePosition: index + 1, waiting: waiting.length }
        : { state: 'idle' };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const claimedName = typeof body?.name === 'string' ? body.name : '';
        const identity = await authedPlayerOrAdmin(req, claimedName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (identity.admin) return res.status(400).json({ error: 'Ranked pet matchmaking requires a player identity.' });
        if (claimedName && identity.name !== safeName(claimedName)) {
            return res.status(403).json({ error: 'Cannot queue as another player.' });
        }
        const me = identity.name;
        if (!(await enforceRateLimitKv(req, res, 'pet-ranked-queue', 60, 60_000, me))) return;

        const action = String(body.action ?? 'poll');
        if (!['join', 'leave', 'poll'].includes(action)) {
            return res.status(400).json({ error: 'Missing name or valid action.' });
        }
        res.setHeader('Cache-Control', 'private, no-store');

        if (action === 'poll') return res.status(200).json(await currentState(me));

        if (action === 'leave') {
            await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
                const waiting = pruneWaiting(await kv.get(PET_RANKED_WAITING_KEY), Date.now());
                const next = waiting.filter(entry => entry.slug !== me);
                if (next.length) await kv.set(PET_RANKED_WAITING_KEY, next, { ex: 15 * 60 });
                else await kv.del(PET_RANKED_WAITING_KEY);
            }, { failClosed: true });
            return res.status(200).json(await currentState(me));
        }

        if (!petRankedQueueEnabled()) {
            return res.status(503).json({ error: PET_RANKED_QUEUE_DISABLED_REASON, errorCode: 'ranked-pet-queue-disabled' });
        }

        const save = await kv.get<Record<string, unknown>>(`save:${me}`);
        const character = (save?.character ?? null) as Record<string, unknown> | null;
        if (!character) return res.status(404).json({ error: 'Your save was not found.', errorCode: 'save-not-found' });
        // Newcomer protection, read from the authoritative save exactly as the
        // shinobi ranked queue does.
        const level = Math.floor(Number(character.level ?? 0)) || 0;
        if (isBelowAttackableFloor(level)) {
            return res.status(403).json({
                error: `You must reach level ${ATTACKABLE_MIN_LEVEL} before entering ranked battles.`,
                errorCode: 'ranked-level-locked',
            });
        }
        // Admit only a fighter ranked-start would accept, or the pairing burns.
        if (!hasRankedReadyPet(save)) {
            return res.status(409).json({
                error: 'Carry a pet that is not breeding, training, or on an expedition.',
                errorCode: 'no-ranked-pet',
            });
        }

        const paired = await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
            const now = Date.now();
            const registry = pruneRankedPetActiveRegistry(await kv.get(PET_RANKED_ACTIVE_REGISTRY_KEY), now);
            if (registry[me]) return { conflict: 'You already have an active ranked pet match.' } as const;

            const existingPairing = await kv.get(petRankedQueueMatchKey(me));
            if (isPetRankedQueueMatch(existingPairing)) return { alreadyPaired: true } as const;

            const waiting = pruneWaiting(await kv.get(PET_RANKED_WAITING_KEY), now)
                .filter(entry => !registry[entry.slug]);
            const joiner: PetRankedWaitingEntry = {
                slug: me,
                rating: petRatingOf(save),
                level,
                joinedAt: waiting.find(entry => entry.slug === me)?.joinedAt ?? now,
            };
            const opponent = selectPetRankedOpponent(joiner, waiting.filter(entry => entry.slug !== me), now);
            if (!opponent) {
                const next = [...waiting.filter(entry => entry.slug !== me), joiner];
                await kv.set(PET_RANKED_WAITING_KEY, next, { ex: 15 * 60 });
                return { queued: true } as const;
            }

            // The joiner initiates; ranked-start requires exactly one initiator
            // and an identical createdAt on both reciprocal records.
            const pairId = randomUUID();
            await Promise.all([
                kv.set(petRankedQueueMatchKey(me), queueMatch(opponent, true, pairId, now), { ex: PET_RANKED_QUEUE_MATCH_TTL_SECONDS }),
                kv.set(petRankedQueueMatchKey(opponent.slug), queueMatch(joiner, false, pairId, now), { ex: PET_RANKED_QUEUE_MATCH_TTL_SECONDS }),
            ]);
            const remaining = waiting.filter(entry => entry.slug !== me && entry.slug !== opponent.slug);
            if (remaining.length) await kv.set(PET_RANKED_WAITING_KEY, remaining, { ex: 15 * 60 });
            else await kv.del(PET_RANKED_WAITING_KEY);
            return { pairedWith: opponent.slug } as const;
        }, { failClosed: true });

        if ('conflict' in paired) {
            return res.status(409).json({ error: paired.conflict, errorCode: 'already-active' });
        }
        return res.status(200).json(await currentState(me));
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Ranked pet matchmaking is busy. Retry this request.', errorCode: 'ranked-pet-busy' });
        }
        console.error('[pvp/pet-ranked-queue]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
