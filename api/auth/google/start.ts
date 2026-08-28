import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { enforceRateLimit } from '../../_ratelimit.js';
import { authedPlayer, playerSessionsEnabled, readPlayerSessionEpoch } from '../../_auth.js';
import { buildAuthorizeUrl, googleAuthEnabled, signState } from '../../_google-auth.js';

/*
 * POST /api/auth/google/start  { nonce, mode?: 'login' | 'link' }
 *
 * Returns { url } for the client to navigate to. It returns JSON rather than a
 * 302 so the request can carry auth headers, which is what lets link mode know
 * whose account to attach the Google identity to. It is a POST — not a GET — so the signed state can
 * never come back on a response that a cross-origin page could read.
 *
 * `nonce` is generated and remembered by the calling browser. It rides through
 * Google and back, and must be echoed at claim time, so a flow completed in a
 * different browser produces a ticket nobody can redeem.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (!enforceRateLimit(req, res, 'google-oauth-start', 20, 60_000)) return;

    if (!googleAuthEnabled()) {
        return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });
    }
    // A Google account has no password to fall back on, so without session
    // tokens it could be created and then never entered. Refuse at the door
    // rather than mint something unusable.
    if (!playerSessionsEnabled()) {
        console.error('[auth/google/start] GOOGLE_CLIENT_ID is configured but SESSION_SECRET is not — Google sign-in is disabled.');
        return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });
    }

    const body = (req.body ?? {}) as { nonce?: unknown; mode?: unknown };
    const nonce = String(body.nonce ?? '');
    if (nonce.length < 16 || nonce.length > 128) {
        return res.status(400).json({ ok: false, error: 'Missing nonce.' });
    }

    if (body.mode === 'link') {
        // Linking mutates an existing account's credentials, so the caller must
        // prove they hold it right now.
        const player = await authedPlayer(req);
        if (!player) return res.status(401).json({ ok: false, error: 'Sign in before linking Google.' });
        const name = safeName(player);
        const epoch = await readPlayerSessionEpoch(name);
        return res.status(200).json({
            ok: true,
            url: buildAuthorizeUrl(signState({ mode: 'link', name, epoch, nonce }), nonce),
        });
    }

    return res.status(200).json({
        ok: true,
        url: buildAuthorizeUrl(signState({ mode: 'login', nonce }), nonce),
    });
}
