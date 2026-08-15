import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { assessVillageTax, villageTaxEnabled } from '../_war-tax-apply.js';

/*
 * /api/village/tax — POST only. Collects the player's daily village tax (§6.4).
 *
 * The client calls this once when a session starts. It is idempotent by the
 * server-owned `character.lastTaxDate` stamp, so extra calls cost one read and
 * change nothing.
 *
 * Ryo is client-owned in the save ledger, so the debit HAS to come back in a
 * response the client adopts — the same contract /api/player/daily-login uses.
 * The response carries the post-debit balances plus what was taken and why, so
 * the UI can tell the player their village lost ground and it cost them.
 *
 * Server-gated: the whole system rides the default-on Sector Map campaign, and
 * DISABLE_VILLAGE_TAX=1 is the tax-specific kill switch. When off this returns
 * `{ enabled: false }` rather than 404, so the client can distinguish "off" from
 * "broken".
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only settle your own tax.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-tax', 20, 60_000, identity.name))) return;

        if (!villageTaxEnabled()) return res.status(200).json({ ok: true, enabled: false, applied: false });

        // The result carries the save version the debit produced, so the client can
        // reconcile a write it did not make — the same contract the other currency
        // endpoints use.
        const result = await assessVillageTax(playerName);
        return res.status(200).json({ ok: true, enabled: true, ...result });
    } catch (error) {
        console.error('[village/tax]', safeLogValue(error));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
