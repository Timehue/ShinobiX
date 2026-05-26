import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../../_storage.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import {
    applyLazyClanWarExpiry,
    CHALLENGE_EXPIRY_MS,
    clanWarKey,
    loadClanContext,
    MAX_PENDING_CHALLENGES,
    type ChallengeMode,
    type ClanChallenge,
    type ClanWar,
} from './_storage.js';

// POST /api/clan/war/challenge
// Body shapes:
//   { action: 'send',    warId, mode, fromPlayer2? }
//   { action: 'accept',  warId, challengeId, acceptedPlayer2? }
//   { action: 'decline', warId, challengeId }
//   { action: 'cancel',  warId, challengeId }
//
// All actions require auth + membership of the appropriate clan.
// Server stamps challenge IDs, timestamps, expiresAt, status.

const VALID_MODES: ReadonlySet<ChallengeMode> = new Set<ChallengeMode>(['pvp1v1', 'pvp2v2', 'pet1v1', 'pet2v2', 'tilecards']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    // 30 challenge ops/min/player is plenty — UI doesn't fire faster
    // than a click rate and prevents script abuse spamming the queue.
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'clan-war-challenge', 30, 60_000, identity.name))) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const action = String(body?.action ?? '').toLowerCase();
        const warId = String(body?.warId ?? '').trim();
        if (!warId) return res.status(400).json({ error: 'Missing warId.' });

        // The war key always uses the sorted-pair id, but the client
        // only sends the id (which is already sorted). So we rebuild
        // the key by prefix — the underlying KV key is `clan-war:<id>`.
        const key = `clan-war:${warId}`;

        const ctx = await loadClanContext(identity.admin ? '' : identity.name);

        const result = await withKvLock(key, async () => {
            const fresh = await kv.get<ClanWar>(key);
            if (!fresh) return { status: 404 as const, body: { error: 'War not found.' } };
            // Lazy-expire stale challenges + war before applying the action.
            const { war: war0, changed: didExpire } = applyLazyClanWarExpiry(fresh);
            let war = war0;
            if (war.endedAt) {
                if (didExpire) await kv.set(key, war);
                return { status: 409 as const, body: { error: 'War has ended.', war } };
            }

            if (action === 'send') {
                const mode = String(body?.mode ?? '') as ChallengeMode;
                if (!VALID_MODES.has(mode)) return { status: 400 as const, body: { error: 'Invalid mode.' } };
                if (!identity.admin && !ctx.clan) return { status: 403 as const, body: { error: 'You must be in a clan.' } };
                const fromClan = identity.admin ? String(body?.fromClan ?? '') : ctx.clan;
                if (!war.clans.includes(fromClan)) return { status: 403 as const, body: { error: 'Your clan is not in this war.' } };
                if (war.pendingChallenges.filter(c => c.fromClan === fromClan && c.status === 'pending').length >= 10) {
                    return { status: 429 as const, body: { error: 'Too many pending challenges from your clan. Wait for some to be accepted or expire.' } };
                }
                if (war.pendingChallenges.length >= MAX_PENDING_CHALLENGES) {
                    return { status: 429 as const, body: { error: 'Challenge queue is full. Wait for some to resolve.' } };
                }
                const needsPartner = mode === 'pvp2v2' || mode === 'pet2v2';
                const fromPlayer = identity.admin ? String(body?.fromPlayer ?? '') : ctx.name;
                const fromPlayer2Raw = needsPartner ? String(body?.fromPlayer2 ?? '').trim() : '';
                if (needsPartner && !fromPlayer2Raw) return { status: 400 as const, body: { error: 'Partner required for 2v2 challenge.' } };
                if (needsPartner && fromPlayer2Raw.toLowerCase() === fromPlayer.toLowerCase()) {
                    return { status: 400 as const, body: { error: 'Partner cannot be yourself.' } };
                }
                const now = Date.now();
                const challenge: ClanChallenge = {
                    id: `ch-${now}-${Math.random().toString(36).slice(2, 8)}`,
                    mode,
                    fromClan,
                    fromPlayer,
                    fromPlayer2: needsPartner ? fromPlayer2Raw : undefined,
                    createdAt: now,
                    status: 'pending',
                    expiresAt: now + CHALLENGE_EXPIRY_MS,
                    // Pet modes use a deterministic seed shared between both
                    // clients' simulations (matches the existing pet PvP flow).
                    petBattleSeed: (mode === 'pet1v1' || mode === 'pet2v2') ? now + Math.floor(Math.random() * 100000) : undefined,
                };
                war = {
                    ...war,
                    pendingChallenges: [...war.pendingChallenges, challenge],
                    updatedAt: now,
                };
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge } };
            }

            if (action === 'accept') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId && c.status === 'pending');
                if (!ch) return { status: 404 as const, body: { error: 'Challenge not found or already resolved.' } };
                const toClan = war.clans.find(c => c !== ch.fromClan);
                if (!toClan) return { status: 500 as const, body: { error: 'Invalid war record.' } };
                if (!identity.admin && ctx.clan !== toClan) {
                    return { status: 403 as const, body: { error: 'Only the defending clan can accept this challenge.' } };
                }
                const needsPartner = ch.mode === 'pvp2v2' || ch.mode === 'pet2v2';
                const acceptedPlayer = identity.admin ? String(body?.acceptedPlayer ?? '') : ctx.name;
                const acceptedPlayer2Raw = needsPartner ? String(body?.acceptedPlayer2 ?? '').trim() : '';
                if (needsPartner && !acceptedPlayer2Raw) return { status: 400 as const, body: { error: 'Partner required for 2v2 challenge.' } };
                if (needsPartner && acceptedPlayer2Raw.toLowerCase() === acceptedPlayer.toLowerCase()) {
                    return { status: 400 as const, body: { error: 'Partner cannot be yourself.' } };
                }
                const now = Date.now();
                // For PvP modes, stamp a battleId that the clients use to
                // optimistically open the PvpBattleScreen. The PvP session
                // itself is still created by /api/pvp/session (one of the
                // two players races to create it; the other follows via
                // the breadcrumb).
                const battleId = (ch.mode === 'pvp1v1' || ch.mode === 'pvp2v2')
                    ? `pvp-clanwar-${ch.id}`
                    : undefined;
                const updated: ClanChallenge = {
                    ...ch,
                    status: 'accepted',
                    acceptedAt: now,
                    acceptedPlayer,
                    acceptedPlayer2: needsPartner ? acceptedPlayer2Raw : undefined,
                    battleId,
                };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.map(c => c.id === ch.id ? updated : c),
                    updatedAt: now,
                };
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge: updated } };
            }

            if (action === 'decline' || action === 'cancel') {
                const challengeId = String(body?.challengeId ?? '');
                const ch = war.pendingChallenges.find(c => c.id === challengeId);
                if (!ch) return { status: 404 as const, body: { error: 'Challenge not found.' } };
                if (ch.status !== 'pending') return { status: 409 as const, body: { error: 'Challenge already resolved.' } };
                // 'cancel' = sender pulls back. 'decline' = defender refuses.
                if (action === 'cancel') {
                    if (!identity.admin && ctx.clan !== ch.fromClan) {
                        return { status: 403 as const, body: { error: 'Only the sending clan can cancel this challenge.' } };
                    }
                } else {
                    const toClan = war.clans.find(c => c !== ch.fromClan);
                    if (!identity.admin && ctx.clan !== toClan) {
                        return { status: 403 as const, body: { error: 'Only the defending clan can decline this challenge.' } };
                    }
                }
                const now = Date.now();
                const updated: ClanChallenge = { ...ch, status: action === 'cancel' ? 'cancelled' : 'expired', completedAt: now };
                war = {
                    ...war,
                    pendingChallenges: war.pendingChallenges.filter(c => c.id !== ch.id),
                    completedChallenges: [updated, ...war.completedChallenges].slice(0, 200),
                    updatedAt: now,
                };
                await kv.set(key, war);
                return { status: 200 as const, body: { war, challenge: updated } };
            }

            return { status: 400 as const, body: { error: `Unknown action: ${action}` } };
        });
        return res.status(result.status).json(result.body);
    } catch (err) {
        console.error('[clan/war/challenge]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
