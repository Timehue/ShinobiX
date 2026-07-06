"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _sunscar_js_1 = require("./_sunscar.js");
function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
/*
 * /api/festival/sunscar - POST
 *
 * Server-side Sunscar settlement. Dice are fully rolled and paid here; Miraa
 * wager settlement is locked to fixed bet/outcome deltas so the client no longer
 * edits ryo directly.
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
        const kind = String(body.kind ?? '');
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'You can only act for your own account.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'sunscar-festival', 40, 60_000, identity.name)))
            return;
        if (kind === 'dice') {
            const today = (0, _sunscar_js_1.utcDateKey)();
            const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
                const used = String(character.lastDailyReset ?? '') === today
                    ? Math.max(0, Math.floor(Number(character.dailyFateSpins ?? 0) || 0))
                    : 0;
                if (used >= _sunscar_js_1.FATE_DICE_DAILY_CAP) {
                    return {
                        ok: false,
                        status: 429,
                        error: `The dice grow cold. Your fate is spent for today (${_sunscar_js_1.FATE_DICE_DAILY_CAP}/${_sunscar_js_1.FATE_DICE_DAILY_CAP}).`,
                    };
                }
                if (num(character.ryo) < _sunscar_js_1.FATE_DICE_COST) {
                    return { ok: false, status: 400, error: `Not enough ryo. A roll costs ${_sunscar_js_1.FATE_DICE_COST}.` };
                }
                const result = (0, _sunscar_js_1.rollFateDice)(Math.random);
                const paid = { ...character, ryo: num(character.ryo) - _sunscar_js_1.FATE_DICE_COST };
                const leveled = (0, _xp_engine_js_1.gainXp)(paid, result.reward.xp);
                const nextCharacter = {
                    ...character,
                    ...leveled,
                    ryo: num(leveled.ryo) + result.reward.ryo,
                    stamina: Math.min(num(leveled.maxStamina), num(leveled.stamina) + result.reward.stamina),
                    boneCharms: num(leveled.boneCharms) + result.reward.boneCharms,
                    fateShards: num(leveled.fateShards) + result.reward.fateShards,
                    auraStones: num(leveled.auraStones) + result.reward.auraStones,
                    dailyFateSpins: used + 1,
                    lastDailyReset: today,
                };
                return { ok: true, character: nextCharacter, value: { ...result, dailyUsed: used + 1, dailyCap: _sunscar_js_1.FATE_DICE_DAILY_CAP, cost: _sunscar_js_1.FATE_DICE_COST } };
            });
            if (!out.ok)
                return res.status(out.status).json({ error: out.error });
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }
        if (kind === 'miraa') {
            const bet = (0, _sunscar_js_1.cleanMiraaBet)(body.bet);
            const outcome = (0, _sunscar_js_1.cleanMiraaOutcome)(body.outcome);
            if (!bet || !outcome)
                return res.status(400).json({ error: 'Invalid Miraa wager.' });
            const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
                if (num(character.ryo) < bet)
                    return { ok: false, status: 400, error: 'Not enough ryo for that wager.' };
                const delta = (0, _sunscar_js_1.miraaRyoDelta)(bet, outcome);
                const nextCharacter = { ...character, ryo: Math.max(0, num(character.ryo) + delta) };
                return { ok: true, character: nextCharacter, value: { bet, outcome, delta, balanceRyo: num(nextCharacter.ryo) } };
            });
            if (!out.ok)
                return res.status(out.status).json({ error: out.error });
            return res.status(200).json({ ok: true, ...out.value, character: out.character, _saveVersion: out._saveVersion });
        }
        return res.status(400).json({ error: 'Unknown festival action.' });
    }
    catch (err) {
        console.error('[festival/sunscar]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
