"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _auth_js_1 = require("../_auth.js");
const _economy_js_1 = require("../_economy.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _utils_js_1 = require("../_utils.js");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _war_crate_js_1 = require("./_war-crate.js");
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
        const identityName = await (0, _auth_js_1.authedPlayer)(req, playerName);
        if (!identityName)
            return res.status(401).json({ error: 'Authentication required.' });
        if (identityName !== playerName)
            return res.status(403).json({ error: 'You can only open your own war crates.' });
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'open-war-crate', 10, 60_000, identityName, { strict: true })))
            return;
        const out = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, ({ character }) => {
            const opened = (0, _war_crate_js_1.applyWarCrateOpen)(character, Math.random());
            if (!opened.ok)
                return opened;
            return { ok: true, character: opened.character, value: opened.rewards };
        });
        if (!out.ok)
            return res.status(out.status).json({ error: out.error });
        const now = Date.now();
        const balances = out.character;
        const entries = [
            { currency: 'ryo', delta: out.value.ryo, balanceAfter: Number(balances.ryo ?? 0) },
            { currency: 'honorSeals', delta: out.value.honorSeals, balanceAfter: Number(balances.honorSeals ?? 0) },
            { currency: 'boneCharms', delta: out.value.boneCharms, balanceAfter: Number(balances.boneCharms ?? 0) },
        ];
        await Promise.all(entries.filter((entry) => entry.delta > 0).map((entry) => (0, _economy_js_1.recordEconomyTxn)({
            txnId: `war-crate-open:${playerName}:${entry.currency}:${now}`,
            player: playerName,
            currency: entry.currency,
            delta: entry.delta,
            source: 'inventory.war-crate-open',
            balanceAfter: entry.balanceAfter,
        })));
        return res.status(200).json({ ok: true, rewards: out.value, character: out.character, _saveVersion: out._saveVersion });
    }
    catch (error) {
        console.error('[inventory/open-war-crate]', error);
        return res.status(503).json({ error: 'Could not open the war crate. Nothing was changed; please retry.' });
    }
}
