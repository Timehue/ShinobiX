"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleCurrency = settleCurrency;
exports.addCountedItem = addCountedItem;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _run_token_js_1 = require("./_run-token.js");
const _xp_engine_js_1 = require("../_xp-engine.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _era_js_1 = require("../_era.js");
/*
 * /api/hollow-gate/settle  — POST only  (docs/hollow-gate-augments.md)
 *
 * The authoritative payout for a dive. Reads the sealed token (depth + entry
 * snapshot + chosen augment), computes the per-currency ceiling
 * maxHaulForDepth(depth, sealedMultiplier), and credits min(client-claimed,
 * ceiling) — anchored to the sealed entry so a crafted client can neither inflate
 * the haul nor smuggle a bigger multiplier. Death applies a server-computed ×0.5
 * claw-back. Single-use (NX hg-settled entity key → reconnect/retry/co-op pays
 * once). Body: { playerName, token, outcome: 'extract'|'death', haul: {currency:n} }.
 *
 * pure helper exported for the test.
 */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** Pure: credit a sealed, ceiling-bounded haul onto the stored wallet.
 * Generic saves cannot pre-credit the haul, so settlement is the sole positive
 * writer. In-run spending is preserved and the total stays within entry+credit. */
function settleCurrency(current, entry, claimed, ceiling, frac) {
    const credit = Math.floor(Math.min(Math.max(0, claimed), Math.max(0, ceiling)) * frac);
    return Math.max(0, Math.min(num(current) + credit, Math.max(0, entry) + credit));
}
function addCountedItem(itemStacks, itemId, amountRaw) {
    const amount = Math.max(0, Math.floor(num(amountRaw)));
    const stacks = Array.isArray(itemStacks) ? itemStacks : [];
    if (!amount)
        return stacks;
    let found = false;
    const next = stacks.map((stack) => {
        if (!stack || String(stack.itemId ?? '') !== itemId)
            return stack;
        found = true;
        return { ...stack, count: Math.max(0, Math.floor(num(stack.count))) + amount };
    });
    return found ? next : [...next, { itemId, count: amount }];
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
        const token = String(body.token ?? '').slice(0, 64);
        const outcome = body.outcome === 'death' ? 'death' : 'extract';
        const haul = (body.haul && typeof body.haul === 'object') ? body.haul : {};
        if (!playerName || !token)
            return res.status(400).json({ error: 'Missing playerName or token.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your run.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hollow-gate-settle', 20, 60_000, identity.name)))
            return;
        const runKey = `hg-run:${playerName}:${token}`;
        const run = await _storage_js_1.kv.get(runKey);
        // Graceful: a stale client (or SESSION_SECRET unset re-mint) just gets a
        // no-op — never a save-breaking error (token-first invariant).
        if (!run) {
            // A retry can arrive after the single-use run token was consumed. Return
            // the current committed character so the client can still reconcile a
            // response that was lost after the save write succeeded.
            const current = await _storage_js_1.kv.get(`save:${playerName}`);
            return res.status(200).json({
                ok: true,
                reason: 'invalid-or-spent',
                character: current?.character ?? null,
                _saveVersion: Number(current?._saveVersion ?? 0),
            });
        }
        if (run.playerName.toLowerCase() !== playerName.toLowerCase())
            return res.status(403).json({ error: 'Not your run.' });
        const runAgeMs = Date.now() - Number(run.mintedAt ?? 0);
        if (outcome === 'extract' && runAgeMs < 3 * 60 * 1000) {
            return res.status(409).json({ error: 'The run is too new to extract.' });
        }
        const mult = (0, _run_token_js_1.rewardMultiplierForToken)(run);
        const ceiling = (0, _run_token_js_1.maxHaulForDepth)(run.floorDepth, mult);
        const frac = outcome === 'death' ? 0.5 : 1;
        const credited = {};
        const fragmentCeiling = (0, _run_token_js_1.maxFragmentsForDepth)(run.floorDepth);
        let fragmentsClampedTo = null;
        const saveKey = `save:${playerName}`;
        const result = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const fresh = await _storage_js_1.kv.get(saveKey);
            const c = (fresh?.character ?? null);
            if (!fresh || !c)
                return { ok: false, character: null, _saveVersion: 0 };
            const redeemedRuns = Array.isArray(c.redeemedHollowGateRuns)
                ? c.redeemedHollowGateRuns.filter((entry) => typeof entry === 'string')
                : [];
            if (redeemedRuns.includes(token)) {
                return { ok: true, alreadyReported: true, character: c, _saveVersion: Number(fresh._saveVersion ?? 0) };
            }
            let next = { ...c };
            for (const k of _run_token_js_1.HG_CLAWBACK_KEYS) {
                const value = settleCurrency(num(c[k]), num(run.entryCurrencies[k]), num(haul[k]), ceiling[k], frac);
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            // Generic saves reject XP and ownership additions. Credit the bounded
            // run tallies here so legitimate Hollow Gate rewards survive autosave.
            const xpCredit = Math.floor(Math.min(Math.max(0, num(haul.xp)), (0, _run_token_js_1.maxXpForDepth)(run.floorDepth, mult)));
            next = (0, _xp_engine_js_1.gainXp)(next, xpCredit);
            const fragmentCredit = Math.min(Math.max(0, Math.floor(num(haul.fragments))), fragmentCeiling);
            const veilCredit = Math.min(Math.max(0, Math.floor(num(haul.veils))), (0, _run_token_js_1.maxVeilsForDepth)(run.floorDepth));
            next.itemStacks = addCountedItem(next.itemStacks, _run_token_js_1.HG_HIGH_VALUE_ITEM_ID, fragmentCredit);
            next.itemStacks = addCountedItem(next.itemStacks, 'veil-of-the-hollow', veilCredit);
            // Each cleared Warden contributes one of the claimed fragments; the
            // sealed depth bounds this counter even though the Tier-1 run model
            // does not re-simulate each room.
            if (outcome === 'extract' && run.floorDepth === _run_token_js_1.HOLLOW_GATE_SERVER_DEPTH && fragmentCredit > 0) {
                next.hollowGateWardenKills = num(next.hollowGateWardenKills) + 1;
            }
            next.redeemedHollowGateRuns = [...redeemedRuns.slice(-99), token];
            fragmentsClampedTo = (0, _run_token_js_1.itemStackCount)(next.itemStacks, _run_token_js_1.HG_HIGH_VALUE_ITEM_ID);
            const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...fresh, character: next });
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, fresh));
            return {
                ok: true,
                alreadyReported: false,
                character: next,
                _saveVersion: Number(updated._saveVersion ?? 0),
            };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(404).json({ error: 'Your save was not found.' });
        await _storage_js_1.kv.set(`hg-settled:${playerName}:${token}`, '1', { ex: 24 * 60 * 60 }).catch(() => undefined);
        await _storage_js_1.kv.del(runKey).catch(() => undefined);
        if (result.alreadyReported) {
            return res.status(200).json({ ok: true, alreadyReported: true, character: result.character, _saveVersion: result._saveVersion });
        }
        // Legacy tracking (ENABLE_LEGACY): only a successful EXTRACTION counts
        // as a clear — deaths settle currency but don't feed Legacy progress.
        // Anti-farm gate: an instant start→settle round-trip is not a dive; a
        // clear needs the run to have lived a few real minutes (the currency
        // ceiling already bounds the loot side; verification finding).
        if (outcome === 'extract' && runAgeMs >= 3 * 60 * 1000) {
            await (0, _legacy_track_js_1.bumpLegacyStats)(playerName, { hollowGateClears: 1, dungeonClears: 1, eliteKills: 2 });
            await (0, _era_js_1.bumpEraContribution)('gateClears');
        }
        return res.status(200).json({
            ok: true,
            outcome,
            credited,
            fragmentsClampedTo,
            character: result.character,
            _saveVersion: result._saveVersion,
        });
    }
    catch (err) {
        console.error('[hollow-gate/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
