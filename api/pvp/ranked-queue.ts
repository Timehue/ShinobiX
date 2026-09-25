import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { mintPlayerRankedMatchToken, restorePlayerRankedMatchTokenWithStore } from '../_ranked-match-token.js';
import {
    findPlayerRankedAdmissionForPlayer,
    cancelExpiredOrphanPlayerRankedAdmissions,
    PLAYER_RANKED_ACTIVE_ORPHAN_TTL_MS,
    PLAYER_RANKED_ADMISSION_TTL_MS,
    readPetRankedSeasonGateFresh,
    releaseExpiredQueuedPlayerRankedAdmissions,
    releaseQueuedPlayerRankedAdmission,
    type PetRankedSeasonGate,
    type PlayerRankedAdmission,
} from '../pet/_ranked-preparation.js';
import { recordCancelledPlayerRankedAdmission } from './_player-ranked-journal.js';
import { recoverCompletedPlayerRankedFinalizations } from './_ranked-terminal-effects.js';
import {
    PLAYER_RANKED_V2_DISABLED_MESSAGE,
} from './_player-ranked-rollout.js';
import { rankedSeasonAdmissionsPaused } from '../cron/_ranked-season.js';
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from '../../shared/ranked-eligibility.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { hasRecentIpOrFpOverlapStrict, stampPlayerIp } from '../_player-ips.js';

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
export function selectRankedOpponent(me: QueueEntry, others: QueueEntry[], _now: number): QueueEntry | undefined {
    // Ranked Format equalizes the combat tier, so character level is not a
    // matchmaking restriction. Prefer the nearest rating among active entries.
    return [...others]
        .sort((a, b) => {
            const eloGap = Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo);
            return eloGap || a.joinedAt - b.joinedAt || a.name.localeCompare(b.name);
        })[0];
}

function queueEntryIsActive(entry: QueueEntry, now: number): boolean {
    return now - (entry.lastPolledAt ?? entry.joinedAt) < STALE_MS;
}

/**
 * A player whose previous match still holds its season-gate admission cannot
 * be matched: the gate admits one match per player, so a mint for them can
 * only fail. `terminal` means that match is still settling (its claim, the
 * queue's own recovery, or the server-side settlement sweep finishes it);
 * `cancelled` means a no-contest is still being recorded.
 */
const RANKED_SETTLEMENT_PENDING_ERROR = 'Your last ranked match is still being settled. Queue again in a minute.';

function admissionsByPlayer(gate: PetRankedSeasonGate | null): Map<string, PlayerRankedAdmission> {
    const held = new Map<string, PlayerRankedAdmission>();
    for (const admission of gate?.playerAdmissions ?? []) {
        held.set(admission.a, admission);
        held.set(admission.b, admission);
    }
    return held;
}

function isSettlingAdmission(admission: PlayerRankedAdmission | undefined): boolean {
    return admission?.phase === 'terminal' || admission?.phase === 'cancelled';
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
        const [storedQueue, gate, season] = await Promise.all([
            kv.get<QueueEntry[]>(QUEUE_KEY),
            readPetRankedSeasonGateFresh(kv),
            kv.get<{ id?: unknown }>(CURRENT_SEASON_KEY),
        ]);
        const queue = storedQueue ?? [];
        const now = Date.now();
        const active = queue.filter(e => queueEntryIsActive(e, now) && rankedLevelEligible(e.level));
        const inQueue = active.some(e => e.name === name);
        res.setHeader('Cache-Control', 'no-store');
        const enabled = !!gate
            && gate.state === 'open'
            && gate.seasonId === Number(season?.id)
            && !(await rankedSeasonAdmissionsPaused(kv, gate.seasonId));
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
                // While an admin stop pauses new entries, do not strand
                // already-authoritative work. Help terminal sagas forward and
                // retire expired queued/unjoined capabilities before returning
                // disabled; this never adds to the queue or mints a token.
                await recoverCompletedPlayerRankedFinalizations(
                    kv,
                    (saveKey, action) => withKvLock(saveKey, action, { failClosed: true }),
                    {
                        eligible: async (a, b) => !(await hasRecentIpOrFpOverlapStrict(a, b, kv)),
                        onFailure: (matchId, error) => console.error(
                            '[pvp/ranked-queue] terminal recovery pending', matchId, safeLogValue(error),
                        ),
                    },
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
            const currentSeason = await kv.get<{ id?: unknown }>(CURRENT_SEASON_KEY);
            if (action !== 'leave' && await rankedSeasonAdmissionsPaused(kv, Number(currentSeason?.id))) {
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
            // Missing level data fails closed at the ranked-only admission gate.
            let serverIncapacitated = false;
            if (action === 'join') {
                // Record trusted connection evidence before this player can be
                // matched, even if their first heartbeat has not arrived yet.
                if (!identity.admin) await stampPlayerIp(req, identity.name);
                try {
                    const save = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
                    const char = (save?.character ?? null) as Record<string, unknown> | null;
                    if (char) {
                        if (typeof char.level === 'number') serverLevel = char.level;
                        if (typeof char.rankedRating === 'number') serverElo = char.rankedRating;
                        else if (typeof char.elo === 'number') serverElo = char.elo;
                        serverIncapacitated = isIncapacitated(char);
                    }
                } catch {
                    // best-effort; defaults apply
                }
                // An admitted fighter does not queue. Ranked seals FRESH vitals
                // (useCurrentVitals=false, api/pvp/session.ts), so a knocked-out
                // player used to queue and fight at full strength — the hospital
                // stay meant nothing to anyone who played ranked. Read from the
                // same authoritative save as the level gate below.
                if (serverIncapacitated) {
                    return res.status(409).json({
                        error: 'You are in the hospital. Recover before entering ranked battles.',
                        errorCode: 'hospitalized',
                    });
                }
                // Ranked requires level 11+ even though the general PvP floor is 10.
                // The authoritative save level, never the client body, decides.
                if (!rankedLevelEligible(serverLevel)) {
                    return res.status(403).json({
                        error: RANKED_LEVEL_WARNING,
                        errorCode: 'ranked-level-locked',
                    });
                }
            }

            // Serialize join/leave/poll against the shared QUEUE_KEY blob so
            // two concurrent writers can't get→filter→push→set and silently
            // drop one of the writes. Self-healing on next poll (the dropped
            // entry re-queues), so this is defense-in-depth. failClosed matches
            // every sibling queue (pet-ranked-queue.ts, _ranked-2v2.ts) — without
            // it, sustained contention would fall through and run this
            // read-modify-write UNLOCKED instead of throwing a retryable 500.
            const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(QUEUE_KEY, async () => {
                const queue = await kv.get<QueueEntry[]>(QUEUE_KEY) ?? [];
                const now = Date.now();
                const active = queue.filter(e => queueEntryIsActive(e, now) && rankedLevelEligible(e.level));

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
                    const player = safeName(name);
                    const filtered = active.filter(e => e.name !== player);
                    // One match per player. A held gate admission is never put
                    // back into the pairing pool, where every opponent's mint
                    // for this player could only fail.
                    const held = admissionsByPlayer(await readPetRankedSeasonGateFresh(kv)).get(player);
                    if (held) {
                        if (filtered.length !== active.length) {
                            await kv.set(QUEUE_KEY, filtered, { ex: KV_TTL_SECONDS });
                        }
                        if (isSettlingAdmission(held)) {
                            return {
                                status: 409,
                                body: {
                                    inQueue: false,
                                    queueSize: filtered.length,
                                    match: null,
                                    errorCode: 'ranked-settlement-pending',
                                    error: RANKED_SETTLEMENT_PENDING_ERROR,
                                },
                            };
                        }
                        // Queued or active: the match already exists. The poll
                        // this answer starts restores it (and its battle) from
                        // the gate, exactly as for a lost match mirror.
                        return {
                            status: 200,
                            body: { inQueue: true, queueSize: filtered.length, match: null, resumingMatch: true },
                        };
                    }
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
                    if (myMatch && matchAdmission?.phase === 'active' && matchAdmission.battleId) {
                        return {
                            status: 200,
                            body: {
                                inQueue: false,
                                queueSize: active.length,
                                match: { ...myMatch, battleId: matchAdmission.battleId },
                            },
                        };
                    }
                    if (myMatch && matchAdmission?.phase === 'queued') {
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: myMatch } };
                    }

                    // A queue response may have been lost after the season-gate
                    // admission committed but before one/both short match mirrors
                    // landed. Rebuild the exact same token/match from the gate.
                    const admitted = await findPlayerRankedAdmissionForPlayer(kv, player);
                    if (admitted && (admitted.phase === 'queued' || (admitted.phase === 'active' && admitted.battleId))) {
                        const token = await restorePlayerRankedMatchTokenWithStore(kv, admitted.matchId);
                        if (!token) return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };
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
                            ...(admitted.phase === 'active' ? { battleId: admitted.battleId } : {}),
                        };
                        await kv.set(matchKey(player), recoveredMatch, { ex: MATCH_TTL_SECONDS });
                        return { status: 200, body: { inQueue: false, queueSize: active.length, match: recoveredMatch } };
                    }
                    if (isSettlingAdmission(admitted ?? undefined)) {
                        // This player's last match still holds the gate. Leave
                        // the pool with a reason instead of searching forever.
                        const remaining = active.filter(e => e.name !== player);
                        if (remaining.length !== active.length) {
                            await kv.set(QUEUE_KEY, remaining, { ex: KV_TTL_SECONDS });
                        }
                        return {
                            status: 409,
                            body: {
                                inQueue: false,
                                queueSize: remaining.length,
                                match: null,
                                errorCode: 'ranked-settlement-pending',
                                error: RANKED_SETTLEMENT_PENDING_ERROR,
                            },
                        };
                    }

                    const me = active.find(e => e.name === player);
                    if (!me) return { status: 200, body: { inQueue: false, queueSize: active.length, match: null } };

                    // Never offer an opponent whose gate admission is still held
                    // (settling, or a player back in the queue mid-match): the
                    // mint below would refuse the pair and fail this poll.
                    const held = admissionsByPlayer(gate);
                    const others = active.filter(e => e.name !== me.name && !held.has(e.name));
                    const opponent = selectRankedOpponent(me, others, now);
                    // Refresh liveness without resetting joinedAt: the latter is
                    // the authoritative queue wait clock and Elo tie-breaker.
                    const keepSearching = async () => {
                        const refreshed = active.map(e => e.name === me.name ? { ...e, lastPolledAt: now } : e);
                        await kv.set(QUEUE_KEY, refreshed, { ex: KV_TTL_SECONDS });
                        return { status: 200, body: { inQueue: true, queueSize: active.length, match: null } };
                    };
                    if (!opponent) return keepSearching();
                    const remaining = active.filter(e => e.name !== me.name && e.name !== opponent.name);
                    // Deterministic initiator (lexicographically smaller slug) so
                    // exactly ONE side creates the authoritative ranked session;
                    // the other waits for its battle id — no duplicate sessions or
                    // silent drop. Both get a durable match record so neither
                    // vanishes if a poll is missed.
                    const initiatorName = me.name < opponent.name ? me.name : opponent.name;
                    // The season-gate admission is the first durable commit. If
                    // close wins its CAS first, no token or public match exists.
                    let token: Awaited<ReturnType<typeof mintPlayerRankedMatchToken>>;
                    try {
                        token = await mintPlayerRankedMatchToken({
                            a: me.name,
                            b: opponent.name,
                            aLevel: me.level,
                            bLevel: opponent.level,
                            aRating: me.elo,
                            bRating: opponent.elo,
                            now,
                        });
                    } catch (error) {
                        // Admissions are only minted under this queue lock, so
                        // only a lease that lapsed mid-poll can let another mint
                        // land after the gate read above. Nothing was reserved
                        // here; both players simply keep searching.
                        if (error instanceof Error && error.message === 'player-ranked-player-already-admitted') {
                            return keepSearching();
                        }
                        throw error;
                    }
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
            }, { failClosed: true });
            return res.status(out.status).json({
                enabled: true,
                ...out.body,
            });
        } catch (err) {
            console.error('[pvp/ranked-queue]', safeLogValue(err));
            if (err instanceof Error && err.message.includes('ranked-season-admission-paused')) {
                return res.status(503).json({ enabled: false, error: PLAYER_RANKED_V2_DISABLED_MESSAGE });
            }
            if (err instanceof Error && err.message.includes('ranked-season-admission-closed')) {
                return res.status(409).json({ error: 'The ranked season is closing; wait for the next season.' });
            }
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
