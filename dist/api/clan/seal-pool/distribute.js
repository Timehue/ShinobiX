"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _lock_js_1 = require("../../_lock.js");
const _save_version_js_1 = require("../../save/_save-version.js");
const _storage_js_2 = require("./_storage.js");
// Clan leader (clanFounder = true) distributes Honor Seals from the clan
// pool to a clan member. Recipient must be in the same clan.
const MIN_DISTRIBUTE = 1;
const MAX_DISTRIBUTE_PER_CALL = 500;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const leaderName = (0, _utils_js_1.safeName)(String(body.leaderName ?? ''));
        const recipientName = (0, _utils_js_1.safeName)(String(body.recipientName ?? ''));
        const amount = Math.floor(Number(body.amount ?? 0));
        if (!leaderName || !recipientName) {
            return res.status(400).json({ error: 'Missing leaderName or recipientName.' });
        }
        if (!Number.isFinite(amount) || amount < MIN_DISTRIBUTE) {
            return res.status(400).json({ error: `Amount must be at least ${MIN_DISTRIBUTE}.` });
        }
        if (amount > MAX_DISTRIBUTE_PER_CALL) {
            return res.status(400).json({ error: `Max ${MAX_DISTRIBUTE_PER_CALL} Seals per call.` });
        }
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, leaderName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== leaderName) {
            return res.status(403).json({ error: 'Can only distribute as yourself.' });
        }
        // Rate limit AFTER auth so anonymous spam still hits the auth gate
        // first. 10/min is generous for legit founder activity.
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'clan-seal-distribute', 10, 60_000, identity.name)))
            return;
        // Verify leader status.
        const leaderRecord = await _storage_js_1.kv.get(`save:${leaderName}`);
        const leaderChar = leaderRecord?.character;
        if (!leaderChar)
            return res.status(404).json({ error: 'Leader character not found.' });
        const clanName = typeof leaderChar.clan === 'string' ? leaderChar.clan : '';
        if (!clanName)
            return res.status(400).json({ error: 'You must be in a clan to distribute.' });
        if (!identity.admin && !leaderChar.clanFounder) {
            return res.status(403).json({ error: 'Only the clan founder can distribute Honor Seals.' });
        }
        // Verify recipient is in the same clan.
        const recipientRecord = await _storage_js_1.kv.get(`save:${recipientName}`);
        const recipientChar = recipientRecord?.character;
        if (!recipientChar)
            return res.status(404).json({ error: 'Recipient not found.' });
        if (recipientChar.clan !== clanName) {
            return res.status(400).json({ error: 'Recipient is not in your clan.' });
        }
        // Pool debit + recipient credit under a per-clan-pool lock so two
        // simultaneous distributes can't both read pre-debit balance and
        // double-spend. Lock keyed on the pool key so it doesn't collide
        // with unrelated locks.
        const poolKey = `clan-seal-pool:${clanName.toLowerCase()}`;
        const result = await (0, _lock_js_1.withKvLock)(poolKey, async () => {
            const pool = await (0, _storage_js_2.loadPool)(clanName);
            if (pool.balance < amount) {
                return { ok: false, available: pool.balance };
            }
            pool.balance -= amount;
            pool.log.unshift({
                kind: 'distribute',
                by: leaderName,
                to: recipientName,
                amount,
                at: Date.now(),
            });
            await (0, _storage_js_2.savePool)(pool);
            return { ok: true, poolBalance: pool.balance };
        }, { failClosed: true });
        if (!result.ok) {
            return res.status(400).json({
                error: 'Not enough Seals in the clan pool.',
                requested: amount,
                available: result.available,
            });
        }
        // Credit recipient. Hold `lock:save:<recipient>` for the read-
        // modify-write so a concurrent player auto-save can't drop the
        // credit. Pool was already debited; if the recipient lookup or
        // write fails inside the lock we surface the error so the leader
        // can retry — Seals don't vanish silently. (Refunds on failure
        // are noted as a TODO; pool itself is already debited at this
        // point. Investigate when claim-back is needed.)
        //
        // Deliberately NOT failClosed (unlike the pool lock above): the pool is
        // already debited here, so throwing on lock contention would lose the
        // Seals (pool down, recipient not credited). Falling through to run the
        // credit unlocked still credits the recipient — the lesser evil until
        // proper refund-on-failure exists.
        const recipientSaveKey = `save:${recipientName}`;
        await (0, _lock_js_1.withKvLock)(recipientSaveKey, async () => {
            // Re-read inside the lock to grab any updates that landed
            // between the membership check above and this point.
            const freshRecord = await _storage_js_1.kv.get(recipientSaveKey);
            const freshChar = freshRecord?.character;
            if (!freshChar)
                return;
            const updatedRecipient = {
                ...freshRecord,
                character: {
                    ...freshChar,
                    honorSeals: Number(freshChar.honorSeals ?? 0) + amount,
                },
            };
            (0, _save_version_js_1.bumpSaveVersion)(updatedRecipient);
            await _storage_js_1.kv.set(recipientSaveKey, (0, _utils_js_1.mergePreservingImages)(updatedRecipient, freshRecord));
        });
        return res.status(200).json({
            ok: true,
            distributed: amount,
            recipient: recipientName,
            poolBalance: result.poolBalance,
        });
    }
    catch (err) {
        console.error('[clan/seal-pool/distribute]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
