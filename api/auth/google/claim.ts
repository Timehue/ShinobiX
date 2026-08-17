import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { issuePlayerToken, playerSessionsEnabled } from '../../_auth.js';
import { authKey, type AuthRecord } from '../../player-auth.js';
import { getActiveBan, recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from '../../admin/moderation.js';
import {
    consumeGoogleTicket,
    googleAuthEnabled,
    newGoogleTicketId,
    storeGoogleTicket,
    SIGNUP_TICKET_TTL_SECONDS,
} from '../../_google-auth.js';

/*
 * POST /api/auth/google/claim  { ticket, nonce }
 *
 * Trades the single-use ticket the callback put in the URL for an actual
 * session token. The nonce must be the one this browser generated at start, so
 * a ticket lifted out of a URL, a log, or a shoulder-surfed screen is inert
 * anywhere else. The ticket is consumed by delete-rowcount, so a replay loses.
 *
 * The Google email lives only inside the server-side ticket and is never echoed
 * back — the response says what to do next, not who the player is.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
    if (!googleAuthEnabled() || !playerSessionsEnabled()) {
        return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });
    }
    if (!await enforceRateLimitKv(req, res, 'google-oauth-claim', 30, 15 * 60_000, undefined, { strict: true })) return;

    const body = (req.body ?? {}) as { ticket?: unknown; nonce?: unknown };
    const ticket = String(body.ticket ?? '');
    const nonce = String(body.nonce ?? '');
    if (!ticket || !nonce) return res.status(400).json({ ok: false, error: 'Missing ticket.' });

    let payload;
    try {
        payload = await consumeGoogleTicket(ticket, nonce);
    } catch (err) {
        console.error('[auth/google/claim]', String(err));
        return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
    }
    // Expired, already redeemed, or redeemed from the wrong browser. All three
    // are the same answer: start again.
    if (!payload) return res.status(410).json({ ok: false, error: 'That sign-in link has already been used or expired.' });

    if (payload.needsSignup) {
        // No account yet. The client runs the character creator, which takes
        // minutes, so the short handoff ticket is exchanged for a longer signup
        // ticket. That ticket — not the browser — carries the Google subject, so
        // a client can never name the identity it is registering as.
        const signupTicket = newGoogleTicketId();
        try {
            await storeGoogleTicket(signupTicket, { ...payload, nonce }, SIGNUP_TICKET_TTL_SECONDS);
        } catch (err) {
            console.error('[auth/google/claim signup]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({
            ok: true,
            needsSignup: true,
            suggestedName: payload.suggestedName,
            signupTicket,
        });
    }

    const name = safeName(payload.name ?? '');
    if (!name) return res.status(410).json({ ok: false, error: 'That sign-in link is no longer valid.' });

    let record: AuthRecord | null;
    try {
        record = await kv.get<AuthRecord>(authKey(name));
    } catch (err) {
        console.error('[auth/google/claim]', String(err));
        return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
    }
    if (!record) return res.status(404).json({ ok: false, error: 'That account no longer exists.' });

    // Same gate `verify` applies: a ban blocks the Google door too, or it would
    // be a way straight around it.
    const ban = await getActiveBan(name);
    if (ban) {
        return res.status(403).json({
            ok: false,
            error: 'Account is banned.',
            ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
        });
    }

    void recordClientIp(name, clientIpFrom(req));
    const fp = clientFpFrom(req);
    if (fp) void recordClientFingerprint(name, fp);

    return res.status(200).json({
        ok: true,
        name,
        linked: payload.linked ?? undefined,
        token: issuePlayerToken(name, undefined, record.sessionEpoch ?? 0) ?? undefined,
    });
}
