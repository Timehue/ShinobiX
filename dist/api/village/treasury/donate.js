"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _treasury_donate_js_1 = require("../../_treasury-donate.js");
/*
 * /api/village/treasury/donate  — POST only
 *
 * Atomic village-treasury donation — the village twin of
 * api/clan/treasury/donate.ts. The old flow credited state.treasury and
 * POSTed the whole villageState blob in one write while debiting the donor's
 * save in another, so the village-state validator (api/_village-state-validate.ts)
 * trusted a treasury credit it couldn't tie to a real debit (and couldn't
 * verify donated-item ownership). This endpoint debits the donor AND credits
 * the village treasury under dual locks so the halves can't be separated.
 *
 * It deliberately mutates ONLY the treasury on the village-state row and
 * preserves every other field; the incidental rewards (contributionPoints,
 * the donation notice) stay client-side and are written on top of the
 * treasury value this returns.
 *
 * Body (currency):  { playerName, village, currency, amount }
 * Body (item):      { playerName, village, itemId, count? }   // count defaults to 1
 *
 * Caller MUST be the donor (or admin) and a member of `village`. Rate-limited
 * at 30/min per actor. Locks: village-state row (outer) + donor save row (inner).
 */
const VILLAGE_STATE_PREFIX = 'game:village-state:';
// Player-donatable village currencies (honorSeals included, unlike clans).
const VILLAGE_CURRENCIES = ['ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'];
const CURRENCY_CAPS = {
    ryo: 10_000_000,
    honorSeals: 100_000,
    fateShards: 100_000,
    boneCharms: 100_000,
    auraStones: 100_000,
    mythicSeals: 100_000,
};
const ITEM_COUNT_CAP = 1_000;
const AUDIT_LOG_PREFIX = 'audit:village-treasury-donate:';
function villageSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function parseDonation(body) {
    const currency = typeof body.currency === 'string' ? body.currency : undefined;
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : undefined;
    const hasCurrency = !!currency;
    const hasItem = !!itemId;
    if (hasCurrency === hasItem)
        return null; // need exactly one
    if (hasCurrency) {
        return { kind: 'currency', currency: currency, amount: Math.floor(Number(body.amount)) };
    }
    const count = body.count === undefined ? 1 : Math.floor(Number(body.count));
    return { kind: 'item', itemId: itemId, count };
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
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        if (!playerName || !village) {
            return res.status(400).json({ error: 'Missing playerName or village.' });
        }
        const donation = parseDonation(body);
        if (!donation) {
            return res.status(400).json({ error: 'Provide exactly one of (currency + amount) or (itemId).' });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only donate your own resources.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-treasury-donate', 30, 60_000, identity.name)))
            return;
        const slug = villageSlug(village);
        if (!slug)
            return res.status(400).json({ error: 'Invalid village name.' });
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${slug}`;
        const donorSaveKey = `save:${playerName}`;
        // ── Atomic donate ──────────────────────────────────────────────
        // Village-state row locked first (shared resource), donor save row
        // inner. Donor debit committed before the treasury credit — same
        // debit-first ordering as the clan endpoint, so a credit failure
        // can't mint free treasury.
        const result = await (0, _lock_js_1.withKvLock)(villageStateKey, async () => {
            const stateRec = (await _storage_js_1.kv.get(villageStateKey)) ?? {};
            const debit = await (0, _lock_js_1.withKvLock)(donorSaveKey, async () => {
                const donorRec = await _storage_js_1.kv.get(donorSaveKey);
                const donorChar = (donorRec?.character ?? null);
                if (!donorChar)
                    return { ok: false, status: 404, error: 'Donor save not found.' };
                // Membership: donor must belong to this village.
                if (!identity.admin && String(donorChar.village ?? '').trim() !== village) {
                    return { ok: false, status: 403, error: 'You are not a member of this village.' };
                }
                const outcome = (0, _treasury_donate_js_1.applyTreasuryDonation)(stateRec.treasury, donorChar, donation, { allowedCurrencies: VILLAGE_CURRENCIES, currencyCaps: CURRENCY_CAPS, itemCountCap: ITEM_COUNT_CAP });
                if (!outcome.ok)
                    return outcome;
                await _storage_js_1.kv.set(donorSaveKey, { ...donorRec, character: outcome.nextDonorChar });
                return { ok: true, nextTreasury: outcome.nextTreasury };
            }, { failClosed: true });
            if (!debit.ok)
                return debit;
            // Credit ONLY the treasury; preserve every other village-state field.
            await _storage_js_1.kv.set(villageStateKey, { ...stateRec, treasury: debit.nextTreasury });
            return { ok: true, treasury: debit.nextTreasury };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${slug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            village,
            ...(donation.kind === 'currency'
                ? { currency: donation.currency, amount: Math.floor(donation.amount) }
                : { itemId: donation.itemId, count: Math.floor(donation.count) }),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({ ok: true, treasury: result.treasury });
    }
    catch (err) {
        console.error('[village/treasury/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
