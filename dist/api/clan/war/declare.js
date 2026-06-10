"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _storage_js_2 = require("./_storage.js");
// POST /api/clan/war/declare
// Body: { toClan: string }
//
// Gates:
//   • Authed player must be Founder / Leader / Officer of their clan
//   • Their clan must not be in an active war
//   • Target clan must exist, must not be in an active war
//   • Target clan cannot be the same as actor's clan
//   • Target clan's canonical name must MATCH what the caller typed (case-
//     insensitive). The slug derivation strips spaces and punctuation
//     destructively (`"Clan A"` and `"ClanA"` both map to `clan-clana`),
//     so without this check two clans with similar names could end up at
//     war when only one of them was intended.
//   • Pair-cooldown: same two clans cannot re-war within 7 days of
//     the previous war ending
//   • Declaring player must hold ≥ CLAN_WAR_DECLARATION_COST honor seals
//     (charged off their save on success — same model as the Village War
//     declaration in api/world-state.ts). Free clan wars previously let
//     officers grief-pair every other clan into 7-day cooldowns.
//
// Server-managed: war record + HP (500/500), war crate ID, declaredBy.
// Honor-seal cost to declare. 100 is lower than the 500-seal village war
// cost — clan wars are more frequent and at a smaller scale — but enough
// to make grief-locking a clan into the 7-day cooldown carry real economic
// weight. Admin bypasses (testing).
const CLAN_WAR_DECLARATION_COST = 100;
// War Room clan-upgrade bonus to the starting war-HP pool, +2 HP per level.
// KEEP IN SYNC with shinobij.client/src/lib/clan-upgrades.ts (WAR_ROOM_HP_PER_LEVEL).
const WAR_ROOM_HP_PER_LEVEL = 2;
function warRoomBonusHp(rec) {
    const lvl = Number(rec?.upgrades?.warRoom ?? 0);
    return Number.isFinite(lvl) && lvl > 0 ? Math.floor(lvl) * WAR_ROOM_HP_PER_LEVEL : 0;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-war-declare', 4, 60 * 60_000, identity.name)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const requestedToClan = String(body?.toClan ?? '').trim();
        if (!requestedToClan)
            return res.status(400).json({ error: 'Missing toClan.' });
        // Pull actor's clan context. Admin may declare on behalf of any
        // clan via the `fromClan` body field (testing); regular players
        // must use their own clan.
        const ctx = await (0, _storage_js_2.loadClanContext)(identity.admin ? String(body?.fromClan ?? '') : identity.name);
        const fromClan = identity.admin ? (String(body?.fromClan ?? '') || ctx.clan) : ctx.clan;
        if (!fromClan)
            return res.status(400).json({ error: 'You must be in a clan to declare war.' });
        if (fromClan === requestedToClan)
            return res.status(400).json({ error: 'Cannot declare war on your own clan.' });
        if (!identity.admin && !(0, _storage_js_2.canActAsClanLeadership)(ctx.role)) {
            return res.status(403).json({ error: 'Only Clan Founder, Leader, or Officer can declare war.' });
        }
        // Resolve the target clan record + its village. This also acts
        // as the "does the clan exist?" check.
        //
        // Slug strips spaces and punctuation destructively. We re-read the
        // canonical `name` field from the record and verify it matches what
        // the caller typed. This blocks `"Clan-A"` from accidentally
        // declaring war on `"ClanA"` because both share `clan-clana`.
        const toClanSlug = `clan-${requestedToClan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const toClanRecord = await _storage_js_1.kv.get(`save:${toClanSlug}`);
        if (!toClanRecord)
            return res.status(404).json({ error: 'Target clan not found.' });
        const canonicalToClan = String(toClanRecord.name ?? '').trim();
        if (!canonicalToClan)
            return res.status(409).json({ error: 'Target clan record is missing its canonical name.' });
        if (canonicalToClan.toLowerCase() !== requestedToClan.toLowerCase()) {
            return res.status(409).json({
                error: `Clan name "${requestedToClan}" does not match the canonical record "${canonicalToClan}".`,
            });
        }
        // Use the canonical name from here on so the war record, cooldowns,
        // and pair-id all key against the real clan identity.
        const toClan = canonicalToClan;
        const toVillage = String(toClanRecord.village ?? '');
        // Cooldown check.
        const cd = await _storage_js_1.kv.get((0, _storage_js_2.clanWarCooldownKey)(fromClan, toClan));
        if (cd)
            return res.status(409).json({ error: 'These two clans were at war within the last 7 days.' });
        // Single-war-per-clan rule (each clan).
        if (await (0, _storage_js_2.clanInActiveWar)(fromClan))
            return res.status(409).json({ error: `${fromClan} is already in a clan war.` });
        if (await (0, _storage_js_2.clanInActiveWar)(toClan))
            return res.status(409).json({ error: `${toClan} is already in a clan war.` });
        // Honor-seal cost (non-admin). Charged off the declaring player's
        // save. Read-modify-write held under lock:save:<name> so a
        // concurrent auto-save can't undo the debit.
        if (!identity.admin) {
            const saveKey = `save:${identity.name}`;
            const debitError = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
                const record = await _storage_js_1.kv.get(saveKey);
                const char = record?.character;
                if (!char)
                    return { status: 404, body: { error: 'Declaring character not found.' } };
                const balance = Number(char.honorSeals ?? 0);
                if (balance < CLAN_WAR_DECLARATION_COST) {
                    return {
                        status: 400,
                        body: {
                            error: `Declaring war costs ${CLAN_WAR_DECLARATION_COST} Honor Seals. You hold ${balance}.`,
                            cost: CLAN_WAR_DECLARATION_COST,
                            balance,
                        },
                    };
                }
                const updated = {
                    ...record,
                    character: {
                        ...char,
                        honorSeals: balance - CLAN_WAR_DECLARATION_COST,
                    },
                };
                await _storage_js_1.kv.set(saveKey, updated);
                return null;
            });
            if (debitError)
                return res.status(debitError.status).json(debitError.body);
        }
        // War Room clan-upgrade: each clan's starting HP pool is the base plus
        // its own War Room bonus. toClanRecord is already loaded; load fromClan's
        // record for its upgrades (cheap — declare is a rare action).
        const fromClanSlug = `clan-${fromClan.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
        const fromClanRecord = await _storage_js_1.kv.get(`save:${fromClanSlug}`);
        const fromStartHp = _storage_js_2.CLAN_WAR_HP_MAX + warRoomBonusHp(fromClanRecord);
        const toStartHp = _storage_js_2.CLAN_WAR_HP_MAX + warRoomBonusHp(toClanRecord);
        const sortedClans = [fromClan, toClan].sort((a, b) => a.localeCompare(b));
        const id = (0, _storage_js_2.clanWarPairId)(fromClan, toClan);
        const key = (0, _storage_js_2.clanWarKey)(fromClan, toClan);
        const result = await (0, _lock_js_1.withKvLock)(key, async () => {
            // Re-check under the lock to avoid two simultaneous declares
            // for the same pair both succeeding.
            const existing = await _storage_js_1.kv.get(key);
            if (existing && !existing.endedAt) {
                return { status: 409, body: { error: 'War already exists for this clan pair.', war: existing } };
            }
            const now = Date.now();
            const war = {
                id,
                clans: sortedClans,
                villages: {
                    [fromClan]: ctx.village,
                    [toClan]: toVillage,
                },
                hp: {
                    [fromClan]: fromStartHp,
                    [toClan]: toStartHp,
                },
                hpMax: {
                    [fromClan]: fromStartHp,
                    [toClan]: toStartHp,
                },
                startedAt: now,
                updatedAt: now,
                declaredBy: identity.admin ? 'admin' : (ctx.name || identity.name),
                pendingChallenges: [],
                completedChallenges: [],
                warCrateId: `clan-war-crate-${id}`,
            };
            await _storage_js_1.kv.set(key, war);
            return { status: 200, body: { war } };
        });
        return res.status(result.status).json(result.body);
    }
    catch (err) {
        console.error('[clan/war/declare]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
