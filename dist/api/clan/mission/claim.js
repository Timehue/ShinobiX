"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _mission_catalog_js_1 = require("../_mission-catalog.js");
/*
 * /api/clan/mission/claim
 *
 *   GET  ?clan=<name>            → { claimed: ClanMissionKey[] }  (open, like clan reads)
 *   POST { playerName, clan, missionKey } → claim a completed clan mission once
 *
 * Server-authoritative: the client never sends progress or reward amounts. The
 * server recomputes the mission's progress from the trusted clan record
 * (member contributions, treasury) + the canonical world:territory:* sectors,
 * verifies it meets the target, then credits the SHARED clan treasury + clan XP
 * under the clan-save lock. A per-mission single-use latch (NX KV key, NOT on
 * the clan blob so the clan-save validator can't strip it) makes each clan
 * mission claimable exactly once, ever.
 *
 * Gated at clan MEMBERSHIP (same model as treasury/donate + territory/collect-
 * supply): the reward lands in the shared pool, not personal inventory, so a
 * non-leader who crafts the request can only help their own clan. The UI shows
 * the Claim button to leadership only.
 */
const TERRITORY_KEY_PREFIX = 'world:territory:';
const AUDIT_LOG_PREFIX = 'audit:clan-mission-claim:';
const CLAIM_TTL = 400 * 24 * 60 * 60; // ~13 months — effectively permanent latch.
function claimedSetKey(slug) { return `clan:missions-claimed:${slug}`; }
function claimLatchKey(slug, key) { return `clan:mission-claimed:${slug}:${key}`; }
async function readClaimed(slug) {
    const raw = await _storage_js_1.kv.get(claimedSetKey(slug)).catch(() => null);
    if (!Array.isArray(raw))
        return [];
    return raw.filter(_mission_catalog_js_1.isClanMissionKey);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    try {
        // ── GET — list this clan's already-claimed missions (open read) ──────
        if (req.method === 'GET') {
            const clan = typeof req.query.clan === 'string' ? req.query.clan.trim() : '';
            const slug = (0, _utils_js_1.clanBareSlug)(clan);
            if (!slug)
                return res.status(400).json({ error: 'Missing clan.' });
            return res.status(200).json({ ok: true, claimed: await readClaimed(slug) });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        const missionKey = String(body.missionKey ?? '');
        if (!playerName || !clan)
            return res.status(400).json({ error: 'Missing playerName or clan.' });
        if (!(0, _mission_catalog_js_1.isClanMissionKey)(missionKey))
            return res.status(400).json({ error: 'Invalid mission.' });
        const reward = _mission_catalog_js_1.CLAN_MISSION_REWARDS[missionKey];
        if (!reward)
            return res.status(400).json({ error: 'This mission has no claimable reward.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only claim for yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-mission-claim', 20, 60_000, identity.name)))
            return;
        const slug = (0, _utils_js_1.clanBareSlug)(clan);
        if (!slug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = (0, _utils_js_1.clanRecordKey)(clan);
        // Membership check (admin exempt) — the caller must belong to this clan.
        if (!identity.admin) {
            const donorRec = await _storage_js_1.kv.get(`save:${playerName}`);
            const donorChar = (donorRec?.character ?? null);
            if (!donorChar)
                return res.status(404).json({ error: 'Your save was not found.' });
            if ((0, _utils_js_1.clanBareSlug)(String(donorChar.clan ?? '')) !== slug) {
                return res.status(403).json({ error: 'You are not a member of this clan.' });
            }
        }
        // Load the canonical territory sectors up front (read-only; progress for
        // guard/territory/anbu depends on them). Stale-by-a-moment is fine.
        const territoryKeys = await _storage_js_1.kv.keys(`${TERRITORY_KEY_PREFIX}*`).catch(() => []);
        const territories = territoryKeys.length
            ? (await _storage_js_1.kv.mget(...territoryKeys)).filter(Boolean)
            : [];
        const outcome = await (0, _lock_js_1.withKvLock)(clanSaveKey, async () => {
            const clanRec = await _storage_js_1.kv.get(clanSaveKey);
            if (!clanRec)
                return { ok: false, status: 404, error: 'Clan not found.' };
            const progress = (0, _mission_catalog_js_1.clanMissionProgressServer)(clanRec, String(clanRec.name ?? clan), territories, missionKey);
            if (progress < _mission_catalog_js_1.CLAN_MISSION_TARGETS[missionKey]) {
                return { ok: false, status: 409, error: 'Clan mission not complete yet.' };
            }
            // Single-use latch — reserve before crediting so two racing claims
            // can't both pay out (the outer clan lock already serialises, this is
            // the durable record across calls). NX: null means already taken.
            const placed = await _storage_js_1.kv.set(claimLatchKey(slug, missionKey), '1', { nx: true, ex: CLAIM_TTL }).catch(() => 'OK');
            if (placed === null)
                return { ok: false, status: 409, error: 'This clan mission was already claimed.' };
            // ── Credit clan XP + treasury ───────────────────────────────────
            const leveled = (0, _mission_catalog_js_1.addClanXpServer)(Number(clanRec.xp ?? 0) || 0, Number(clanRec.level ?? 1) || 1, reward.clanXp);
            const prevTreasury = (clanRec.treasury ?? {});
            const nextTreasury = { ...prevTreasury };
            for (const [cur, amt] of Object.entries(reward.treasury ?? {})) {
                nextTreasury[cur] = (Number(nextTreasury[cur] ?? 0) || 0) + Number(amt);
            }
            await _storage_js_1.kv.set(clanSaveKey, { ...clanRec, xp: leveled.xp, level: leveled.level, treasury: nextTreasury });
            return { ok: true, xp: leveled.xp, level: leveled.level, treasury: nextTreasury };
        }, { failClosed: true });
        if (!outcome.ok)
            return res.status(outcome.status).json({ error: outcome.error });
        // Maintain the listing set + audit (best-effort, off the claim's lock).
        const claimed = await readClaimed(slug);
        if (!claimed.includes(missionKey)) {
            await _storage_js_1.kv.set(claimedSetKey(slug), [...claimed, missionKey], { ex: CLAIM_TTL }).catch(() => undefined);
        }
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${slug}:${missionKey}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            missionKey,
            reward,
        }, { ex: 90 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({
            ok: true,
            missionKey,
            reward,
            xp: outcome.xp,
            level: outcome.level,
            treasury: outcome.treasury,
            claimed: claimed.includes(missionKey) ? claimed : [...claimed, missionKey],
        });
    }
    catch (err) {
        console.error('[clan/mission/claim]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
