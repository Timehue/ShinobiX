import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, parseJsonBody, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { stampPlayerIp } from '../_player-ips.js';
import { recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from '../admin/moderation.js';
import { onlineStore } from '../_realtime/online-store.js';
import { stampPresenceBeat } from '../_realtime/_presence-beat.js';
import { normalizeSector, normalizeTile, slimPresenceCharacter, capTravelingUntil, toPlayerRecord } from '../_realtime/presence-input.js';
import { clearSleeperCamp } from '../_realtime/sleeper-camps.js';
import { getTravelLease, settleTravelLease, travelLeaseSectorAt } from '../_realtime/travel-lease.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { offlineNoticesKey, parseOfflineNotices, OFFLINE_NOTICES_TTL_SEC, type OfflineNotice } from './_offline-notices.js';
import { kageStakeRefundKey, parsePendingStakeRefunds, drainKageStakeRefunds } from '../village/_kage-inactivity.js';

// Presence now lives in the in-memory online store (api/_realtime/online-store.ts)
// instead of `presence:<name>` DB keys — no per-second DB read/write. The live
// roster comes from onlineStore.list(); writes from onlineStore.upsert(). The
// slim/cap/shape helpers live in ../_realtime/presence-input.ts so the WS
// presence path (api/_realtime/socket.ts) uses byte-for-byte the same logic.

/** Stable identity of one inbox entry (the inbox has no ids of its own). */
function noticeStamp(n: OfflineNotice): string {
    return `${n.kind}|${n.by}|${n.sector}|${n.at}|${n.amount ?? ''}|${n.total ?? ''}`;
}

/**
 * Clear EXACTLY the notices this beat delivered, under the inbox's own lock.
 *
 * The old `kv.del(noticesKey)` was unlocked and unconditional, so a notice
 * pushed between the mget and the delete — "you were KO'd by X", "a bounty was
 * placed on you", "your Kage stake was refunded" — was destroyed unread, and the
 * player never learned why their state changed. Comparing against what was
 * actually read keeps delivery one-shot in the happy path (the key is deleted
 * outright when nothing new arrived) while a concurrent push always survives.
 *
 * Best-effort by design: if the inbox is contended, the entries stay and the
 * next beat re-delivers them. A repeated notice is a far smaller failure than a
 * lost one.
 */
export async function consumeDeliveredNotices(key: string, delivered: readonly OfflineNotice[]): Promise<void> {
    if (delivered.length === 0) return;
    const seen = new Set(delivered.map(noticeStamp));
    try {
        await withKvLock(key, async () => {
            const current = parseOfflineNotices(await kv.get(key));
            const remaining = current.filter((n) => !seen.has(noticeStamp(n)));
            if (remaining.length === current.length) return;
            if (remaining.length === 0) await kv.del(key);
            else await kv.set(key, remaining, { ex: OFFLINE_NOTICES_TTL_SEC });
        }, { failClosed: true });
    } catch (err) {
        if (!(err instanceof LockContendedError)) throw err;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // 90/min per player heartbeat. The client beats once per second on the
    // exploring/combat screens (= 60/min), so the cap must sit above 60 with
    // headroom for clock jitter, retries, and the occasional double-fire on a
    // remount; 90 gives ~1.5x margin without opening the abuse window wide.
    // KV-backed so the window is authoritative across all Vercel lambda
    // instances — the previous in-process limiter let a player triggering
    // parallel invocations (cold-start fan-out) blow past the cap on individual
    // instances, which let the IP/fingerprint capture in this handler be hammered.
    const parsedBody = parseJsonBody(req.body);
    if (!parsedBody.ok) return res.status(400).json({ error: parsedBody.error });
    const bodyPeek = parsedBody.body as Record<string, unknown>;
    const peekName: string | undefined = typeof bodyPeek?.name === 'string' ? bodyPeek.name : undefined;
    if (!(await enforceRateLimitKv(req, res, 'heartbeat', 90, 60_000, peekName))) return;

    try {
        const body = bodyPeek; // reuse the rate-limit peek's parse — avoids a 2nd JSON.parse on the hottest endpoint
        const { name, sector, character, travelingUntil, inBattle, tile } = body as {
            name?: string;
            sector?: number;
            character?: unknown;
            travelingUntil?: number;
            inBattle?: boolean;
            tile?: number;
        };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        // Require that the heartbeat is from the named player (or admin).
        // Stops attackers from spoofing presence: setting inBattle=true to be
        // untouchable, faking travelingUntil, teleporting others, etc.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) {
            return res.status(403).json({ error: 'Cannot heartbeat as another player.' });
        }

        // Fire-and-forget IP + browser-fingerprint capture so the admin
        // Moderation tab can link sock-puppet accounts even when the user
        // hops VPNs (the IP changes, the fingerprint doesn't). Never block
        // the heartbeat on these — best-effort only.
        if (!identity.admin) {
            void recordClientIp(identity.name, clientIpFrom(req));
            const fp = clientFpFrom(req);
            if (fp) void recordClientFingerprint(identity.name, fp);
        }

        const challengeKey = `challenges:${safeName(name)}`;
        const resetSignalKey = `reset-signal:${safeName(name)}`;
        // One-shot "you were healed by {healer}" signal queued by api/player/heal.ts
        // when a Healer discharges this hospitalized player. Delivered + cleared
        // here so the client can auto-exit the hospital with a toast.
        const healSignalKey = `heal-signal:${safeName(name)}`;
        // One-shot "while you were away you were KO'd by X" inbox, pushed by the
        // sleeper-kill / merc-raid settlements (api/player/_offline-notices.ts).
        const noticesKey = offlineNoticesKey(name);
        // Durable compensations the player is owed (a Kage challenge stake whose
        // refund could not commit when the seat was vacated). Parked by
        // api/village/_kage-inactivity.ts; drained here on the next beat.
        const stakeRefundKey = kageStakeRefundKey(name);

        // Presence (own record, for the sector fallback) comes from memory now.
        // Challenges + reset-signal stay DB-backed (polled until the WS push layer).
        // The three per-beat signal reads ride ONE mget (they all live on the base
        // store, so the routed mget is a single round trip) — this endpoint fires
        // every second per online player, so each read saved here is ~1 op/s/player.
        const existing = onlineStore.get(name);
        const [signals, savedLocation, persistedTravel] = await Promise.all([
            kv.mget(challengeKey, resetSignalKey, healSignalKey, noticesKey, stakeRefundKey),
            existing ? Promise.resolve(null) : kv.get<{ currentSector?: number }>(`save:${safeName(name)}`),
            existing ? Promise.resolve(null) : getTravelLease(name),
        ]);
        const pendingChallenges = signals[0] as unknown[] | null;
        const resetSignal = signals[1];
        const healSignal = signals[2] as { by?: string; at?: number } | null;
        const rawNotices = signals[3];
        const pendingNotices = parseOfflineNotices(rawNotices);
        const owedStakeRefunds = parsePendingStakeRefunds(signals[4]);

        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }

        // A fresh process/session starts from the persisted server location. Once
        // online, MemoryOnlineStateStore only accepts sector changes backed by a
        // server-minted travel lease (or a safe-zone exit to sector 0).
        const now = Date.now();
        const entrySector = existing
            ? normalizeSector(sector, existing.sector)
            : persistedTravel
                ? travelLeaseSectorAt(persistedTravel, now)
                : normalizeSector(savedLocation?.currentSector, normalizeSector(sector, 40));

        // Cap client-supplied travelingUntil so an exploit can't make a player
        // permanently untouchable (capTravelingUntil returns undefined unless
        // it's still in the future).
        const safeTravelUntil = capTravelingUntil(travelingUntil, now);

        // Slim the incoming character to display fields before storing (defense
        // in depth — see slimPresenceCharacter). Fall back to the already-slim
        // stored character if this beat sent none.
        const slimChar = slimPresenceCharacter(character) ?? existing?.character ?? null;

        // Presence write → PROCESS MEMORY (no per-second DB write). upsert
        // preserves any pendingAttacker queued by attack.ts; we deliver it to this
        // client and clear it (one-shot), matching the old behavior where the
        // heartbeat read pendingAttacker then rewrote the row with null. Also
        // stamp the request IP for anti-alt overlap checks (player-ip:{name}:{ip},
        // 7-day TTL, idempotent).
        let stored = onlineStore.upsert({
            name,
            sector: entrySector,
            character: slimChar as Record<string, unknown> | null,
            travelingUntil: safeTravelUntil,
            inBattle: inBattle === true ? true : undefined,
            tile: normalizeTile(tile, existing?.tile),
        });
        if (!existing && persistedTravel && now < persistedTravel.arrivalAt) {
            stored = onlineStore.restoreTravel(
                name,
                persistedTravel.destinationSector,
                persistedTravel.arrivalAt,
                persistedTravel.originSector,
                persistedTravel.arrivalTile,
            ) ?? stored;
        }
        if ((persistedTravel && now >= persistedTravel.arrivalAt) || onlineStore.consumeSettledTravel(name)) {
            void settleTravelLease(name, persistedTravel ?? undefined, now).catch(() => undefined);
        }
        const pendingAttacker = stored.pendingAttacker ?? null;
        onlineStore.clearPendingAttacker(name);
        // Throttled cross-worker presence beat (fallback for consumers like the
        // Kage accept-obligation clock). See _realtime/_presence-beat.ts.
        stampPresenceBeat(name);
        void clearSleeperCamp(name).catch(() => undefined);

        // Do NOT read-delete the challenge inbox here. A challenge can arrive
        // between mget() and del(); deleting the whole key in that window loses
        // the new invite forever. Delivery is now acknowledgment-safe: heartbeat
        // may repeat pending records, the client de-dupes by id, and the explicit
        // challenge DELETE/accept/decline path removes exactly one stored id.
        await Promise.all([
            healSignal ? kv.del(healSignalKey) : Promise.resolve(),
            consumeDeliveredNotices(noticesKey, pendingNotices),
            stampPlayerIp(req, name),
        ]);

        // A parked compensation (a Kage stake the dethrone could not refund at
        // the time) settles into the save the moment its owner is reachable.
        // Fire-and-forget: it is durable and idempotent, and the hot beat must
        // never block or fail on it.
        if (owedStakeRefunds.length > 0) {
            void drainKageStakeRefunds(name, now).catch((err) => console.warn('[heartbeat] stake refund drain deferred', err));
        }

        // The in-memory store IS the live roster — no DB scan, no cache layer.
        // toPlayerRecord (shared with the WS path) shapes each entry; avatar
        // image is omitted (client resolves it from its name-keyed cache).
        const sectorMates = onlineStore.listSector(stored.sector).map(toPlayerRecord);

        // Note: the full online roster is intentionally NOT broadcast on every
        // heartbeat (was an O(N²)/payload cost). Clients source the global list
        // from the 60s /api/player/roster poll; this returns sector-scoped data
        // only. The client tolerates the absent `allPlayers` field (optional).

        return res.status(200).json({
            sectorMates,
            // Server-authoritative world position (lease-gated in online-store, so it
            // can't be teleported past the anti-cheat) + whether a travel lease is in
            // flight. The client reconciles its own currentSector to this each beat
            // (lib/sector-reconcile), so a desync — a remote raid/event backdrop
            // sector, the travel mask, any future drift — self-heals and co-located
            // players never go invisible. `traveling` makes the client hold during
            // the arrival-settle window so a real trip is never bounced.
            sector: stored.sector,
            traveling: (stored.travelingUntil ?? 0) > now,
            pendingAttacker,
            pendingChallenges: pendingChallenges ?? [],
            pendingHeal: healSignal ? { by: typeof healSignal.by === 'string' ? healSignal.by : '' } : null,
            // Omitted when there is nothing to deliver — this frame ships once a
            // second per online player and an empty array is pure payload.
            ...(pendingNotices.length > 0 ? { pendingNotices } : {}),
            // This clock mints every deadline the client renders (training endsAt,
            // travelingUntil, war pendingUntil) and re-checks them on claim. The
            // beat is the client's reference for it — a player whose own clock
            // drifts otherwise reads all of those timers wrong (lib/server-clock).
            serverNow: Date.now(),
        });
    } catch (err) {
        // failClosed lock contention is transient — say so, so the client keeps
        // beating instead of surfacing a hard "Internal server error."
        if (err instanceof LockContendedError) {
            return res.status(503).json({ error: 'The server is busy — retrying shortly.', retryable: true });
        }
        console.error('[heartbeat]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
