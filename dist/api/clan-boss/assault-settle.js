"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _lock_js_1 = require("../_lock.js");
const _tower_store_js_1 = require("../towers/_tower-store.js");
const _assault_js_1 = require("./_assault.js");
const _storage_js_1 = require("./_storage.js");
/*
 * POST /api/clan-boss/assault-settle — bank a FINISHED clan-boss assault into the
 * clan's weekly pool. The result (damage/rounds/wipe/clean) is read from the
 * server-authoritative tower session — the client reports nothing. Idempotent: the
 * assault side-record's `settled` flag (checked + set under the progress lock)
 * guarantees a run banks exactly once. Gated off — 404 unless ENABLE_CLAN_BOSS==='1'.
 * Body: { runId, playerName }.
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
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '');
        if (!playerName || !runId)
            return res.status(400).json({ error: 'Missing player or run.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Can only settle as yourself.' });
        const assault = await (0, _assault_js_1.loadAssault)(runId);
        if (!assault)
            return res.status(404).json({ error: 'Not a clan-boss assault.' });
        if (!identity.admin && !assault.party.includes(playerName)) {
            return res.status(403).json({ error: 'You were not in this assault.' });
        }
        const session = await (0, _tower_store_js_1.readSession)(runId);
        if (!session)
            return res.status(404).json({ error: 'That assault has expired.' });
        if (session.status !== 'done')
            return res.status(400).json({ error: 'The fight is not finished yet.' });
        const result = (0, _assault_js_1.extractAssaultResult)(session);
        const week = await (0, _storage_js_1.loadClanBossWeek)(assault.weekId);
        const now = Date.now();
        const outcome = await (0, _lock_js_1.withKvLock)((0, _storage_js_1.clanBossProgressKey)(assault.weekId, assault.clanName), async () => {
            // Re-read the side-record inside the lock for exactly-once banking.
            const fresh = await (0, _assault_js_1.loadAssault)(runId);
            if (!fresh)
                return { status: 404, body: { error: 'Not a clan-boss assault.' } };
            if (fresh.settled) {
                const p = await (0, _storage_js_1.loadClanBossProgress)(assault.weekId, assault.clanName);
                return { status: 200, body: { ok: true, alreadySettled: true, pool: p?.pool ?? 0, poolMax: p?.poolMax ?? 0, killed: !!p?.killedAt } };
            }
            const progress = (await (0, _storage_js_1.loadClanBossProgress)(assault.weekId, assault.clanName))
                ?? (week ? (0, _storage_js_1.newClanBossProgress)(assault.clanName, week, 1) : null);
            if (!progress)
                return { status: 400, body: { error: 'No active clan boss to bank into.' } };
            const next = (0, _storage_js_1.bankAssault)(progress, {
                runId, by: assault.host, party: assault.party,
                damage: result.damage, rounds: result.rounds, wiped: result.wiped, clean: result.clean, at: now,
            });
            await (0, _storage_js_1.saveClanBossProgress)(next);
            await (0, _assault_js_1.saveAssault)({ ...fresh, settled: true });
            return {
                status: 200,
                body: {
                    ok: true, result, pool: next.pool, poolMax: next.poolMax,
                    killed: !!next.killedAt, justKilled: !!next.killedAt && !progress.killedAt,
                },
            };
        }, { failClosed: true });
        return res.status(outcome.status).json(outcome.body);
    }
    catch (err) {
        console.error('[clan-boss/assault-settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
