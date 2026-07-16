"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const shrines_js_1 = require("../../shared/shrines.js");
const _traces_js_1 = require("./_traces.js");
/*
 * /api/sector/shrine-offer — POST only
 *
 * Offer ryo at a sector shrine (shared/shrines.ts). This is a pure currency
 * SINK: the server debits the save under the usual failClosed save lock and
 * credits the shrine ledger (lifetime total → cosmetic tier, weekly top-offerer
 * board) — no payout path exists, so there is nothing to farm. Standing at the
 * shrine matters: the actor must be live in the shrine's sector, not traveling
 * and not mid-battle (the same authoritative co-presence gate world attacks
 * re-check at action time).
 *
 * Body: { playerName, shrineId, amount }
 * → { ok:true, shrine:{…}, ryo } | { ok:false, reason } | { error }
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const def = (0, shrines_js_1.shrineById)(typeof body.shrineId === 'string' ? body.shrineId : '');
        if (!def)
            return res.status(400).json({ error: 'Unknown shrine.' });
        const amount = Math.floor(Number(body.amount ?? NaN));
        if (!Number.isFinite(amount) || amount < shrines_js_1.SHRINE_MIN_OFFERING || amount > shrines_js_1.SHRINE_MAX_OFFERING) {
            return res.status(400).json({ error: `Offerings are ${shrines_js_1.SHRINE_MIN_OFFERING.toLocaleString()}–${shrines_js_1.SHRINE_MAX_OFFERING.toLocaleString()} ryo.` });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'shrine-offer', 10, 60_000, identity.name, { strict: true })))
            return;
        // Validate co-presence at action time (never trust the client's roster).
        const now = Date.now();
        if (!identity.admin) {
            const actor = online_store_js_1.onlineStore.get(playerName);
            if (!actor)
                return res.status(409).json({ error: 'World presence is not ready. Please try again.' });
            if (actor.sector !== def.sector)
                return res.status(409).json({ error: `Travel to ${def.name} in sector ${def.sector} to make an offering.` });
            if (actor.travelingUntil && actor.travelingUntil > now)
                return res.status(409).json({ error: 'You cannot make an offering while traveling.' });
            if (actor.inBattle)
                return res.status(409).json({ error: 'You cannot make an offering mid-battle.' });
        }
        // Shrine lock wraps the save debit (the settleTravelLease nesting precedent:
        // shared-resource lock outside, per-save lock inside via mutatePlayerSave).
        const out = await (0, _lock_js_1.withKvLock)((0, _traces_js_1.shrineKey)(def.id), async () => {
            const debit = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
                const ryo = Math.floor(Number(character.ryo ?? 0)) || 0;
                if (ryo < amount) {
                    return { ok: false, status: 400, error: `Not enough ryo — you have ${ryo.toLocaleString()}.` };
                }
                return { ok: true, character: { ...character, ryo: ryo - amount }, value: ryo - amount };
            });
            if (!debit.ok)
                return { status: debit.status, body: { error: debit.error } };
            const state = (0, _traces_js_1.applyOffering)((0, _traces_js_1.parseShrineState)(await _storage_js_1.kv.get((0, _traces_js_1.shrineKey)(def.id))), playerName, amount, now);
            await _storage_js_1.kv.set((0, _traces_js_1.shrineKey)(def.id), state);
            const tier = (0, shrines_js_1.shrineTier)(state.total);
            return {
                status: 200,
                body: {
                    ok: true,
                    ryo: debit.value,
                    shrine: {
                        id: def.id,
                        name: def.name,
                        region: def.region,
                        blessing: def.blessing,
                        tier,
                        total: state.total,
                        weekTotal: state.weekTotal,
                        topWeek: state.topWeek.slice(0, _traces_js_1.TOP_OFFERERS_SHOWN),
                        lastWeek: state.lastWeek
                            ? { week: state.lastWeek.week, topWeek: state.lastWeek.topWeek.slice(0, _traces_js_1.TOP_OFFERERS_SHOWN) }
                            : null,
                    },
                },
            };
        }, { failClosed: true });
        return res.status(out.status).json(out.body);
    }
    catch (err) {
        if (err instanceof _lock_js_1.LockContendedError) {
            return res.status(503).json({ error: 'The shrine is busy — please retry.' });
        }
        console.error('[sector/shrine-offer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
