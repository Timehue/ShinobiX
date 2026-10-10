import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from '../../shared/ranked-eligibility.js';
import {
    PET_RANKED_ACTIVE_REGISTRY_KEY,
    PET_RANKED_QUEUE_KEY,
    PET_RANKED_QUEUE_MATCH_TTL_SECONDS,
    isPetRankedQueueMatch,
    petRankedQueueMatchKey,
    petRankedCompletedKey,
    petRankedResultKey,
    rankedPetCompletedPointer,
    rankedPetResultReplay,
    petRankedSettlementIntentKey,
    isRankedPetSettlementIntent,
    isRankedPetMatchToken,
    pruneRankedPetActiveRegistry,
    type RankedPetActivePointer,
} from '../pet/_ranked-authority.js';
import { petRankedQueueEnabled, PET_RANKED_QUEUE_DISABLED_REASON } from '../pet/_ranked-settlement.js';
import { rankedArenaQueue } from '../_pet-tactics/ranked.js';
import { TacticsError } from '../_pet-tactics/engine.js';

/*
 * /api/pvp/pet-ranked-queue — live ranked pet matchmaking.
 *
 * New joins seal a Pet Arena room where both players issue private commands.
 * The queue never picks orders or a winner. Terminal settlement rates the
 * committed room through the existing durable two-save receipt path.
 * Retained tokens and receipts continue through historical recovery below.
 *
 * Actions (POST { action, ... }):
 *   join   → { state: 'queued' | 'active', control, roomId? }
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
    format: '2v2';
    petIds: string[];
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
        if (!slug || seen.has(slug) || !Number.isFinite(joinedAt) || entry.format !== '2v2'
            || !Array.isArray(entry.petIds) || entry.petIds.length !== 4
            || entry.petIds.some((id) => typeof id !== 'string' || !id)
            || !rankedLevelEligible(entry.level)
            || new Set(entry.petIds).size !== 4) return false;
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
    if (index >= 0) return { state: 'queued', queuePosition: index + 1, waiting: waiting.length, teamIds: waiting[index].petIds };
    // This link was minted with the token, independently of the prunable
    // reservation registry. An unfinished durable intent remains recoverable
    // even if unrelated matchmaking has pruned its expired reservation.
    const completed = rankedPetCompletedPointer(await kv.get(petRankedCompletedKey(slug)));
    if (completed) {
        const [live, intent] = await Promise.all([
            kv.get(`pet:ranked-token:${completed.matchToken}`),
            kv.get(petRankedSettlementIntentKey(completed.matchToken)),
        ]);
        // Read the completed receipt after the intent: settlement writes the
        // receipt before deleting the intent, so there is no read-order gap.
        const replay = rankedPetResultReplay(await kv.get(petRankedResultKey(completed.matchToken)));
        if (replay && (replay.a === slug || replay.b === slug)) return { state: 'completed', matchToken: completed.matchToken, opponent: completed.opponent };
        const token = isRankedPetMatchToken(live) ? live
            : isRankedPetSettlementIntent(intent) && intent.matchToken === completed.matchToken ? intent.token : null;
        if (token && (token.a === slug || token.b === slug)) {
            return { state: 'active', matchToken: completed.matchToken, opponent: completed.opponent, initiator: token.a === slug };
        }
    }
    return { state: 'idle' };
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
        if (!['join', 'leave', 'poll', 'acknowledge'].includes(action)) {
            return res.status(400).json({ error: 'Missing name or valid action.' });
        }
        res.setHeader('Cache-Control', 'private, no-store');

        // New ranked admissions are player-controlled. Only retained legacy
        // proofs fall through to their historical recovery/receipt path.
        if (action === 'join' && !petRankedQueueEnabled()) return res.status(503).json({ error: PET_RANKED_QUEUE_DISABLED_REASON });
        const arena = await rankedArenaQueue(me, action, body);
        if (action === 'join' || arena.state !== 'idle') return res.status(200).json(arena);

        if (action === 'poll') return res.status(200).json(await currentState(me));

        if (action === 'acknowledge') {
            const matchToken = typeof body.matchToken === 'string' ? body.matchToken : '';
            if (!/^[0-9a-f-]{36}$/i.test(matchToken)) return res.status(400).json({ error: 'A valid match token is required.' });
            await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
                const completed = rankedPetCompletedPointer(await kv.get(petRankedCompletedKey(me)));
                const replay = rankedPetResultReplay(await kv.get(petRankedResultKey(matchToken)));
                const paid = replay && (replay.a === me || replay.b === me);
                if (paid && completed?.matchToken === matchToken) await kv.del(petRankedCompletedKey(me));
                // A successful payout can precede failed pointer cleanup. Only
                // a durable completed receipt lets acknowledgment release that
                // reservation, and never a newer match's reservation.
                const registryRaw = await kv.get(PET_RANKED_ACTIVE_REGISTRY_KEY);
                const registry = pruneRankedPetActiveRegistry(registryRaw);
                if (pruneRankedPetActiveRegistry(registryRaw, 0)[me]?.matchToken === matchToken) {
                    if (paid) {
                        delete registry[me];
                        await kv.set(PET_RANKED_ACTIVE_REGISTRY_KEY, registry, { ex: 24 * 60 * 60 });
                    }
                }
            }, { failClosed: true });
            return res.status(200).json(await currentState(me));
        }

        if (action === 'leave') {
            await withKvLock(PET_RANKED_QUEUE_KEY, async () => {
                const waiting = pruneWaiting(await kv.get(PET_RANKED_WAITING_KEY), Date.now());
                const next = waiting.filter(entry => entry.slug !== me);
                if (next.length) await kv.set(PET_RANKED_WAITING_KEY, next, { ex: 15 * 60 });
                else await kv.del(PET_RANKED_WAITING_KEY);
            }, { failClosed: true });
            return res.status(200).json(await currentState(me));
        }

        return res.status(200).json({ state: 'idle' });
    } catch (error) {
        if (error instanceof TacticsError) return res.status(error.status).json({ error: error.message,
            ...(error.message === RANKED_LEVEL_WARNING ? { errorCode: 'ranked-level-locked' } : {}) });
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Ranked pet matchmaking is busy. Retry this request.', errorCode: 'ranked-pet-busy' });
        }
        console.error('[pvp/pet-ranked-queue]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
