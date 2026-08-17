import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { enforceRateLimit } from '../../_ratelimit.js';
import { readPlayerSessionEpoch, rotatePlayerSessionEpoch } from '../../_auth.js';
import { withKvLock } from '../../_lock.js';
import { authKey, googleIdentityKey, type AuthRecord } from '../../player-auth.js';
import {
    exchangeCodeForIdentity,
    googleAppReturnUrl,
    googleAuthEnabled,
    newGoogleTicketId,
    storeGoogleTicket,
    verifyState,
    type GoogleAuthState,
    type GoogleIdentity,
} from '../../_google-auth.js';

/*
 * GET /api/auth/google/callback?code=<code>&state=<signed-state>
 *
 * Google redirects the player's BROWSER here. A top-level redirect carries no
 * auth headers, so everything trusted comes from the HMAC-signed `state` minted
 * by start.ts. We exchange the code server-side, resolve or link the account,
 * then bounce back into the SPA with a single-use ticket — never a session
 * token, which must not travel in a URL.
 */

type Outcome =
    | 'ok'          // resolved to an existing account; claim to get a token
    | 'signup'      // this Google account has no shinobi yet
    | 'linked'      // link mode succeeded
    | 'taken'       // that Google account already belongs to another shinobi
    | 'expired'     // the session that authorised a link ended mid-flight
    | 'error';

function bounce(res: VercelResponse, outcome: Outcome, ticket?: string) {
    const base = googleAppReturnUrl();
    const sep = base.includes('?') ? '&' : '?';
    const params = new URLSearchParams({ gauth: outcome });
    if (ticket) params.set('gticket', ticket);
    res.setHeader('Cache-Control', 'no-store');
    // A ticket in the query string is why the client strips it with
    // history.replaceState the moment it reads it, and why the ticket is
    // single-use, two minutes long, and useless without the browser's nonce.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Location', `${base}${sep}${params.toString()}`);
    return res.status(302).end();
}

/** A first-draft shinobi name from the Google profile, for the signup form. */
function suggestedNameFrom(identity: GoogleIdentity): string {
    const fromProfile = safeName(identity.name);
    if (fromProfile.length >= 2) return fromProfile.slice(0, 20);
    const fromEmail = safeName(identity.email.split('@')[0] ?? '');
    return fromEmail.length >= 2 ? fromEmail.slice(0, 20) : '';
}

/** Attach the identity to an existing account. Returns the bounce outcome. */
async function linkToAccount(state: GoogleAuthState, identity: GoogleIdentity): Promise<Outcome> {
    const name = safeName(state.name ?? '');
    if (!name) return 'error';

    // The link was authorised by a session that may since have ended — a logout,
    // a password change, or an admin revocation all move the epoch. An in-flight
    // link must not outlive the session that started it.
    if (await readPlayerSessionEpoch(name) !== state.epoch) return 'expired';

    // Lock the account record, the same key every other credential mutation
    // locks. Uniqueness of the Google subject is enforced by the NX write below
    // rather than by a second lock, so there is only ever one lock to order.
    return await withKvLock(authKey(name), async (): Promise<Outcome> => {
        const record = await kv.get<AuthRecord>(authKey(name));
        if (!record) return 'error';
        if (record.google?.sub && record.google.sub !== identity.sub) return 'taken';

        const claimed = await kv.set(
            googleIdentityKey(identity.sub),
            { name },
            { nx: true },
        );
        if (!claimed) {
            // Someone already holds this Google account. Re-linking the same
            // pair is fine and idempotent; anything else is a genuine conflict.
            const owner = await kv.get<{ name?: string }>(googleIdentityKey(identity.sub));
            if (safeName(owner?.name ?? '') !== name) return 'taken';
        }

        // Linking Google is exactly how a guest account stops being disposable:
        // it now has a real owner and a way back in.
        const { guest, ...kept } = record;
        const linkedRecord: AuthRecord = {
            ...kept,
            google: { sub: identity.sub, email: identity.email, linkedAt: Date.now() },
        };

        // Claiming a guest rotates the epoch. The long-lived credential that let
        // an anonymous browser hold the account must not survive the account
        // acquiring a real owner; the claim endpoint hands back a fresh token.
        if (guest) linkedRecord.sessionEpoch = await rotatePlayerSessionEpoch(name);

        await kv.set(authKey(name), linkedRecord);
        return 'linked';
    }, { failClosed: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!googleAuthEnabled()) return bounce(res, 'error');
    if (!enforceRateLimit(req, res, 'google-oauth-callback', 30, 60_000)) return;

    const code = String(req.query?.code ?? '');
    const state = verifyState(String(req.query?.state ?? ''));
    // A "user cancelled" bounce from Google arrives with ?error and no code.
    if (!code || !state) return bounce(res, 'error');

    try {
        const identity = await exchangeCodeForIdentity(code, state.nonce);
        if (!identity) return bounce(res, 'error');

        if (state.mode === 'link') {
            const outcome = await linkToAccount(state, identity);
            if (outcome !== 'linked') return bounce(res, outcome);
            const ticket = newGoogleTicketId();
            await storeGoogleTicket(ticket, {
                name: safeName(state.name ?? ''),
                sub: identity.sub,
                email: identity.email,
                suggestedName: '',
                nonce: state.nonce,
                linked: true,
            });
            return bounce(res, 'linked', ticket);
        }

        const owner = await kv.get<{ name?: string }>(googleIdentityKey(identity.sub));
        const ownerName = safeName(owner?.name ?? '');
        const ticket = newGoogleTicketId();

        if (ownerName) {
            // Guard against an index row left pointing at an account that no
            // longer exists — a server reset, or a delete that raced this flow.
            // Handing back a token for a deleted player would be worse than
            // sending them through signup.
            const record = await kv.get<AuthRecord>(authKey(ownerName));
            if (record) {
                await storeGoogleTicket(ticket, {
                    name: ownerName,
                    sub: identity.sub,
                    email: identity.email,
                    suggestedName: '',
                    nonce: state.nonce,
                });
                return bounce(res, 'ok', ticket);
            }
            await kv.del(googleIdentityKey(identity.sub));
        }

        await storeGoogleTicket(ticket, {
            needsSignup: true,
            sub: identity.sub,
            email: identity.email,
            suggestedName: suggestedNameFrom(identity),
            nonce: state.nonce,
        });
        return bounce(res, 'signup', ticket);
    } catch (err) {
        console.error('[auth/google/callback]', err);
        return bounce(res, 'error');
    }
}
