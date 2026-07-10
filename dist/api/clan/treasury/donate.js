"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _treasury_donate_js_1 = require("../../_treasury-donate.js");
const _mutate_player_save_js_1 = require("../../save/_mutate-player-save.js");
const _economy_tx_js_1 = require("../../_economy-tx.js");
const _mission_catalog_js_1 = require("../_mission-catalog.js");
/*
 * /api/clan/treasury/donate  — POST only
 *
 * Atomic clan-treasury donation. The old flow was two separate client writes:
 *   1) client credits clanData.treasury and POSTs the whole clan-<slug> blob
 *   2) client debits its own save in a separate /api/save POST
 *
 * Because the clan-save validator (api/_clan-save-validate.ts) trusted the
 * incoming treasury and could not verify the donor actually debited (or that
 * a donated item was ever owned), a crafted client could credit the treasury
 * — or mint never-owned items into treasury.items — without debiting anything.
 *
 * This endpoint is the intended path: it debits the donor's save AND credits
 * the clan treasury under dual locks, so the two halves can't be separated. It
 * also credits the clan's (member-scaled) donation XP server-side and returns
 * the new { treasury, xp, level }. Clan XP is NO LONGER written by the client —
 * the save validator now pins clan xp/level so a crafted client can't forge a
 * level jump (see api/_clan-save-validate.ts). clanEventContrib stays a personal
 * per-player counter, applied client-side on the donor's own save.
 *
 * Body (currency):  { playerName, clan, currency, amount }
 * Body (item):      { playerName, clan, itemId, count? }   // count defaults to 1
 *
 * Caller MUST be the donor (or admin) and a member of `clan`. Rate-limited at
 * 30/min per actor. Locks held: clan save row (outer) + donor save row (inner).
 */
// Player-donatable clan currencies. warSupply is war-earned, not donated.
const CLAN_CURRENCIES = ['ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'];
// Per-call sanity ceilings. Unlike the validator's defense-in-depth caps,
// crediting a clan treasury is not itself an attack (funds leave the donor and
// land in the shared clan pool, recoverable by leadership) — the real exploit
// the atomic debit closes is credit-without-debit. These bounds only stop
// absurd / overflow inputs; the binding limit is the donor's own balance.
const CURRENCY_CAPS = {
    ryo: 10_000_000,
    fateShards: 100_000,
    boneCharms: 100_000,
    auraStones: 100_000,
    mythicSeals: 100_000,
};
const ITEM_COUNT_CAP = 1_000;
const AUDIT_LOG_PREFIX = 'audit:clan-treasury-donate:';
// Member-scaled clan XP for a donation, matching the amounts the client used to
// apply on top of the returned treasury (now server-authoritative): ryo
// floor(amount/35), other currencies amount*200, items count*20. The caller
// scales the result by the clan's member count (10–15 members = 1.0×; small
// clans dampened, capped) via scaledClanXp.
function donationClanXp(donation) {
    if (donation.kind === 'currency') {
        const amount = Math.max(0, Math.floor(Number(donation.amount) || 0));
        return donation.currency === 'ryo' ? Math.floor(amount / 35) : amount * 200;
    }
    return Math.max(0, Math.floor(Number(donation.count) || 0)) * 20;
}
function clanSlugBare(name) {
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
    let txId = null;
    let txState = null;
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const clan = typeof body.clan === 'string' ? body.clan.trim() : '';
        if (!playerName || !clan) {
            return res.status(400).json({ error: 'Missing playerName or clan.' });
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
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-treasury-donate', 30, 60_000, identity.name)))
            return;
        const targetSlug = clanSlugBare(clan);
        if (!targetSlug)
            return res.status(400).json({ error: 'Invalid clan name.' });
        const clanSaveKey = `save:clan-${targetSlug}`;
        const donorSaveKey = `save:${playerName}`;
        txId = (0, _economy_tx_js_1.makeEconomyTxId)('clan-treasury-donate');
        // ── Atomic donate ──────────────────────────────────────────────
        // Lock the clan save row (the shared, contended resource) first,
        // then the donor save row. The donor debit is COMMITTED before the
        // treasury credit, so a credit failure can never leave the treasury
        // credited without a matching debit (the only outcome of a mid-way
        // failure is the donor losing the funds, which is recoverable and
        // not a free-mint exploit). No other code path takes these two
        // locks in the opposite order, so the nesting can't deadlock.
        const result = await (0, _lock_js_1.withKvLock)(clanSaveKey, async () => {
            const clanRec = await _storage_js_1.kv.get(clanSaveKey);
            if (!clanRec)
                return { ok: false, status: 404, error: 'Clan not found.' };
            const debit = await (0, _mutate_player_save_js_1.mutatePlayerSave)(playerName, async ({ character: donorChar }) => {
                // Membership: donor's character.clan must resolve to this clan.
                if (!identity.admin) {
                    const donorClanSlug = clanSlugBare(String(donorChar.clan ?? ''));
                    if (!donorClanSlug || donorClanSlug !== targetSlug) {
                        return { ok: false, status: 403, error: 'You are not a member of this clan.' };
                    }
                }
                const outcome = (0, _treasury_donate_js_1.applyTreasuryDonation)(clanRec.treasury, donorChar, donation, { allowedCurrencies: CLAN_CURRENCIES, currencyCaps: CURRENCY_CAPS, itemCountCap: ITEM_COUNT_CAP });
                if (!outcome.ok)
                    return outcome;
                const amount = donation.kind === 'currency' ? Math.floor(donation.amount) : Math.floor(donation.count);
                await (0, _economy_tx_js_1.reserveEconomyTx)({
                    id: txId,
                    kind: 'clan-treasury-donate',
                    debitKey: donorSaveKey,
                    creditKey: clanSaveKey,
                    resource: donation.kind === 'currency' ? donation.currency : `item:${donation.itemId}`,
                    amount,
                    meta: { clan, playerName },
                });
                txState = 'reserved';
                return { ok: true, character: outcome.nextDonorChar, value: { nextTreasury: outcome.nextTreasury } };
            });
            if (!debit.ok)
                return debit;
            await (0, _economy_tx_js_1.markEconomyTx)(txId, 'debit-applied');
            txState = 'debit-applied';
            // Credit the clan treasury (donor debit is already committed) +
            // member-scaled clan XP, both persisted under the clan lock. The
            // client no longer writes xp (the validator now pins it), so this is
            // the sole path that levels a clan from donations.
            const memberCount = Array.isArray(clanRec.members) ? clanRec.members.length : 0;
            const leveled = (0, _mission_catalog_js_1.addClanXpServer)(Number(clanRec.xp ?? 0) || 0, Number(clanRec.level ?? 1) || 1, (0, _mission_catalog_js_1.scaledClanXp)(donationClanXp(donation), memberCount));
            await _storage_js_1.kv.set(clanSaveKey, { ...clanRec, treasury: debit.value.nextTreasury, xp: leveled.xp, level: leveled.level });
            await (0, _economy_tx_js_1.completeEconomyTx)(txId);
            txState = 'complete';
            return { ok: true, treasury: debit.value.nextTreasury, xp: leveled.xp, level: leveled.level, _saveVersion: debit._saveVersion };
        }, { failClosed: true });
        if (!result.ok)
            return res.status(result.status).json({ error: result.error });
        // Best-effort audit log (30-day TTL).
        await _storage_js_1.kv.set(`${AUDIT_LOG_PREFIX}${targetSlug}:${Date.now()}`, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            clan,
            ...(donation.kind === 'currency'
                ? { currency: donation.currency, amount: Math.floor(donation.amount) }
                : { itemId: donation.itemId, count: Math.floor(donation.count) }),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        return res.status(200).json({ ok: true, treasury: result.treasury, xp: result.xp, level: result.level, _saveVersion: result._saveVersion });
    }
    catch (err) {
        if (txId && txState && txState !== 'complete') {
            await (0, _economy_tx_js_1.failEconomyTx)(txId, err).catch(() => undefined);
        }
        console.error('[clan/treasury/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
