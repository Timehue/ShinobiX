"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { targetName, attacker } = body;
        if (!targetName)
            return res.status(400).json({ error: 'Missing targetName.' });
        const key = `presence:${targetName}`;
        const target = await _storage_js_1.kv.get(key);
        if (!target)
            return res.status(404).json({ error: 'Target not online.' });
        // Block attack if the target is currently traveling between sectors.
        const travelingUntil = Number(target.travelingUntil ?? 0);
        if (travelingUntil > Date.now()) {
            return res.status(409).json({ error: 'Target is traveling and cannot be attacked.' });
        }
        // Block attack if the target already has a pending attacker (double-battle prevention).
        if (target.pendingAttacker) {
            return res.status(409).json({ error: 'Target is already engaged in combat.' });
        }
        // Block attack if the target is in an active PvP battle.
        if (target.inBattle) {
            return res.status(409).json({ error: 'Target is already in a battle.' });
        }
        await _storage_js_1.kv.set(key, { ...target, pendingAttacker: attacker ?? null }, { ex: 60 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
