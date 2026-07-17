import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { enforceRateLimit } from '../_ratelimit.js';
import {
    patreonConfigured,
    verifyState,
    exchangeCodeForToken,
    fetchIdentityMembership,
    computeEntitlement,
    linkPlayer,
    setMemberRecord,
    applyEntitlementToSave,
} from './_patreon.js';

/*
 * GET /api/patreon/oauth-callback?code=<code>&state=<signed-state>
 *
 * Patreon redirects the patron's BROWSER here after they approve. There are no
 * auth headers on a top-level redirect, so the trusted identity comes entirely
 * from the HMAC-signed `state` (minted by oauth-start). We exchange the code,
 * read the patron's current membership, bind Patreon-account ↔ game-account, and
 * write the subscriber flag — then bounce the browser back into the SPA.
 */

function appReturnUrl(statusParam: string): string {
    const base = String(process.env.PATREON_APP_RETURN_URL ?? '/').trim() || '/';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}patreon=${encodeURIComponent(statusParam)}`;
}

function bounce(res: VercelResponse, statusParam: string) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', appReturnUrl(statusParam));
    return res.status(302).end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!patreonConfigured()) return bounce(res, 'error');
    if (!enforceRateLimit(req, res, 'patreon-oauth-callback', 30, 60_000)) return;

    const code = String(req.query?.code ?? '');
    const state = String(req.query?.state ?? '');
    const playerName = verifyState(state);
    // A Patreon "user denied" bounce arrives with ?error and no code.
    if (!code || !playerName) return bounce(res, 'error');

    try {
        const token = await exchangeCodeForToken(code);
        if (!token) return bounce(res, 'error');

        const identity = await fetchIdentityMembership(token.access_token);
        if (!identity) return bounce(res, 'error');

        await linkPlayer(identity.userId, playerName);
        const ent = computeEntitlement(identity.membership);
        await setMemberRecord(identity.userId, ent, identity.membership?.patronStatus ?? '');
        await applyEntitlementToSave(playerName, identity.userId, ent);

        return bounce(res, ent.active ? 'linked' : 'linked_inactive');
    } catch (err) {
        console.error('[patreon/oauth-callback]', err);
        return bounce(res, 'error');
    }
}
