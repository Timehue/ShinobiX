"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _player_ips_js_1 = require("../_player-ips.js");
const moderation_js_1 = require("../admin/moderation.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const presence_input_js_1 = require("../_realtime/presence-input.js");
// Presence now lives in the in-memory online store (api/_realtime/online-store.ts)
// instead of `presence:<name>` DB keys — no per-second DB read/write. The live
// roster comes from onlineStore.list(); writes from onlineStore.upsert(). The
// slim/cap/shape helpers live in ../_realtime/presence-input.ts so the WS
// presence path (api/_realtime/socket.ts) uses byte-for-byte the same logic.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // 90/min per player heartbeat. The client beats once per second on the
    // exploring/combat screens (= 60/min), so the cap must sit above 60 with
    // headroom for clock jitter, retries, and the occasional double-fire on a
    // remount; 90 gives ~1.5x margin without opening the abuse window wide.
    // KV-backed so the window is authoritative across all Vercel lambda
    // instances — the previous in-process limiter let a player triggering
    // parallel invocations (cold-start fan-out) blow past the cap on individual
    // instances, which let the IP/fingerprint capture in this handler be hammered.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.name === 'string' ? bodyPeek.name : undefined;
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'heartbeat', 90, 60_000, peekName)))
        return;
    try {
        const body = bodyPeek; // reuse the rate-limit peek's parse — avoids a 2nd JSON.parse on the hottest endpoint
        const { name, sector, character, travelingUntil, inBattle, tile } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        // Require that the heartbeat is from the named player (or admin).
        // Stops attackers from spoofing presence: setting inBattle=true to be
        // untouchable, faking travelingUntil, teleporting others, etc.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
            return res.status(403).json({ error: 'Cannot heartbeat as another player.' });
        }
        // Fire-and-forget IP + browser-fingerprint capture so the admin
        // Moderation tab can link sock-puppet accounts even when the user
        // hops VPNs (the IP changes, the fingerprint doesn't). Never block
        // the heartbeat on these — best-effort only.
        if (!identity.admin) {
            void (0, moderation_js_1.recordClientIp)(identity.name, (0, moderation_js_1.clientIpFrom)(req));
            const fp = (0, moderation_js_1.clientFpFrom)(req);
            if (fp)
                void (0, moderation_js_1.recordClientFingerprint)(identity.name, fp);
        }
        const challengeKey = `challenges:${(0, _utils_js_1.safeName)(name)}`;
        const resetSignalKey = `reset-signal:${(0, _utils_js_1.safeName)(name)}`;
        // One-shot "you were healed by {healer}" signal queued by api/player/heal.ts
        // when a Healer discharges this hospitalized player. Delivered + cleared
        // here so the client can auto-exit the hospital with a toast.
        const healSignalKey = `heal-signal:${(0, _utils_js_1.safeName)(name)}`;
        // Presence (own record, for the sector fallback) comes from memory now.
        // Challenges + reset-signal stay DB-backed (polled until the WS push layer).
        const existing = online_store_js_1.onlineStore.get(name);
        const [pendingChallenges, resetSignal, healSignal] = await Promise.all([
            _storage_js_1.kv.get(challengeKey),
            _storage_js_1.kv.get(resetSignalKey),
            _storage_js_1.kv.get(healSignalKey),
        ]);
        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }
        const entrySector = (0, presence_input_js_1.normalizeSector)(sector, (0, presence_input_js_1.normalizeSector)(existing?.sector, 40));
        const now = Date.now();
        // Cap client-supplied travelingUntil so an exploit can't make a player
        // permanently untouchable (capTravelingUntil returns undefined unless
        // it's still in the future).
        const safeTravelUntil = (0, presence_input_js_1.capTravelingUntil)(travelingUntil, now);
        // Slim the incoming character to display fields before storing (defense
        // in depth — see slimPresenceCharacter). Fall back to the already-slim
        // stored character if this beat sent none.
        const slimChar = (0, presence_input_js_1.slimPresenceCharacter)(character) ?? existing?.character ?? null;
        // Presence write → PROCESS MEMORY (no per-second DB write). upsert
        // preserves any pendingAttacker queued by attack.ts; we deliver it to this
        // client and clear it (one-shot), matching the old behavior where the
        // heartbeat read pendingAttacker then rewrote the row with null. Also
        // stamp the request IP for anti-alt overlap checks (player-ip:{name}:{ip},
        // 7-day TTL, idempotent).
        const stored = online_store_js_1.onlineStore.upsert({
            name,
            sector: entrySector,
            character: slimChar,
            travelingUntil: safeTravelUntil,
            inBattle: inBattle === true ? true : undefined,
            tile: (0, presence_input_js_1.normalizeTile)(tile, existing?.tile),
        });
        const pendingAttacker = stored.pendingAttacker ?? null;
        online_store_js_1.onlineStore.clearPendingAttacker(name);
        await Promise.all([
            pendingChallenges?.length ? _storage_js_1.kv.del(challengeKey) : Promise.resolve(),
            healSignal ? _storage_js_1.kv.del(healSignalKey) : Promise.resolve(),
            (0, _player_ips_js_1.stampPlayerIp)(req, name),
        ]);
        // The in-memory store IS the live roster — no DB scan, no cache layer.
        // toPlayerRecord (shared with the WS path) shapes each entry; avatar
        // image is omitted (client resolves it from its name-keyed cache).
        const allEntries = online_store_js_1.onlineStore.list();
        const sectorMates = allEntries
            .filter(p => (0, presence_input_js_1.normalizeSector)(p.sector) === entrySector)
            .map(presence_input_js_1.toPlayerRecord);
        // Note: the full online roster is intentionally NOT broadcast on every
        // heartbeat (was an O(N²)/payload cost). Clients source the global list
        // from the 60s /api/player/roster poll; this returns sector-scoped data
        // only. The client tolerates the absent `allPlayers` field (optional).
        return res.status(200).json({
            sectorMates,
            pendingAttacker,
            pendingChallenges: pendingChallenges ?? [],
            pendingHeal: healSignal ? { by: typeof healSignal.by === 'string' ? healSignal.by : '' } : null,
        });
    }
    catch (err) {
        console.error('[heartbeat]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
