"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _lock_js_1 = require("../_lock.js");
const _floor_catalog_js_1 = require("../towers/_floor-catalog.js");
const _seal_js_1 = require("../towers/_seal.js");
const _encounter_js_1 = require("../towers/_encounter.js");
const _engine_js_1 = require("../towers/_engine.js");
const _sim_js_1 = require("../towers/_sim.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _tower_mp_js_1 = require("../towers/_tower-mp.js");
const _assault_js_1 = require("./_assault.js");
const _storage_js_2 = require("./_storage.js");
/*
 * POST /api/clan-boss/assault-start — begin a co-op assault on THIS week's clan boss.
 *
 * Reserves one of the host's weekly attempts, then mints a Battle-Towers session on
 * the week's clan-boss floor (host + up to 2 clanmate allies). The fight then runs
 * through the EXISTING /api/towers/action loop + battle screen; api/clan-boss/
 * assault-settle banks the server-computed damage into the clan's pool. Gated off by
 * default — 404 unless ENABLE_CLAN_BOSS==='1'. Body: { hostName, allies?: string[] }.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1')
        return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = (0, _utils_js_1.safeName)(String(body.hostName ?? ''));
        if (!hostName)
            return res.status(400).json({ error: 'Invalid host name.' });
        if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'clan-boss-assault-start', 10, 60_000, hostName))
            return;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, hostName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName)
            return res.status(403).json({ error: 'Can only start your own assault.' });
        const hostRec = await _storage_js_1.kv.get(`save:${hostName}`);
        const hostChar = hostRec?.character;
        if (!hostChar)
            return res.status(400).json({ error: 'Your save was not found.' });
        const clanName = typeof hostChar.clan === 'string' ? hostChar.clan : '';
        if (!clanName)
            return res.status(400).json({ error: 'You must be in a clan to raid the clan boss.' });
        const now = Date.now();
        const weekId = (0, _storage_js_2.clanBossWeekId)(now);
        const week = await (0, _storage_js_2.loadClanBossWeek)(weekId);
        if (!week || week.endsAt <= now)
            return res.status(400).json({ error: 'No clan boss is active right now.' });
        const boss = _storage_js_2.CLAN_BOSS_BY_ID[(0, _storage_js_2.clanBossPickId)(weekId)];
        const floor = boss ? (0, _floor_catalog_js_1.getFloor)(boss.floorId) : undefined;
        if (!boss || !floor)
            return res.status(500).json({ error: 'Clan boss floor missing.' });
        // Clan record → roster (member count for the pool; ally membership check).
        const clanRec = await _storage_js_1.kv.get(`save:clan-${(0, _storage_js_2.clanSlug)(clanName)}`);
        const members = Array.isArray(clanRec?.members) ? clanRec.members : [];
        const memberCount = members.length || 1;
        const memberSet = new Set(members.map(m => (0, _utils_js_1.safeName)(String(m?.name ?? ''))).filter(Boolean));
        // Party = host + clanmate allies (de-duped, capped). Non-clanmates are dropped.
        const allyNames = Array.isArray(body.allies) ? body.allies.map((a) => (0, _utils_js_1.safeName)(String(a))).filter(Boolean) : [];
        const clanmateAllies = allyNames.filter(a => a !== hostName && (memberSet.size === 0 || memberSet.has(a)));
        const memberSlugs = [...new Set([hostName, ...clanmateAllies])].slice(0, _storage_js_2.CB_MAX_PARTY);
        // Seal every party member from their authoritative save (host also supplies the
        // client-computed pvpItems/passives). All are LIVE humans; absent ones AFK-pass.
        const hostLoadout = (body.hostLoadout && typeof body.hostLoadout === 'object') ? body.hostLoadout : {};
        const squad = [];
        for (let i = 0; i < memberSlugs.length; i++) {
            const slug = memberSlugs[i];
            const rec = slug === hostName ? hostRec : await _storage_js_1.kv.get(`save:${slug}`);
            const char = rec?.character;
            if (!char) {
                if (slug === hostName)
                    return res.status(400).json({ error: 'Your save was not found.' });
                continue;
            }
            squad.push({
                // Contiguous ids even when an ally save is skipped above.
                id: `sq-${squad.length}`, name: String(char.name ?? slug), ownerSlug: slug, ai: false,
                character: (0, _seal_js_1.sealTowerFighter)(char, rec, slug === hostName ? hostLoadout : {}),
                itemCharges: (0, _seal_js_1.sealTowerItemCharges)(char),
            });
        }
        if (squad.length === 0)
            return res.status(400).json({ error: 'No valid party members.' });
        const partySlugs = squad.map(s => s.ownerSlug);
        // Reserve the host's attempt (+ credit breadth) atomically under the progress
        // lock. Re-check attempts + not-already-killed inside the lock.
        const progressKey = (0, _storage_js_2.clanBossProgressKey)(weekId, clanName);
        const reserved = await (0, _lock_js_1.withKvLock)(progressKey, async () => {
            const progress = (await (0, _storage_js_2.loadClanBossProgress)(weekId, clanName)) ?? (0, _storage_js_2.newClanBossProgress)(clanName, week, memberCount);
            if (progress.killedAt || progress.pool <= 0)
                return { ok: false, error: 'Your clan already defeated this week\'s boss.' };
            if ((0, _storage_js_2.clanBossAttemptsLeft)(progress, hostName) <= 0)
                return { ok: false, error: 'You\'ve used all your assaults this week.' };
            const next = (0, _storage_js_2.reserveAttempt)(progress, hostName, partySlugs, now);
            await (0, _storage_js_2.saveClanBossProgress)(next);
            return { ok: true, pool: next.pool };
        }, { failClosed: true });
        if (!reserved.ok)
            return res.status(400).json({ error: reserved.error });
        // Mint the tower session on the clan-boss floor.
        const runId = `cboss-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
        const seed = (0, node_crypto_1.randomInt)(1, 0x7fffffff);
        const session = (0, _encounter_js_1.buildTowerEncounter)({ floor, squad, runId, seed, partySize: squad.length, now });
        // Override the boss's HP to the SHARED pool (capped per assault) so it's the
        // persistent clan boss being chipped — not a fresh chunk. buildTowerEncounter
        // already party-scaled the boss's damage; we only replace its HP. The final
        // assault (small remainder) becomes the killable finisher.
        const bossHp = Math.max(1, Math.min(reserved.pool, _storage_js_2.CB_ASSAULT_HP_CAP));
        const bossActor = session.actors.find(a => a.id === session.phaseState.bossId);
        if (bossActor) {
            bossActor.hp = bossHp;
            bossActor.maxHp = bossHp;
        }
        (0, _engine_js_1.startRound)(session);
        (0, _engine_js_1.runAiUntilHuman)(session, floor, (0, _sim_js_1.makeRng)(seed));
        (0, _tower_mp_js_1.stampTurnClock)(session, now);
        await (0, _tower_store_js_1.writeSession)(session);
        // Invite EVERY party member — incl. the host — so anyone (incl. the host after
        // an accidental exit) can rediscover + rejoin an unfinished assault via
        // fetchMyRun, rather than losing the reserved attempt. Clan-boss runs use the
        // `cboss-` runId prefix, which the Battle Towers lobby filters out so they only
        // surface in the Clan Boss tab.
        for (const slug of memberSlugs)
            await (0, _tower_store_js_1.setTowerInvite)(slug, runId).catch(() => undefined);
        // Tag the run as a clan-boss assault so settle knows where to bank it.
        await (0, _assault_js_1.saveAssault)({ runId, weekId, clanName, host: hostName, party: partySlugs, bossId: boss.id, createdAt: now });
        return res.status(200).json({ runId, session, boss: { id: boss.id, name: boss.name, icon: boss.icon } });
    }
    catch (err) {
        console.error('[clan-boss/assault-start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
