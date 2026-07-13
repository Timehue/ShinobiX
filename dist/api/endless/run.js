"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _ai_fight_token_js_1 = require("../missions/_ai-fight-token.js");
const _run_js_1 = require("./_run.js");
const cleanToken = (v) => typeof v === 'string' && /^[A-Za-z0-9]{16,96}$/.test(v) ? v : '';
const dayKey = () => new Date().toISOString().slice(0, 10);
const receiptsOf = (character) => Array.isArray(character.redeemedEndlessActions)
    ? character.redeemedEndlessActions.filter((entry) => entry && typeof entry.key === 'string').slice(-128)
    : [];
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const actionRaw = String(body.action ?? '');
        if (!playerName || !['start', 'win', 'cashout', 'abandon'].includes(actionRaw))
            return res.status(400).json({ error: 'Invalid Endless Tower request.' });
        const action = actionRaw;
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your tower run.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'endless-run', 40, 60_000, identity.name)))
            return;
        let spentAiToken = '';
        const result = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            if (action === 'start') {
                const started = (0, _run_js_1.startEndlessRun)(character, (0, node_crypto_1.randomUUID)().replace(/-/g, ''), dayKey());
                if (!started.ok)
                    return { ok: false, status: 409, error: started.reason };
                return { ok: true, character: started.character, value: { run: started.run, resumed: started.resumed, cost: started.cost } };
            }
            const runToken = cleanToken(body.runToken);
            const receipts = receiptsOf(character);
            const requestedKey = action === 'win' ? (0, _ai_fight_token_js_1.cleanAiFightToken)(body.aiFightToken) : runToken;
            const replay = requestedKey ? receipts.find((entry) => entry.key === requestedKey && entry.action === action) : undefined;
            if (replay) {
                const replayRun = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun : undefined;
                return { ok: true, character, value: action === 'win'
                        ? { reward: replay.reward, milestone: replay.milestone, run: replayRun, replayed: true }
                        : { creditedXp: replay.creditedXp, creditedRyo: replay.creditedRyo, abandoned: action === 'abandon', replayed: true } };
            }
            const run = character.endlessTowerRun && typeof character.endlessTowerRun === 'object' ? character.endlessTowerRun : null;
            if (!run || !runToken || run.runToken !== runToken)
                return { ok: false, status: 409, error: 'invalid-or-spent-endless-run' };
            if (action === 'cashout') {
                const paid = (0, _run_js_1.cashOutEndless)(character, run, dayKey());
                const receipt = { key: runToken, action, creditedXp: paid.creditedXp, creditedRyo: paid.creditedRyo };
                return { ok: true, character: { ...paid.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) }, value: { creditedXp: paid.creditedXp, creditedRyo: paid.creditedRyo } };
            }
            if (action === 'abandon') {
                const receipt = { key: runToken, action };
                return { ok: true, character: { ...character, endlessTowerRun: null, redeemedEndlessActions: [...receipts, receipt].slice(-128), ...(body.death === true ? { hp: 0, hospitalized: true } : {}) }, value: { abandoned: true } };
            }
            const aiFightToken = (0, _ai_fight_token_js_1.cleanAiFightToken)(body.aiFightToken);
            if (!aiFightToken)
                return { ok: false, status: 409, error: 'missing-ai-fight-token' };
            const proof = await _storage_js_1.kv.get((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, aiFightToken));
            const wave = Math.max(0, Math.floor(Number(body.wave) || 0));
            if (!proof || proof.playerName.toLowerCase() !== playerName.toLowerCase() || proof.battleKind !== 'endless'
                || !String(proof.opponentId ?? '').endsWith(`-w${wave}`))
                return { ok: false, status: 409, error: 'invalid-endless-win-proof' };
            const won = (0, _run_js_1.recordEndlessWin)(character, run, wave, { hp: body.hp, chakra: body.chakra, stamina: body.stamina });
            if (!won)
                return { ok: false, status: 409, error: 'unexpected-endless-wave' };
            spentAiToken = aiFightToken;
            const receipt = { key: aiFightToken, action, reward: won.reward, milestone: won.milestone };
            const committed = { ...won.character, redeemedEndlessActions: [...receipts, receipt].slice(-128) };
            return { ok: true, character: committed, value: { reward: won.reward, milestone: won.milestone, run: committed.endlessTowerRun } };
        });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        if (spentAiToken)
            await _storage_js_1.kv.del((0, _ai_fight_token_js_1.aiFightTokenKey)(playerName, spentAiToken)).catch(() => undefined);
        return res.status(200).json({ ok: true, ...result.value, character: result.character, _saveVersion: result._saveVersion });
    }
    catch (error) {
        console.error('[endless/run]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
