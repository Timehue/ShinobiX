"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleCurrency = settleCurrency;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _lock_js_1 = require("../_lock.js");
const _save_version_js_1 = require("../save/_save-version.js");
const _run_token_js_1 = require("./_run-token.js");
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
/** Pure: the credited value for one currency given the sealed entry + ceiling.
 *  Never exceeds the ceiling, never restores in-run spends (min with current),
 *  and applies the death claw-back fraction. */
function settleCurrency(current, entry, claimed, ceiling, frac) {
    const credit = Math.floor(Math.min(Math.max(0, claimed), Math.max(0, ceiling)) * frac);
    return Math.max(0, Math.min(num(current), Math.max(0, entry) + credit));
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
        if (!run)
            return res.status(200).json({ ok: true, reason: 'invalid-or-spent' });
        if (run.playerName.toLowerCase() !== playerName.toLowerCase())
            return res.status(403).json({ error: 'Not your run.' });
        // Entity-keyed single-use: keyed on the RUN, so a reconnect/retry (or a
        // co-op partner reporting the same run) collapses to one credit.
        const once = await _storage_js_1.kv.set(`hg-settled:${playerName}:${token}`, '1', { nx: true, ex: 24 * 60 * 60 }).catch(() => 'OK');
        if (once === null)
            return res.status(200).json({ ok: true, alreadyReported: true });
        await _storage_js_1.kv.del(runKey).catch(() => undefined);
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
                return { ok: false };
            const next = { ...c };
            for (const k of _run_token_js_1.HG_CLAWBACK_KEYS) {
                const value = settleCurrency(num(c[k]), num(run.entryCurrencies[k]), num(haul[k]), ceiling[k], frac);
                next[k] = value;
                credited[k] = Math.max(0, value - num(run.entryCurrencies[k]));
            }
            // High-value forge item (Dungeon Legendary Fragment) — anti-fabrication.
            // The client keeps its inline boss-drop grant (byte-identical, no reliability
            // regression); here we only CLAMP this run's GAIN (current minus sealed entry)
            // to the depth ceiling, clawing back a crafted client's excess. No-op for legit
            // hauls. Guarded on entryFragments so tokens minted before this field skip it
            // (a missing baseline can't distinguish run-gain from pre-run holdings).
            const currentFragments = (0, _run_token_js_1.itemStackCount)(c.itemStacks, _run_token_js_1.HG_HIGH_VALUE_ITEM_ID);
            const allowedFragments = typeof run.entryFragments === 'number'
                ? (0, _run_token_js_1.clampFragmentTotal)(currentFragments, run.entryFragments, fragmentCeiling)
                : currentFragments; // token predates the sealed baseline — skip the clamp
            if (allowedFragments < currentFragments && Array.isArray(c.itemStacks)) {
                const others = c.itemStacks
                    .filter((s) => !(s && String(s.itemId ?? '') === _run_token_js_1.HG_HIGH_VALUE_ITEM_ID));
                next.itemStacks = allowedFragments > 0
                    ? [...others, { itemId: _run_token_js_1.HG_HIGH_VALUE_ITEM_ID, count: allowedFragments }]
                    : others;
                fragmentsClampedTo = allowedFragments;
            }
            const updated = (0, _save_version_js_1.bumpSaveVersion)({ ...fresh, character: next });
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updated, fresh));
            return { ok: true };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(404).json({ error: 'Your save was not found.' });
        return res.status(200).json({ ok: true, outcome, credited, fragmentsClampedTo });
    }
    catch (err) {
        console.error('[hollow-gate/settle]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
