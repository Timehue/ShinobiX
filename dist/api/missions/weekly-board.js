"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _weekly_board_js_1 = require("./_weekly-board.js");
const _eligibility_js_1 = require("./_eligibility.js");
const RECORD_PREFIX = 'weekly-board:';
const RECORD_TTL_SECONDS = 16 * 24 * 60 * 60;
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function recordKey(slug, wk) {
    return `${RECORD_PREFIX}${slug}:${wk}`;
}
function villageStateKey(village) {
    return `game:village-state:${String(village ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}
async function missionEligibilityContextFor(char, now) {
    const village = String(char.village ?? '');
    const villageState = village ? await _storage_js_1.kv.get(villageStateKey(village)).catch(() => null) : null;
    const hollowGateUntil = Number(villageState?.hollowGateUnlockedUntil ?? 0);
    return {
        systems: {
            hollowGate: hollowGateUntil > now,
        },
        now,
    };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    try {
        const isGet = req.method === 'GET';
        const body = isGet ? {} : (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(isGet ? (req.query.playerName ?? '') : (body.playerName ?? '')));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        const now = Date.now();
        const wk = (0, _weekly_board_js_1.weekKey)(now);
        const key = recordKey(playerName, wk);
        if (isGet) {
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (save?.character ?? {});
            const eligibilityContext = await missionEligibilityContextFor(char, now);
            const board = (0, _weekly_board_js_1.pickWeeklyBoardForPlayer)(wk, char, undefined, eligibilityContext);
            let record = await _storage_js_1.kv.get(key);
            if (!record) {
                const fresh = { baseline: (0, _weekly_board_js_1.snapshotCounters)(char), claimed: [] };
                const placed = await _storage_js_1.kv.set(key, fresh, { nx: true, ex: RECORD_TTL_SECONDS });
                record = placed ? fresh : (await _storage_js_1.kv.get(key)) ?? fresh;
            }
            const missions = board.map((m) => {
                const progress = Math.min(m.target, (0, _weekly_board_js_1.computeProgress)(m, record.baseline, char));
                return { ...m, progress, complete: progress >= m.target, claimed: record.claimed.includes(m.id) };
            });
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ weekKey: wk, endsAt: (0, _weekly_board_js_1.weekEndsAt)(now), missions });
        }
        if (req.method !== 'POST')
            return res.status(405).end();
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'weekly-board-claim', 30, 60_000, identity.name)))
            return;
        const missionId = typeof body.missionId === 'string'
            ? body.missionId
            : '';
        const requestedCatalogMission = _weekly_board_js_1.WEEKLY_CLAIMABLE_CATALOG.find((m) => m.id === missionId);
        if (!requestedCatalogMission)
            return res.status(400).json({ error: 'That mission is not on this week\'s board.' });
        const out = await (0, _lock_js_1.withKvLock)(`save:${playerName}`, async () => {
            const save = await _storage_js_1.kv.get(`save:${playerName}`);
            const char = (save?.character ?? null);
            if (!save || !char)
                return { status: 404, body: { error: 'Your save was not found.' } };
            const eligibilityContext = await missionEligibilityContextFor(char, now);
            const board = (0, _weekly_board_js_1.pickWeeklyBoardForPlayer)(wk, char, undefined, eligibilityContext);
            const mission = board.find((m) => m.id === missionId);
            if (!mission) {
                const check = (0, _eligibility_js_1.canPlayerClaimMission)(char, requestedCatalogMission, eligibilityContext);
                if (!check.ok)
                    return { status: 403, body: (0, _eligibility_js_1.missionEligibilityFailureBody)(check) };
                return { status: 400, body: { error: 'That mission is not on this week\'s board.' } };
            }
            const claimEligibility = (0, _eligibility_js_1.canPlayerClaimMission)(char, mission, eligibilityContext);
            if (!claimEligibility.ok)
                return { status: 403, body: (0, _eligibility_js_1.missionEligibilityFailureBody)(claimEligibility) };
            let record = await _storage_js_1.kv.get(key);
            if (!record)
                record = { baseline: (0, _weekly_board_js_1.snapshotCounters)(char), claimed: [] };
            if (record.claimed.includes(mission.id)) {
                return { status: 200, body: {
                        ok: true,
                        alreadyClaimed: true,
                        balances: { ryo: num(char.ryo), fateShards: num(char.fateShards), boneCharms: num(char.boneCharms) },
                        _saveVersion: Number(save._saveVersion ?? 0),
                    } };
            }
            const progress = (0, _weekly_board_js_1.computeProgress)(mission, record.baseline, char);
            if (progress < mission.target) {
                return { status: 400, body: { error: 'That mission is not complete yet.', progress, target: mission.target } };
            }
            const r = mission.reward;
            const nextChar = {
                ...char,
                ryo: num(char.ryo) + (r.ryo ?? 0),
                fateShards: num(char.fateShards) + (r.fateShards ?? 0),
                boneCharms: num(char.boneCharms) + (r.boneCharms ?? 0),
            };
            const nextRecord = { baseline: record.baseline, claimed: [...record.claimed, mission.id] };
            await _storage_js_1.kv.set(key, nextRecord, { ex: RECORD_TTL_SECONDS });
            const updatedSave = (0, _save_version_js_1.bumpSaveVersion)({ ...save, character: nextChar });
            await _storage_js_1.kv.set(`save:${playerName}`, (0, _utils_js_1.mergePreservingImages)(updatedSave, save));
            return { status: 200, body: {
                    ok: true,
                    reward: r,
                    missionId: mission.id,
                    balances: { ryo: num(nextChar.ryo), fateShards: num(nextChar.fateShards), boneCharms: num(nextChar.boneCharms) },
                    _saveVersion: Number(updatedSave._saveVersion ?? 0),
                } };
        }, { failClosed: true });
        if (out.status === 200 && out.body.ok && !out.body.alreadyClaimed) {
            await _storage_js_1.kv.set(`audit:weekly-board:${now}`, { ts: now, player: playerName, wk, missionId: out.body.missionId, reward: out.body.reward }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        console.error('[missions/weekly-board]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
