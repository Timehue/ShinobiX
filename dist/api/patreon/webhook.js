"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _patreon_js_1 = require("./_patreon.js");
/*
 * POST /api/patreon/webhook
 *
 * Patreon fires this on membership changes (members:create / members:update /
 * members:delete). Authenticated by an HMAC-MD5 of the RAW body in the
 * `X-Patreon-Signature` header — that check is the ONLY trust boundary, so an
 * unverified body is dropped with 401. The raw bytes are captured by the
 * body-parser in server.ts (req.rawBody); without them the signature can't be
 * checked, so we fail closed.
 *
 * The handler is idempotent: the entitlement write is a full overwrite of
 * character.patreon that skips when unchanged, so a re-delivery (or a retry
 * after a transient failure) is safe and cheap.
 */
function headerStr(req, key) {
    const v = req.headers[key.toLowerCase()];
    if (Array.isArray(v))
        return v[0] ?? '';
    return v ?? '';
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    const signature = headerStr(req, 'x-patreon-signature');
    const rawBody = req.rawBody;
    if (!rawBody || !(0, _patreon_js_1.verifyWebhookSignature)(rawBody, signature)) {
        return res.status(401).json({ error: 'Invalid signature.' });
    }
    const event = headerStr(req, 'x-patreon-event');
    const parsed = (0, _patreon_js_1.parseWebhookMember)(req.body);
    if (!parsed)
        return res.status(200).json({ ok: true, ignored: true });
    try {
        const isDelete = event.endsWith(':delete');
        const ent = isDelete
            ? { active: false, tier: 'none', entitledCents: 0 }
            : (0, _patreon_js_1.computeEntitlement)(parsed.membership);
        const patronStatus = isDelete ? 'former_patron' : parsed.membership.patronStatus;
        // Ledger first (survives the pending wipe / an unlinked account); then
        // the save flag if this Patreon account is linked to a game account.
        await (0, _patreon_js_1.setMemberRecord)(parsed.userId, ent, patronStatus);
        const linkedPlayer = await (0, _patreon_js_1.getLinkedPlayer)(parsed.userId);
        if (linkedPlayer)
            await (0, _patreon_js_1.applyEntitlementToSave)(linkedPlayer, parsed.userId, ent);
        return res.status(200).json({ ok: true, applied: !!linkedPlayer, active: ent.active });
    }
    catch (err) {
        console.error('[patreon/webhook]', err);
        // 500 so Patreon retries a transient failure (write contention, etc.).
        return res.status(500).json({ error: 'Internal error.' });
    }
}
