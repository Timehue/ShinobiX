import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { mintPlayerRankedMatchToken } from '../_ranked-match-token.js';
import {
    findPlayerRankedAdmissionForPlayer,
    cancelExpiredOrphanPlayerRankedAdmissions,
    PLAYER_RANKED_ACTIVE_ORPHAN_TTL_MS,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    readPetRankedSeasonGateFresh,
    releaseExpiredQueuedPlayerRankedAdmissions,
    releaseQueuedPlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import { recordCancelledPlayerRankedAdmission } from './_player-ranked-journal.js';
import { recoverCompletedPlayerRankedFinalizations } from './_ranked-terminal-effects.js';
import {
    PLAYER_RANKED_V2_DISABLED_MESSAGE,
    playerRankedV2AdmissionsEnabled,
} from './_player-ranked-rollout.js';
import { isBelowAttackableFloor, ATTACKABLE_MIN_LEVEL } from '../_realtime/presence-gating.js';
import { hasRecentIpOrFpOverlapStrict } from '../_player-ips.js';

export type QueueEntry = {
    name: string;
    level: number;
    elo: number;
    joinedAt: number;
    /** Last liveness poll; joinedAt is deliberately never refreshed. */
    lastPolledAt?: number;
};

const QUEUE_KEY = 'pvp:ranked-queue';
const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 60 * 1000;           // Remove entries older than 60s (must re-queue)
// Durable per-player match record (audit #10). When two players are matched,
// BOTH get one — so the player who didn't poll first still discovers the match
// on their next poll instead of silently vanishing from the queue. Short TTL so
// a match that never turns into a fight re-opens matchmaking for both sides.
const MATCH_TTL_SECONDS = 30;
const matchKey = (slug: string) => `${QUEUE_KEY}:match:${slug}`;
const CURRENT_SEASON_KEY = 'ranked:season:current';
// Ranked measures combat choices, not who happened to cross a progression
// breakpoint. Keep a small widening window for queue health, but never cross a
// stat/mastery-cap tier and never widen into the old level-10-vs-100 outcome.
const LEVEL_BAND_BASE = 2;
const LEVEL_BAND_MAX = 5;
const LEVEL_BAND_OPEN_INTERVAL_MS = 30_000;

function combatProgressionBand(level: number): number {
    const value = Math.max(1, Math.min(100, Math.floor(Number(level) || 1)));
    if (value >= 80) return 4;
    if (value >= 50) return 3;
    if (value >= 30) return 2;
    if (value >= 15) return 1;
    return 0;
}

export function rankedLevelBand(joinedAt: number, now: number): number {
    const waitMs = Math.max(0, now - joinedAt);
    return Math.min(LEVEL_BAND_MAX, LEVEL_BAND_BASE + Math.floor(waitMs / LEVEL_BAND_OPEN_INTERVAL_MS));
}

export function selectRankedOpponent(me: QueueEntry, others: QueueEntry[], now: number): QueueEntry | undefined {
    const myBand = rankedLevelBand(me.joinedAt, now);
    return others
        .filter((candidate) => {
            const mutuallyAllowedBand = Math.min(myBand, rankedLevelBand(candidate.joinedAt, now));
            return combatProgressionBand(candidate.level) === combatProgressionBand(me.level)
                && Math.abs(candidate.level - me.level) <= mutuallyAllowedBand;
        })
        .sort((a, b) => {
            const eloGap = Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo);
            return eloGap || a.joinedAt - b.joinedAt || a.name.localeCompare(b.name);
        })[0];
}

function queueEntryIsActive(entry: QueueEntry, now: number): boolean {
    return now - (entry.lastPolledAt ?? entry.joinedAt) < STALE_MS;
}

function rankedPvpActionAllowedDuringSettlement(action: string): boolean {
    return ['join', 'leave', 'poll'].includes(action);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Return queue status for a specific player (don't expose other names)
        const name = typeof req.query.name === 'string' ? safeName(req.query.name) : '';
        const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
        const now = Date.now();
        const active = queue.filter(e => queueEntryIsActive(e, now));
        const inQueue = active.some(e => e.name === name);
        res.setHeader('Cache-Control', 'no-store');
        const enabled = playerRankedV2AdmissionsEnabled();
        return res.status(200).json({ enabled, inQueue: enabled && inQueue, queueSize: enabled ? active.length : 0 });
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body as {
                name?: string;
                level?: number;
                elo?: number;
                action?: 'join' | 'leave' | 'poll';
            };
            if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

            // Require auth, body name must match identity.
            const identity = await authedPlayerOrAdmin(req, name);
            if (!identity) return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== safeName(name)) {
                return res.status(403).json({ error: 'Cannot queue as another player.' });
            }

            // Throttle join/leave/poll per identity (keyed on name, not raw IP, so
            // two players behind one NAT aren't starved). Every other PvP write path
            // is rate-limited; without this, spam serializes on the shared QUEUE_KEY
            // lock and degrades matchmaking latency for everyone. ~60/min comfortably
            // covers the client's ~2-3s poll cadence with headroom.
            // Keep the action allowlist explicit. Ranked consumables and rating
            // are settled from the sealed battle record by claim-rewards.
            if (!rankedPvpActionAllowedDuringSettlement(action)) {
                return res.status(400).json({ error: 'Unknown ranked queue action.' });
            }
            if (action !== 'leave') {
                // The kill switch/default-off gate prevents every new admission
                // write, but must not strand already-authoritative work. Help
                // terminal sagas forward and retire expired queued/unjoined
                // capabilities before returning disabled; this never adds to
                // the queue, consumes a rate-limit slot, or mints a token.
                await recoverCompletedPlayerRankedFinalizations(
                    kv,
                    (saveKey, action) => withKvLock(saveKey, action, { failClosed: true }),
                    { eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, kv)) },
                );
                const recoveryNow = Date.now();
                await releaseExpiredQueuedPlayerRankedAdmissions(
                    kv,
                    recoveryNow - PLAYER_RANKED_ADMISSION_TTL_MS,
                );
                const cancelled = await cancelExpiredOrphanPlayerRankedAdmissions(
                    kv,
                    recoveryNow - PLAYER_RANKED_ACTIVE_ORPHAN_TTL_MS,
                    recoveryNow,
                );
                for (const admission of cancelled) {
                    await recordCancelledPlayerRankedAdmission(kv, admission, { reason: 'orphan-session-missing' });
                }
            }
            if (action !== 'leave' && !playerRankedV2AdmissionsEnabled()) {
                return res.status(503).json({ enabled: false, error: PLAYER_RANKED_V2_DISABLED_MESSAGE });
            }
            if (!identity.admin && !(await enforceRateLimitKv(req, res, 'ranked-queue', 60, 60_000, identity.name))) return;

            if (action !== 'leave') {
                const [gate, season] = await Promise.all([
                    readPetRankedSeasonGateFresh(kv),
                    kv.get<{ id?: unknown }>(CURRENT_SEASON_KEY),
                ]);
                if (!gate || gate.state !== 'open' || gate.seasonId !== Number(season?.id)) {
                    return res.status(409).json({ error: 'The ranked season is closing; wait for the next season.' });
                }
            } else {
                const queued = await findPlayerRankedAdmissionForPlayer(kv, safeName(name));
                if (queued?.phase === 'queued') {
                    await releaseQueuedPlayerRankedAdmission(kv, queued.matchId, safeName(name));
                }
            }

            // Pre-derive server-side level/elo for the join path before
            // entering the lock so the lock body stays fast.
            let serverLevel = 1;
            let serverElo = 1000;
            if (action === 'join' && !identity.admin) {
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char) {
                        if (typeof char.level === 'number') serverLevel = char.level;
                        if (typeof char.rankedRating === 'number') serverElo = char.rankedRating;
                        else if (typeof char.elo === 'number') serverElo = char.elo;
                    }
                } catch {
                    // best-effort; defaults apply
                }
                // #4 newcomer protection: sub-floor shinobi can't enter ranked —
                // it would match them against far stronger players for a free loss.
                // Gated on the authoritative save level read just above.
                if (isBelowAttackableFloor(serverLevel)) {
                    return res.status(403).json({
                        error: `You must reach level ${ATTACKABLE_MIN_LEVEL} before entering ranked battles.`,
                    });
                }
            }

            // Serialize join/leave/poll against the shared QUEUE_KEY blob so
            // two concurrent writers can't get→filter→push→set and silently
            // drop one of the writes. Self-healing on next poll (the dropped
            // entry re-queues), so this is defense-in-depth.
            const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(QUEUE_KEY, async () => {
                const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
                const now = Date.now();
                const active = queue.filter(e => queueEntryIsActive(e, now));

                if (action === 'leave') {
                    const filtered = active.filter(e => e.name !== safeName(name));
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(safeName(name))),  // drop any pending match too
                    ]);
                    return { status: 200, body: { inQueue: false, queueSize: filtered.length, match: null } };
                }

                if (action === 'join') {
                    // Remove existing entry for this player, then add fresh
                    const filtered = active.filter(e => e.name !== safeName(name));
                    const entry: QueueEntry = {
                        name: safeName(name),
                        level: serverLevel,
                        elo: serverElo,
                        joinedAt: now,
                        lastPolledAt: now,
                    };
                    filtered.push(entry);
                    await Promise.all([
                        kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS }),
                        kv.del(matchKey(safeName(name))),  // clear any stale prior match
                    ]);
                    return { status: 200, body: { inQueue: true, queueSize: filtered.length, match: null } };
                }

                if (action === 'poll') {
                    // #10: if a prior poll (mine OR the opponent's) already matched
                    // me, return that durable match instead of re-matching — so the
                    // side that didn't poll first still gets the match rather than a
                    // bare inQueue:false that looks like "you left".
                    const player = safeName(name);
                    const myMatch = await kv.get<Record<string, unknown>>(matchKey(player));
                    const gate = await readPetRankedSeasonGateFresh(kv);
                    const matchAdmission = myMatch && typeof myMatch.matchId === 'string'
                        ? gate?.playerAdmissions.find((entry) => entry.matchId === myMatch.matchId)
                        : null;
                    if (myMatch && matchAdmission?.phase === 'queued') {
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };
                    }

                    // A queue response may have been lost after the season-gate
                    // admission committed but before one/both short match mirrors
                    // landed. Rebuild the exact same token/match from the gate.
                    const admitted = await findPlayerRankedAdmissionForPlayer(kv, player);
                    if (admitted?.phase === 'queued') {
                        const token = await mintPlayerRankedMatchToken({
                            a: admitted.a,
                            b: admitted.b,
                            aLevel: admitted.aLevel,
                            bLevel: admitted.bLevel,
                            aRating: admitted.aRating,
                            bRating: admitted.bRating,
                            now: admitted.createdAt,
                            matchId: admitted.matchId,
                        });
                        const opponentName = player === admitted.a ? admitted.b : admitted.a;
                        const playerIsA = player === admitted.a;
                        const recoveredMatch = {
                            opponent: opponentName,
                            opponentElo: playerIsA ? admitted.bRating : admitted.aRating,
                            opponentLevel: playerIsA ? admitted.bLevel : admitted.aLevel,
                            initiator: player < opponentName,
                            createdAt: admitted.createdAt,
                            matchId: token.matchId,
                            seasonId: token.seasonId,
                            seasonEpoch: token.seasonEpoch,
                        };
                        await kv.set(matchKey(player), recoveredMatch, { ex: MATCH_TTL_SECONDS });
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: recoveredMatch } };
                    }

                    const me = active.find(e => e.name === safeName(name));
                    if (!me) return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };

                    const others = active.filter(e => e.name !== me.name);
                    const opponent = selectRankedOpponent(me, others, now);
                    if (!opponent) {
                        // Refresh liveness without resetting joinedAt: the latter is
                        // the authoritative wait clock used by the 15-second widening
                        // schedule. Resetting it here kept the band permanently at 10.
                        const refreshed = active.map(e => e.name === me.name ? { ...e, lastPolledAt: now } : e);
                        await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    }
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    // Deterministic initiator (lexicographically smaller slug) so
                    // exactly ONE side sends the ranked challenge and the other
                    // waits for it — no double-challenge, no silent drop. Both get a
                    // durable match record so neither vanishes if a poll is missed.
                    const initiatorName = me.name < opponent.name ? me.name : opponent.name;
                    // The season-gate admission is the first durable commit. If
                    // close wins its CAS first, no token or public match exists.
                    const token = await mintPlayerRankedMatchToken({
                        a: me.name,
                        b: opponent.name,
                        aLevel: me.level,
                        bLevel: opponent.level,
                        aRating: me.elo,
                        bRating: opponent.elo,
                        now,
                    });
                    const common = {
                        createdAt: now,
                        matchId: token.matchId,
                        seasonId: token.seasonId,
                        seasonEpoch: token.seasonEpoch,
                    };
                    const matchForMe = { ...common, opponent: opponent.name, opponentElo: opponent.elo, opponentLevel: opponent.level, initiator: me.name === initiatorName };
                    const matchForOpp = { ...common, opponent: me.name, opponentElo: me.elo, opponentLevel: me.level, initiator: opponent.name === initiatorName };
                    await Promise.all([
                        kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS }),
                        kv.set(matchKey(me.name), matchForMe, { ex: MATCH_TTL_SECONDS }),
                        kv.set(matchKey(opponent.name), matchForOpp, { ex: MATCH_TTL_SECONDS }),
                    ]);

                    return { status: 200, body: { inQueue: false, queueSize: remaining.length, match: matchForMe } };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            });
            return res.status(out.status).json({
                enabled: playerRankedV2AdmissionsEnabled(),
                ...out.body,
            });
        } catch (err) {
            console.error('[pvp/ranked-queue]', safeLogValue(err));
            if (err instanceof Error && err.message.includes('ranked-season-admission-closed')) {
                return res.status(409).json({ error: 'The ranked season is closing; wait for the next season.' });
            }
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
