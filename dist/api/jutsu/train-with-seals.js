"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
// jutsuId must be a sane slug — lowercase letters/digits/dashes only, length-
// bounded. Stops injection of weird KV keys or path-traversal-ish values.
const JUTSU_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
// Honor Seal cost per jutsu-level increment, indexed by the *current* level
// (the one you're leveling FROM). 30→31 = 20 Seals, etc. Per docs/professions.md.
const SEAL_COSTS_BY_FROM_LEVEL = {
    30: 20,
    31: 25,
    32: 30,
    33: 35,
    34: 40,
    35: 45,
    36: 50,
    37: 55,
    38: 60,
    39: 65,
};
const MIN_LEVEL = 30;
const MAX_LEVEL = 40; // Seal path stops at 40 — 40→50 still requires PvP.
// Vanguard Rank 8+ pays 90% of the listed cost (10% discount).
const VANGUARD_RANK_FOR_DISCOUNT = 8;
const VANGUARD_DISCOUNT_MULT = 0.9;
function computeCost(fromLevel, profession, professionRank) {
    const base = SEAL_COSTS_BY_FROM_LEVEL[fromLevel] ?? 0;
    if (base === 0)
        return 0;
    if (profession === 'vanguard' && Number(professionRank ?? 0) >= VANGUARD_RANK_FOR_DISCOUNT) {
        return Math.ceil(base * VANGUARD_DISCOUNT_MULT);
    }
    return base;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Rate limit: 1 Seal-train per 30s per player. Going faster would let a
    // player race through 30→40 (10 levels) in five minutes flat which trivializes
    // the spec's "skip the PvP grind" intent. 30s also keeps the per-save XP cap
    // meaningful.
    const bodyPeek = typeof req.body === 'string' ? (() => { try {
        return JSON.parse(req.body);
    }
    catch {
        return {};
    } })() : (req.body ?? {});
    const peekName = typeof bodyPeek?.playerName === 'string' ? bodyPeek.playerName : undefined;
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'train-with-seals', 1, 30_000, peekName))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const jutsuId = String(body.jutsuId ?? '').trim().toLowerCase();
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!jutsuId)
            return res.status(400).json({ error: 'Missing jutsuId.' });
        if (!JUTSU_ID_PATTERN.test(jutsuId)) {
            return res.status(400).json({ error: 'Invalid jutsuId format.' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only spend your own Seals.' });
        }
        const key = `save:${playerName}`;
        // Wrap the read-modify-write under lock:save:<name> so two concurrent
        // train-with-seals calls (or one of these + a normal auto-save) can't
        // both read the same balance + mastery row, both apply the same +1
        // level, and the player end up at +2 levels for one cost (or 0
        // levels for two costs depending on write order).
        const lockResult = await (0, _lock_js_1.withKvLock)(key, async () => {
            const record = await _storage_js_1.kv.get(key);
            if (!record)
                return { status: 404, body: { error: 'Player not found.' } };
            const char = record.character;
            if (!char)
                return { status: 404, body: { error: 'Character not found.' } };
            const mastery = char.jutsuMastery ?? [];
            const idx = mastery.findIndex(m => m.jutsuId === jutsuId);
            if (idx === -1)
                return { status: 404, body: { error: 'You have not learned that jutsu.' } };
            const current = mastery[idx];
            const fromLevel = Number(current.level ?? 0);
            // Honor Seal training only opens once the jutsu has been hand-grinded
            // to Lv 30 via ryo training. This prevents Seal-rich players from
            // skipping the entire early jutsu progression. Bloodline-locked
            // jutsu (and any element-gated jutsu) ARE eligible — once you've
            // legitimately trained one to 30, Seals can carry it the rest of
            // the way. The same-village / level / clan restrictions of the
            // bloodline don't change anything for this endpoint.
            if (fromLevel < MIN_LEVEL) {
                return { status: 400, body: { error: `Honor Seal training is only available at level ${MIN_LEVEL}+. Train this jutsu to ${MIN_LEVEL} with ryo first.` } };
            }
            if (fromLevel >= MAX_LEVEL) {
                return { status: 400, body: { error: `Levels ${MAX_LEVEL}+ still require PvP training.` } };
            }
            const cost = computeCost(fromLevel, char.profession, char.professionRank);
            if (cost <= 0)
                return { status: 400, body: { error: 'No cost defined for that level.' } };
            const balance = Number(char.honorSeals ?? 0);
            if (balance < cost) {
                return { status: 402, body: { error: 'Not enough Honor Seals.', cost, balance } };
            }
            // Apply: debit Seals, increment jutsu level.
            const newMastery = [...mastery];
            newMastery[idx] = { ...current, level: fromLevel + 1 };
            const updated = {
                ...record,
                character: {
                    ...char,
                    honorSeals: balance - cost,
                    jutsuMastery: newMastery,
                },
            };
            await _storage_js_1.kv.set(key, (0, _utils_js_1.mergePreservingImages)(updated, record));
            return {
                status: 200,
                body: {
                    ok: true,
                    jutsuId,
                    newLevel: fromLevel + 1,
                    sealsSpent: cost,
                    honorSealsRemaining: balance - cost,
                },
            };
        });
        return res.status(lockResult.status).json(lockResult.body);
    }
    catch (err) {
        console.error('[jutsu/train-with-seals]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
