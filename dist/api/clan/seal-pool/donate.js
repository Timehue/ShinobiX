"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _storage_js_2 = require("./_storage.js");
// Vanguards donate Honor Seals to their clan's pool. Per-day cumulative cap
// of 50% of (currentBalance + alreadyDonatedToday) — i.e. you can move up to
// half of what you'd have if you hadn't donated yet today. Resets at UTC
// midnight via the lazy-reset pattern on dailyDonationDate.
const DONATE_FRACTION_CAP = 0.5;
const MIN_DONATION = 1;
const MAX_DONATION_PER_CALL = 200;
function utcDateKey() {
    return new Date().toISOString().slice(0, 10);
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const amount = Math.floor(Number(body.amount ?? 0));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        if (!Number.isFinite(amount) || amount < MIN_DONATION) {
            return res.status(400).json({ error: `Amount must be at least ${MIN_DONATION}.` });
        }
        if (amount > MAX_DONATION_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_DONATION_PER_CALL} Seals per donation call.` });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only donate your own Seals.' });
        }
        // 20 donate calls/min per player is plenty for a UI clicker.
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-seal-donate', 20, 60_000, identity.name)))
            return;
        const saveKey = `save:${playerName}`;
        // Wrap the donor's read-modify-write inside the same `lock:save:<name>`
        // that api/save/[name].ts uses for the player's regular auto-saves, so
        // a concurrent auto-save can't drop the donation debit. (Previously
        // the donor save was an unlocked kv.set; an auto-save landing on the
        // pre-debit balance would silently undo the spend.)
        const lockResult = await (0, _lock_js_1.withKvLock)(saveKey, async () => {
            const record = await _storage_js_1.kv.get(saveKey);
            const char = record?.character;
            if (!char)
                return { status: 404, body: { error: 'Character not found.' } };
            if (char.profession !== 'vanguard') {
                return { status: 403, body: { error: 'Only Vanguards can donate Honor Seals.' } };
            }
            const clanName = typeof char.clan === 'string' ? char.clan : '';
            if (!clanName)
                return { status: 400, body: { error: 'You must be in a clan to donate.' } };
            const balance = Number(char.honorSeals ?? 0);
            // Per-day cumulative cap. Lazy-reset: if the stamped date != today,
            // dailyDonatedToday is effectively zero. Cap = 50% of (currentBalance
            // + dailyDonatedToday) — i.e. the cap is computed against the "if you
            // hadn't donated today" balance so it doesn't tighten as you spend.
            const today = utcDateKey();
            const stampedDate = typeof char.dailyDonationDate === 'string' ? char.dailyDonationDate : '';
            const donatedToday = stampedDate === today ? Number(char.dailyDonatedSeals ?? 0) : 0;
            const dailyCap = Math.floor((balance + donatedToday) * DONATE_FRACTION_CAP);
            const remaining = Math.max(0, dailyCap - donatedToday);
            if (amount > remaining) {
                return {
                    status: 400,
                    body: {
                        error: `Daily donation cap is 50% of your "start of day" Seal balance. You can donate ${remaining} more today.`,
                        dailyCap,
                        donatedToday,
                        remaining,
                        balance,
                    },
                };
            }
            // Debit donor + bump daily tracking.
            const updatedRecord = {
                ...record,
                character: {
                    ...char,
                    honorSeals: balance - amount,
                    dailyDonatedSeals: donatedToday + amount,
                    dailyDonationDate: today,
                },
            };
            await _storage_js_1.kv.set(saveKey, (0, _utils_js_1.mergePreservingImages)(updatedRecord, record));
            // Credit pool. Pool itself has its own internal lock inside savePool.
            const pool = await (0, _storage_js_2.loadPool)(clanName);
            pool.balance += amount;
            pool.log.unshift({ kind: 'donate', by: playerName, amount, at: Date.now() });
            await (0, _storage_js_2.savePool)(pool);
            return {
                status: 200,
                body: {
                    ok: true,
                    donated: amount,
                    honorSealsRemaining: balance - amount,
                    poolBalance: pool.balance,
                    dailyDonatedToday: donatedToday + amount,
                    dailyCap,
                },
            };
        });
        return res.status(lockResult.status).json(lockResult.body);
    }
    catch (err) {
        console.error('[clan/seal-pool/donate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
