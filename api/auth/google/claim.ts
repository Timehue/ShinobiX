import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { enforceRateLimitKv } from '../../_ratelimit.js';
import { issuePlayerToken, playerSessionsEnabled, readPlayerSessionEpoch } from '../../_auth.js';
import { withKvLock } from '../../_lock.js';
import { authKey, type AuthRecord } from '../../player-auth.js';
import { getActiveBan, recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from '../../admin/moderation.js';
import {
    consumeGoogleTicket,
    googleAuthEnabled,
    newGoogleTicketId,
    storeGoogleTicket,
    SIGNUP_TICKET_TTL_SECONDS,
} from '../../_google-auth.js';
import { linkGoogleToAccount } from './_link.js';

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

    if (payload.linkRequest) {
        // Link mode is written here, after the nonce proved this is the browser
        // that started the flow (see ./_link.ts), never in the callback.
        try {
            const linked = await linkGoogleToAccount(payload.linkRequest, { sub: payload.sub, email: payload.email });
            if (linked.outcome !== 'linked') {
                const error = linked.outcome === 'taken'
                    ? 'That Google account is already linked to a different shinobi.'
                    : linked.outcome === 'expired'
                        ? 'Your session ended while Google was signing you in. Sign in again, then link Google.'
                        : 'Google sign-in did not complete. Try again.';
                return res.status(409).json({ ok: false, error });
            }
            payload = { ...payload, name: linked.name, sessionEpoch: linked.sessionEpoch };
        } catch (err) {
            console.error('[auth/google/claim link]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    const name = safeName(payload.name ?? '');
    if (!name) return res.status(410).json({ ok: false, error: 'That sign-in link is no longer valid.' });

    try {
        // Credential mutations use this account lock. Revalidate the callback's
        // identity and generation while minting, rather than upgrading an old
        // handoff to whichever credentials happen to own the name now.
        return await withKvLock(authKey(name), async () => {
            const record = await kv.get<AuthRecord>(authKey(name));
            if (!record) return res.status(404).json({ ok: false, error: 'That account no longer exists.' });
            if (record.google?.sub !== payload.sub
                || !Number.isSafeInteger(payload.sessionEpoch)
                || payload.sessionEpoch !== (record.sessionEpoch ?? 0)
                || payload.sessionEpoch !== await readPlayerSessionEpoch(name)) {
                return res.status(410).json({ ok: false, error: 'That sign-in link is no longer valid. Please sign in again.' });
            }

            // A ban blocks the Google door too.
            const ban = await getActiveBan(name);
            if (ban) {
                return res.status(403).json({
                    ok: false,
                    error: 'Account is banned.',
                    ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                });
            }

            // Remember when this account last proved Google ownership: a
            // Google-only account may set its first password only shortly after
            // (player-auth `change`). Best effort: a failed stamp just means the
            // player is asked to sign in with Google again before that step.
            try {
                await kv.set(authKey(name), { ...record, google: { ...record.google!, lastAuthAt: Date.now() } });
            } catch (err) {
                console.error('[auth/google/claim lastAuthAt]', String(err));
            }

            void recordClientIp(name, clientIpFrom(req));
            const fp = clientFpFrom(req);
            if (fp) void recordClientFingerprint(name, fp);

            const token = issuePlayerToken(name, undefined, record.sessionEpoch ?? 0);
            if (!token) return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });

            return res.status(200).json({
                ok: true,
                name,
                linked: payload.linked ?? undefined,
                token,
            });
        }, { failClosed: true });
    } catch (err) {
        console.error('[auth/google/claim]', String(err));
        return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
    }
}
