"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _storage_js_2 = require("./_storage.js");
/*
 * GET /api/clan-boss/get?player=<name> — the current weekly clan-boss event: the
 * boss, the caller's clan progress (shared pool + their attempts left), and the
 * live cross-clan standings. Read-only. 404 unless ENABLE_CLAN_BOSS==='1'.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1')
        return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        const playerName = (0, _utils_js_1.safeName)(String(req.query.player ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing player.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only view as yourself.' });
        const now = Date.now();
        const weekId = (0, _storage_js_2.clanBossWeekId)(now);
        const week = await (0, _storage_js_2.loadClanBossWeek)(weekId);
        if (!week || week.endsAt <= now)
            return res.status(200).json({ ok: true, active: false });
        const boss = _storage_js_2.CLAN_BOSS_BY_ID[(0, _storage_js_2.clanBossPickId)(weekId)];
        // Live standings: scan every clan's progress for the week, rank by composite score.
        const progressKeys = await _storage_js_1.kv.keys(`clan-boss:progress:${weekId}:*`);
        const progressList = (progressKeys.length ? await _storage_js_1.kv.mget(...progressKeys) : [])
            .filter(Boolean);
        const standings = (0, _storage_js_2.rankClanBoss)(progressList).slice(0, 12);
        const save = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = save?.character;
        const clanName = char && typeof char.clan === 'string' ? char.clan : '';
        let myClan = null;
        if (clanName) {
            let progress = await (0, _storage_js_2.loadClanBossProgress)(weekId, clanName);
            if (!progress) {
                const clanRec = await _storage_js_1.kv.get(`save:clan-${(0, _storage_js_2.clanSlug)(clanName)}`);
                const memberCount = Array.isArray(clanRec?.members) ? clanRec.members.length : 1;
                progress = (0, _storage_js_2.newClanBossProgress)(clanName, week, memberCount);
            }
            const myRank = standings.find(s => (0, _storage_js_2.clanSlug)(s.clanName) === (0, _storage_js_2.clanSlug)(clanName));
            myClan = {
                clanName,
                pool: progress.pool,
                poolMax: progress.poolMax,
                killed: !!progress.killedAt,
                damageDealt: (0, _storage_js_2.clanBossDamageDealt)(progress),
                participants: progress.participants.length,
                attemptsPerMember: _storage_js_2.CB_ASSAULTS_PER_MEMBER,
                myAttemptsLeft: (0, _storage_js_2.clanBossAttemptsLeft)(progress, playerName),
                rank: myRank?.rank ?? null,
                score: myRank?.score ?? 0,
            };
        }
        // Last week's result for this clan (from the archive) — a "how'd we do" line.
        let lastWeek = null;
        if (clanName) {
            const prevWeekId = (0, _storage_js_2.clanBossWeekId)(now - _storage_js_2.CB_WEEK_MS);
            const archive = await _storage_js_1.kv.get((0, _storage_js_2.clanBossArchiveKey)(prevWeekId));
            const mine = archive?.standings?.find(s => (0, _storage_js_2.clanSlug)(s.clanName) === (0, _storage_js_2.clanSlug)(clanName));
            if (mine)
                lastWeek = { rank: mine.rank, score: mine.score, killed: mine.killed };
        }
        res.setHeader('Cache-Control', 'private, max-age=15');
        return res.status(200).json({
            ok: true, active: true,
            weekId, endsAt: week.endsAt,
            boss: boss ? { id: boss.id, name: boss.name, icon: boss.icon, flavor: boss.flavor, mechanic: boss.mechanic } : null,
            inClan: !!clanName,
            myClan,
            standings,
            lastWeek,
        });
    }
    catch (err) {
        console.error('[clan-boss/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
