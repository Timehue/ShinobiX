"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePublishedEventGate = normalizePublishedEventGate;
exports.consumeHollowGateKey = consumeHollowGateKey;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const node_crypto_1 = require("node:crypto");
const _mutate_player_save_js_1 = require("../save/_mutate-player-save.js");
const _run_token_js_1 = require("./_run-token.js");
const _rift_quest_js_1 = require("../sector/_rift-quest.js");
/*
 * /api/hollow-gate/start  — POST only  (docs/hollow-gate-augments.md)
 *
 * Mints a server-sealed run token for a Hollow Gate dive: seals the entry
 * currency snapshot + dive depth, rolls 3 augment offers (the client can't pick
 * the pool), and increments a SERVER daily-run counter (independent of the
 * client's lastDailyReset — closes the backdated-reset extra-dive exploit, #7).
 * Settle later credits min(claimed, sealed ceiling). Body: { playerName, floorDepth }.
 *
 * Inert until the client run loop is wired to it (a later pass, flag-gated), so
 * the existing no-token client path keeps working (token-first invariant).
 */
const DEFAULT_DAILY_RUN_CAP = 2; // base 2/day; attunement raises it in the client-wiring pass
// Hollow Gate runs are RESUMABLE across sessions (the run persists on the save), so
// the token must outlive a dive the player walks away from and finishes later. 24h
// comfortably covers any same-day resume; a run older than that has already crossed
// the UTC daily-cap reset, and an expired token just reverts that run to the
// non-browser compatibility path; shipped browser gameplay requires this seal.
const RUN_TTL_SEC = 24 * 60 * 60;
function utcDateKey() { return new Date().toISOString().slice(0, 10); }
function normalizePublishedEventGate(raw, requestedId) {
    if (!raw || typeof raw !== 'object')
        return null;
    const config = raw;
    if (config.active !== true || String(config.id ?? '') !== requestedId)
        return null;
    const bossAiId = String(config.bossAiId ?? '').trim().slice(0, 128);
    const bossName = String(config.bossName ?? '').trim().slice(0, 64);
    return {
        id: requestedId,
        floors: (0, _run_token_js_1.canonicalHollowGateDepth)(config.maxFloor),
        ...(bossAiId ? { bossAiId } : {}),
        ...(bossName ? { bossName } : {}),
        keyCost: Number(config.keyCost) === 0 ? 0 : 1,
        updatedAt: Math.max(0, Number(config.updatedAt) || 0),
    };
}
async function readPublishedEventGate(requestedId) {
    if (!requestedId || requestedId.startsWith('rift-'))
        return null;
    const saves = await Promise.all([
        _storage_js_1.kv.get('save:admin1'),
        _storage_js_1.kv.get('save:admin2'),
    ]);
    const latest = saves
        .map((save) => save?.hollowGateEventConfig)
        .filter((raw) => Boolean(raw && typeof raw === 'object'))
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0];
    return normalizePublishedEventGate(latest, requestedId);
}
function consumeHollowGateKey(character) {
    const itemId = 'hollow-gate-key';
    const stacks = Array.isArray(character.itemStacks) ? character.itemStacks : [];
    let removed = false;
    const nextStacks = stacks.map((stack) => {
        if (removed || String(stack?.itemId ?? '') !== itemId || Number(stack?.count) <= 0)
            return stack;
        removed = true;
        return { ...stack, count: Math.max(0, Math.floor(Number(stack.count) || 0) - 1) };
    }).filter((stack) => Number(stack?.count) > 0);
    if (removed)
        return { ...character, itemStacks: nextStacks };
    const inventory = Array.isArray(character.inventory) ? character.inventory : [];
    const index = inventory.indexOf(itemId);
    if (index < 0)
        return null;
    return { ...character, inventory: inventory.filter((_, i) => i !== index) };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const requestedVariantId = String(body.variantId ?? '').slice(0, 64);
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only start your own dive.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hollow-gate-start', 20, 60_000, identity.name)))
            return;
        const sealedRift = requestedVariantId.startsWith('rift-')
            ? await _storage_js_1.kv.get(`rift-quest:${playerName}`)
            : null;
        const riftDef = sealedRift?.id === requestedVariantId ? _rift_quest_js_1.RIFT_QUESTS[requestedVariantId] : undefined;
        const eventDef = await readPublishedEventGate(requestedVariantId);
        // Only server-owned Rift quests and the current admin-published event
        // may shorten a dive. Arbitrary client floorDepth input is ignored.
        const floorDepth = riftDef?.floors ?? eventDef?.floors ?? (0, _run_token_js_1.canonicalHollowGateDepth)();
        let issued = null;
        const mutation = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character }) => {
            const freeEntry = Boolean(riftDef) || eventDef?.keyCost === 0;
            const afterKey = identity.admin || freeEntry ? character : consumeHollowGateKey(character);
            if (!afterKey)
                return { ok: false, status: 409, error: 'hollow-gate-key-required' };
            const cap = DEFAULT_DAILY_RUN_CAP + Math.max(0, Math.floor(Number(character.hollowGateRunBonus ?? 0)));
            const countKey = `hg-runs:${playerName}:${utcDateKey()}`;
            const priorRuns = Math.max(0, Math.floor(Number(await _storage_js_1.kv.get(countKey)) || 0));
            if (!identity.admin && priorRuns >= cap)
                return { ok: false, status: 429, error: 'daily-cap' };
            const ord = await _storage_js_1.kv.incr(countKey, { ex: 25 * 60 * 60 });
            const entry = {};
            for (const k of _run_token_js_1.HG_CLAWBACK_KEYS)
                entry[k] = Math.max(0, Math.floor(Number(character[k]) || 0));
            const offers = (0, _run_token_js_1.rollAugmentOffers)(3);
            const token = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
            const runToken = {
                playerName, mintedAt: Date.now(), floorDepth, seed: (0, node_crypto_1.randomUUID)(),
                entryCurrencies: entry,
                entryFragments: (0, _run_token_js_1.itemStackCount)(character.itemStacks, _run_token_js_1.HG_HIGH_VALUE_ITEM_ID),
                offeredAugmentIds: offers.map((o) => o.id), chosenAugmentId: null,
                dailyRunOrdinal: ord,
                ...(riftDef ? {
                    variantId: riftDef.id,
                    bossProfileId: riftDef.bossAiId,
                    bossName: riftDef.bossName,
                } : eventDef ? {
                    variantId: eventDef.id,
                    ...(eventDef.bossAiId ? { bossProfileId: eventDef.bossAiId } : {}),
                    ...(eventDef.bossName ? { bossName: eventDef.bossName } : {}),
                } : {}),
            };
            issued = { token, runToken, offers };
            return {
                ok: true,
                character: {
                    ...afterKey,
                    dailyHollowGateRuns: ord,
                    lastDailyReset: utcDateKey(),
                },
                value: { token },
            };
        });
        if (!mutation.ok) {
            if (mutation.error === 'daily-cap')
                return res.status(200).json({ ok: true, reason: 'daily-cap', token: null });
            return res.status(mutation.status).json({ error: mutation.error });
        }
        if (!issued)
            return res.status(500).json({ error: 'Run token was not issued.' });
        const committed = issued;
        await _storage_js_1.kv.set((0, _run_token_js_1.hollowGateRunKey)(playerName, committed.token), committed.runToken, { ex: RUN_TTL_SEC });
        return res.status(200).json({
            ok: true,
            token: committed.token,
            seed: committed.runToken.seed,
            augmentOffers: committed.offers.map(_run_token_js_1.augmentDisplay),
            character: mutation.character,
            _saveVersion: mutation._saveVersion,
        });
    }
    catch (err) {
        console.error('[hollow-gate/start]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
