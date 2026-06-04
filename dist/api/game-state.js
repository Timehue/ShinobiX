"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _lock_js_1 = require("./_lock.js");
const _village_state_validate_js_1 = require("./_village-state-validate.js");
const LEADERSHIP_IMAGES_KEY = 'game:village-leadership-images';
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const ARENA_TOURNAMENT_KEY = 'game:arena:tournament';
const ARENA_ACTIVE_FIGHTS_KEY = 'game:arena:active-fights';
const CLAN_PET_BATTLE_PREFIX = 'game:clan-pet-battle:';
const WEEKLY_BOSS_OVERRIDE_KEY = 'game:weekly-boss-override';
function clanPetBattleKey(clanName) {
    return `${CLAN_PET_BATTLE_PREFIX}${clanName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        try {
            // Village leadership portraits are large base64 images that change
            // rarely. They used to ride this frame — which clients poll every 5s
            // — at ~355KB per response. They're now served only on an explicit
            // ?images=1 request (long CDN TTL); the default frame below omits
            // them so the hot poll stays tiny. The client polls the images
            // variant on a slow ~5-min cadence. Mirrors the presence/pet-image strip.
            if (req.query.images === '1') {
                const leadershipImages = await _storage_js_1.kv.get(LEADERSHIP_IMAGES_KEY);
                res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
                return res.status(200).json({ villageLeadershipImages: leadershipImages ?? null });
            }
            const [villageStateKeys, arenaTournament, arenaActiveFights, clanPetBattleKeys, weeklyBossAiId] = await Promise.all([
                _storage_js_1.kv.keys(`${VILLAGE_STATE_PREFIX}*`),
                _storage_js_1.kv.get(ARENA_TOURNAMENT_KEY),
                _storage_js_1.kv.get(ARENA_ACTIVE_FIGHTS_KEY),
                _storage_js_1.kv.keys(`${CLAN_PET_BATTLE_PREFIX}*`),
                _storage_js_1.kv.get(WEEKLY_BOSS_OVERRIDE_KEY),
            ]);
            const villageStates = {};
            if (villageStateKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const stateValues = await _storage_js_1.kv.mget(...villageStateKeys);
                villageStateKeys.forEach((k, i) => {
                    if (stateValues[i] != null) {
                        const name = k.slice(VILLAGE_STATE_PREFIX.length);
                        villageStates[name] = stateValues[i];
                    }
                });
            }
            const clanPetBattles = {};
            if (clanPetBattleKeys.length > 0) {
                // mget fetches all values in one round-trip instead of N individual gets.
                const battleValues = await _storage_js_1.kv.mget(...clanPetBattleKeys);
                clanPetBattleKeys.forEach((k, i) => {
                    if (battleValues[i] != null) {
                        const name = k.slice(CLAN_PET_BATTLE_PREFIX.length);
                        clanPetBattles[name] = battleValues[i];
                    }
                });
            }
            // CDN caches this response for 20s so N players polling every 30s share
            // one KV hit per cache window instead of N individual hits.
            // stale-while-revalidate=10 keeps the response snappy while the next fetch runs.
            res.setHeader('Cache-Control', 's-maxage=8, stale-while-revalidate=5');
            return res.status(200).json({
                villageStates,
                arenaTournament: arenaTournament ?? null,
                arenaActiveFights: Array.isArray(arenaActiveFights) ? arenaActiveFights : [],
                clanPetBattles,
                weeklyBossAiId: weeklyBossAiId ?? null,
            });
        }
        catch (err) {
            console.error('[game-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { kind } = body;
            // Every kind now requires auth. The previous "openKinds" branch
            // that exempted `pendingClanPetBattle` let any anonymous caller
            // write or delete the pet-battle slot for any clan (since the
            // body provides the clanName) — blocking legit battles or
            // injecting fake records.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            // Admin-only kinds — wholesale state writes.
            //
            // Admin 2 (content role) is treated as `identity.admin === true`
            // by authedPlayerOrAdmin (the new isAdmin accepts either password),
            // so they pass the basic admin check. But for the kinds Admin 2
            // shouldn't touch (arenaTournament, weeklyBossOverride — neither
            // is exposed by their UI), require the full admin password.
            const adminOnlyKinds = new Set(['villageLeadershipImages', 'arenaTournament', 'weeklyBossOverride']);
            const fullAdminOnlyKinds = new Set(['arenaTournament', 'weeklyBossOverride']);
            if (adminOnlyKinds.has(String(kind)) && !identity.admin) {
                return res.status(403).json({ error: 'Admin only.' });
            }
            if (fullAdminOnlyKinds.has(String(kind)) && !(0, _auth_js_1.isFullAdmin)(req)) {
                return res.status(403).json({ error: 'Full admin only.' });
            }
            if (kind === 'villageState') {
                const { village, state } = body;
                if (!village || !state || typeof state !== 'object') {
                    return res.status(400).json({ error: 'Missing village or state.' });
                }
                // Rate-limit per-caller: legitimate gameplay writes village
                // state on donate / notice / agenda / kage actions — far
                // below 30/min. Higher cadence = abuse loop.
                const rlName = identity.admin ? undefined : identity.name;
                if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-state-write', 30, 60_000, rlName)))
                    return;
                // Actor must be a member of the village they're writing for.
                if (!identity.admin) {
                    try {
                        const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                        const char = (save?.character ?? null);
                        const myVillage = char?.village ?? '';
                        if (myVillage.trim() !== village.trim()) {
                            return res.status(403).json({ error: 'Cannot write state for a village you do not belong to.' });
                        }
                    }
                    catch {
                        return res.status(500).json({ error: 'Unable to verify village membership.' });
                    }
                }
                const key = `${VILLAGE_STATE_PREFIX}${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                // Read-validate-write under a lock so concurrent kage
                // challenge / donation / notice writes can't race-overwrite
                // each other. Audit-validate per field — see
                // _village-state-validate.ts. Suppressed mutations fall
                // back to the existing value (silently — admin can find
                // them in server logs).
                const suppressedLog = await (0, _lock_js_1.withKvLock)(key, async () => {
                    const existing = await _storage_js_1.kv.get(key);
                    const kageState = await (0, _village_state_validate_js_1.loadAuthoritativeKage)(village);
                    const { next, suppressed } = await (0, _village_state_validate_js_1.validateVillageStateWrite)(existing, state, {
                        callerName: identity.admin ? '' : identity.name,
                        isAdmin: identity.admin,
                        village,
                    }, kageState);
                    await _storage_js_1.kv.set(key, next);
                    return suppressed;
                });
                if (suppressedLog.length > 0) {
                    console.warn('[game-state villageState] suppressed:', identity.admin ? 'admin' : identity.name, suppressedLog.join('; '));
                }
                return res.status(200).json({ ok: true, suppressed: suppressedLog.length });
            }
            if (kind === 'villageLeadershipImages') {
                const { images } = body;
                if (!images)
                    return res.status(400).json({ error: 'Missing images.' });
                await _storage_js_1.kv.set(LEADERSHIP_IMAGES_KEY, images);
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaTournament') {
                const { tournament } = body;
                if (tournament == null) {
                    await _storage_js_1.kv.del(ARENA_TOURNAMENT_KEY);
                }
                else {
                    await _storage_js_1.kv.set(ARENA_TOURNAMENT_KEY, tournament);
                }
                return res.status(200).json({ ok: true });
            }
            if (kind === 'arenaActiveFights') {
                const { fights } = body;
                if (!Array.isArray(fights))
                    return res.status(400).json({ error: 'Missing fights array.' });
                // Non-admin actor must have been in the OLD list OR be in the
                // NEW list. Without the "old list" check, the legitimate
                // cleanup case 403'd: when a player's own fight ends they
                // POST the list minus their fight, and the new list no
                // longer contains them. Comparing against the prior KV
                // value lets that cleanup through while still rejecting
                // strangers who try to wipe or pollute the list.
                if (!identity.admin) {
                    const me = identity.name;
                    function fighterNames(f) {
                        if (!f || typeof f !== 'object')
                            return [];
                        const rec = f;
                        const names = [];
                        if (typeof rec.p1Name === 'string')
                            names.push(rec.p1Name);
                        if (typeof rec.p2Name === 'string')
                            names.push(rec.p2Name);
                        const fighters = rec.fighters;
                        if (Array.isArray(fighters)) {
                            for (const ff of fighters) {
                                // ArenaSpectatorFight.fighters is string[] in the
                                // client type; accept that plus the legacy
                                // { name: string } shape for safety.
                                if (typeof ff === 'string') {
                                    names.push(ff);
                                }
                                else if (ff && typeof ff === 'object' && typeof ff.name === 'string') {
                                    names.push(String(ff.name));
                                }
                            }
                        }
                        return names;
                    }
                    function listIncludesMe(list) {
                        return list.some((f) => fighterNames(f).some((n) => (0, _utils_js_1.safeName)(n) === me));
                    }
                    const inNewList = listIncludesMe(fights);
                    let inOldList = false;
                    if (!inNewList) {
                        const oldFights = await _storage_js_1.kv.get(ARENA_ACTIVE_FIGHTS_KEY);
                        inOldList = Array.isArray(oldFights) ? listIncludesMe(oldFights) : false;
                    }
                    if (!inNewList && !inOldList) {
                        return res.status(403).json({ error: 'Actor must be one of the fighters to update the arena fight list.' });
                    }
                }
                await _storage_js_1.kv.set(ARENA_ACTIVE_FIGHTS_KEY, fights.slice(0, 20));
                return res.status(200).json({ ok: true });
            }
            if (kind === 'pendingClanPetBattle') {
                const { clanName, battle } = body;
                if (!clanName)
                    return res.status(400).json({ error: 'Missing clanName.' });
                // Membership gate: only members of the named clan (or admin)
                // can write or delete its pet-battle slot. Previously this
                // was wide open (the kind was in `openKinds`), so any
                // anonymous caller could clobber any clan's battle slot.
                if (!identity.admin) {
                    try {
                        const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                        const char = (save?.character ?? null);
                        const myClan = String(char?.clan ?? '').trim();
                        if (!myClan || myClan !== clanName.trim()) {
                            return res.status(403).json({ error: 'Can only set the pet battle slot for your own clan.' });
                        }
                    }
                    catch {
                        return res.status(500).json({ error: 'Unable to verify clan membership.' });
                    }
                    // Rate limit so a member can't griefly thrash their own
                    // clan's battle slot either.
                    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-pet-battle-write', 10, 60_000, identity.name)))
                        return;
                }
                const key = clanPetBattleKey(clanName);
                if (battle == null) {
                    await _storage_js_1.kv.del(key);
                }
                else {
                    await _storage_js_1.kv.set(key, battle, { ex: 24 * 60 * 60 }); // 24-hour TTL
                }
                return res.status(200).json({ ok: true });
            }
            if (kind === 'weeklyBossOverride') {
                if (!identity.admin)
                    return res.status(403).json({ error: 'Admin only.' });
                const { aiId } = body;
                if (aiId) {
                    await _storage_js_1.kv.set(WEEKLY_BOSS_OVERRIDE_KEY, aiId);
                }
                else {
                    await _storage_js_1.kv.del(WEEKLY_BOSS_OVERRIDE_KEY);
                }
                return res.status(200).json({ ok: true });
            }
            return res.status(400).json({ error: 'Unknown kind.' });
        }
        catch (err) {
            console.error('[game-state]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
