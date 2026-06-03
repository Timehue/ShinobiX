"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
/*
 * /api/village/treasury/transfer  — POST only
 *
 * Atomic Kage-gift endpoint. The old flow was two separate writes:
 *   1) client deducts from villageState.treasury and POSTs villageState
 *   2) client PATCHes the recipient's save with the credited currency / item
 *
 * Step 2 fails for non-admin Kages because /api/save/<recipient> 403s any
 * cross-player POST. The net effect was that non-admin Kage gifts SILENTLY
 * did nothing — gifting was effectively admin-only. This endpoint is the
 * intended path: it impersonates both ends server-side, performs the
 * deduction + credit under per-row locks, and emits an audit-log entry.
 *
 * Request body shape (currency transfer):
 *   { village, recipientName, currency: 'ryo' | 'honorSeals' | ..., amount: number }
 *
 * Request body shape (item transfer):
 *   { village, recipientName, itemId: string }
 *
 * Caller MUST be the seated Kage of `village` (verified server-side via
 * the authoritative village:kage:<slug> KV row). Admins always pass.
 *
 * Rate-limited: 30 transfers / 60s per actor — far above any legitimate
 * Kage workflow, below any abuse loop. Locks held: village state row +
 * recipient save row. Net storage cost per call: 2 writes (treasury KV
 * + recipient save) + 1 audit-log write.
 */
const VILLAGE_STATE_PREFIX = 'game:village-state:';
const KAGE_KEY_PREFIX = 'village:kage:';
const AUDIT_LOG_PREFIX = 'audit:village-treasury:';
const ALLOWED_CURRENCIES = new Set([
    'ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals',
]);
// Per-call hard ceiling on a single gift amount. Mirrors the donation-side
// MAX_TREASURY_INCREASE caps in _village-state-validate.ts so an abusive
// Kage can't dump the entire treasury into one chosen account in a single
// click. Real gameplay never needs more than a few thousand per gift.
const MAX_GIFT_PER_CALL = {
    ryo: 200_000,
    honorSeals: 200,
    fateShards: 200,
    boneCharms: 200,
    auraStones: 200,
    mythicSeals: 50,
};
function villageSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function kageKey(village) {
    return `${KAGE_KEY_PREFIX}${village.toLowerCase().replace(/\s+/g, '-')}`;
}
function removeOneItem(items, itemId) {
    const out = [];
    let removed = false;
    for (const s of items) {
        if (!removed && s.itemId === itemId && s.count > 0) {
            const nextCount = s.count - 1;
            if (nextCount > 0)
                out.push({ ...s, count: nextCount });
            removed = true;
            continue;
        }
        out.push(s);
    }
    return out;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
    if (!identity)
        return res.status(401).json({ error: 'Authentication required.' });
    // Rate-limit ALL transfers per actor. 30/min is comfortably above any
    // legit Kage workflow (a Kage manually gifting 30 villagers in a minute
    // is wildly atypical) but well below any abuse pattern.
    const rlName = identity.admin ? undefined : identity.name;
    if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'village-treasury-transfer', 30, 60_000, rlName)))
        return;
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const village = typeof body.village === 'string' ? body.village.trim() : '';
        const rawRecipient = typeof body.recipientName === 'string' ? body.recipientName : '';
        const recipientName = (0, _utils_js_1.safeName)(rawRecipient);
        const currency = typeof body.currency === 'string' ? body.currency : undefined;
        const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : undefined;
        const amountRaw = body.amount;
        const amount = Math.max(0, Math.floor(Number(amountRaw)));
        if (!village || !recipientName) {
            return res.status(400).json({ error: 'Missing village or recipientName.' });
        }
        const isCurrency = !!currency;
        const isItem = !!itemId;
        if (isCurrency === isItem) {
            return res.status(400).json({ error: 'Must provide exactly one of currency or itemId.' });
        }
        if (isCurrency) {
            if (!ALLOWED_CURRENCIES.has(currency)) {
                return res.status(400).json({ error: `Unsupported currency: ${currency}` });
            }
            if (amount < 1) {
                return res.status(400).json({ error: 'amount must be ≥ 1.' });
            }
            const cap = MAX_GIFT_PER_CALL[currency];
            if (amount > cap) {
                return res.status(400).json({ error: `amount exceeds per-call cap of ${cap}.` });
            }
        }
        // ── Authorization: caller must be the seated Kage of `village` ─
        // The authoritative source is village:kage:<slug>, not the
        // game:village-state row (which players can lie about in the
        // POST body). Admin always passes.
        if (!identity.admin) {
            const kageState = await _storage_js_1.kv.get(kageKey(village));
            const seated = (0, _utils_js_1.safeName)(kageState?.seatedKage ?? '');
            if (!kageState?.kageSystemUnlocked || !seated || seated !== identity.name) {
                return res.status(403).json({ error: 'Only the seated Kage may transfer village treasury.' });
            }
        }
        // ── Recipient membership: must belong to this village ──────────
        // Stops a Kage from siphoning into an alt in another village.
        const recipientSaveKey = `save:${recipientName}`;
        const recipientSave = await _storage_js_1.kv.get(recipientSaveKey);
        const recipientChar = (recipientSave?.character ?? null);
        if (!recipientChar) {
            return res.status(404).json({ error: 'Recipient save not found.' });
        }
        if ((recipientChar.village ?? '').trim() !== village.trim() && !identity.admin) {
            return res.status(403).json({ error: 'Recipient is not a member of this village.' });
        }
        const villageStateKey = `${VILLAGE_STATE_PREFIX}${villageSlug(village)}`;
        // ── Atomic transfer ────────────────────────────────────────────
        // We lock the village state row first (the contended resource),
        // then read + mutate the recipient under its own save lock. The
        // double lock keeps us race-safe against (a) two Kage transfers
        // in flight, and (b) a recipient autosave landing during the
        // credit step. Ordering: village first, save second — matches
        // alphabetical key order so we can't deadlock against another
        // path that takes both in the opposite direction.
        const result = await (0, _lock_js_1.withKvLock)(villageStateKey, async () => {
            const state = (await _storage_js_1.kv.get(villageStateKey)) ?? {};
            const treasury = (state.treasury ?? {});
            if (isCurrency) {
                const c = currency;
                const available = Math.max(0, Number(treasury[c] ?? 0));
                if (available < amount) {
                    return { ok: false, status: 400, error: `Insufficient treasury ${c} (have ${available}, need ${amount}).` };
                }
                // Credit recipient under the save lock to prevent racing
                // with the recipient's own autosave.
                const creditOk = await (0, _lock_js_1.withKvLock)(recipientSaveKey, async () => {
                    const fresh = await _storage_js_1.kv.get(recipientSaveKey);
                    const freshChar = (fresh?.character ?? null);
                    if (!freshChar)
                        return false;
                    const nextChar = {
                        ...freshChar,
                        [c]: Math.max(0, Number(freshChar[c] ?? 0)) + amount,
                    };
                    await _storage_js_1.kv.set(recipientSaveKey, { ...fresh, character: nextChar });
                    return true;
                }, { failClosed: true });
                if (!creditOk) {
                    return { ok: false, status: 500, error: 'Failed to credit recipient.' };
                }
                // Deduct from treasury — done AFTER the credit succeeds so
                // a credit failure can't leave the treasury short.
                const nextState = {
                    ...state,
                    treasury: { ...treasury, [c]: available - amount },
                };
                await _storage_js_1.kv.set(villageStateKey, nextState);
                return { ok: true, currency: c, amount };
            }
            else {
                // Item transfer — find the stack in the treasury.
                const items = Array.isArray(treasury.items) ? treasury.items : [];
                const stack = items.find(s => s.itemId === itemId);
                if (!stack || stack.count < 1) {
                    return { ok: false, status: 400, error: 'Item not in village treasury.' };
                }
                const creditOk = await (0, _lock_js_1.withKvLock)(recipientSaveKey, async () => {
                    const fresh = await _storage_js_1.kv.get(recipientSaveKey);
                    const freshChar = (fresh?.character ?? null);
                    if (!freshChar)
                        return false;
                    const nextInv = Array.isArray(freshChar.inventory)
                        ? [...freshChar.inventory, itemId]
                        : [itemId];
                    const nextChar = { ...freshChar, inventory: nextInv };
                    await _storage_js_1.kv.set(recipientSaveKey, { ...fresh, character: nextChar });
                    return true;
                }, { failClosed: true });
                if (!creditOk) {
                    return { ok: false, status: 500, error: 'Failed to credit recipient.' };
                }
                const nextItems = removeOneItem(items, itemId);
                const nextState = {
                    ...state,
                    treasury: { ...treasury, items: nextItems },
                };
                await _storage_js_1.kv.set(villageStateKey, nextState);
                return { ok: true, itemId };
            }
        }, { failClosed: true });
        if (!result.ok) {
            return res.status(result.status).json({ error: result.error });
        }
        // ── Audit log ─────────────────────────────────────────────────
        // Single KV write keyed by transfer time. Bounded TTL (30 days)
        // so it doesn't accumulate indefinitely. Used for admin review
        // if abuse suspected.
        const auditKey = `${AUDIT_LOG_PREFIX}${village.toLowerCase()}:${Date.now()}`;
        await _storage_js_1.kv.set(auditKey, {
            ts: Date.now(),
            actor: identity.admin ? 'admin' : identity.name,
            village,
            recipientName,
            ...('currency' in result ? { currency: result.currency, amount: result.amount } : {}),
            ...('itemId' in result ? { itemId: result.itemId } : {}),
        }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        // `result` already includes `ok: true` plus the currency / item payload.
        return res.status(200).json(result);
    }
    catch (err) {
        console.error('[village/treasury-transfer]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
