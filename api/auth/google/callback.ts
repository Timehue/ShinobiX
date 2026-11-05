import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors, safeName } from '../../_utils.js';
import { kv } from '../../_storage.js';
import { enforceRateLimit } from '../../_ratelimit.js';
import { withKvLock } from '../../_lock.js';
import { authKey, googleIdentityKey, synchronizeVerifiedAuthRecordEpoch, type AuthRecord } from '../../player-auth.js';
import { precheckGoogleLink } from './_link.js';
import {
    exchangeCodeForIdentity,
    googleAuthEnabled,
    googleReturnTarget,
    newGoogleTicketId,
    signedStateReturn,
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

/**
 * `base` is required so no path can forget it: a flow the Android app started
 * must come back to the app on every outcome, errors included, or its sign-in
 * tab is left showing the website.
 */
function bounce(res: VercelResponse, base: string, outcome: Outcome, ticket?: string) {
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

/** Link mode: check only. The link itself is written in /claim (see ./_link.ts). */
async function precheckLink(state: GoogleAuthState, identity: GoogleIdentity): Promise<Exclude<Outcome, 'linked'>> {
    return precheckGoogleLink({ name: state.name ?? '', epoch: state.epoch ?? 0 }, identity.sub);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const rawState = String(req.query?.state ?? '');
    // Decided before anything can fail, so a cancel or an expired state still
    // goes back to wherever the flow started. Only a validly signed state can
    // choose the app, and the choice is between two constants.
    const target = googleReturnTarget(signedStateReturn(rawState));

    if (!googleAuthEnabled()) return bounce(res, target, 'error');
    // A throttled callback still answers with JSON, even for the app. Thirty
    // sign-ins a minute from one IP is not a flow worth returning anywhere.
    if (!enforceRateLimit(req, res, 'google-oauth-callback', 30, 60_000)) return;

    const code = String(req.query?.code ?? '');
    const state = verifyState(rawState);
    // A "user cancelled" bounce from Google arrives with ?error and no code.
    if (!code || !state) return bounce(res, target, 'error');

    try {
        const identity = await exchangeCodeForIdentity(code, state.nonce);
        if (!identity) return bounce(res, target, 'error');

        if (state.mode === 'link') {
            // Report "taken"/"expired" here, as before, so the screens and copy
            // do not change. Nothing is written until the starting browser
            // redeems the ticket with its nonce at /claim.
            const precheck = await precheckLink(state, identity);
            if (precheck !== 'ok') return bounce(res, target, precheck);
            const ticket = newGoogleTicketId();
            await storeGoogleTicket(ticket, {
                name: safeName(state.name ?? ''),
                sessionEpoch: state.epoch ?? 0,
                sub: identity.sub,
                email: identity.email,
                suggestedName: '',
                nonce: state.nonce,
                linked: true,
                linkRequest: { name: safeName(state.name ?? ''), epoch: state.epoch ?? 0 },
            });
            return bounce(res, target, 'linked', ticket);
        }

        const owner = await kv.get<{ name?: string }>(googleIdentityKey(identity.sub));
        const ownerName = safeName(owner?.name ?? '');
        const ticket = newGoogleTicketId();

        if (ownerName) {
            const resolved = await withKvLock(authKey(ownerName), () => withKvLock(googleIdentityKey(identity.sub), async () => {
                // Re-read both rows under the same lock order used by their writers.
                // Comparing `{name}` alone cannot distinguish a same-name account
                // recreated after our initial lookup.
                const currentOwner = await kv.get<{ name?: string }>(googleIdentityKey(identity.sub));
                if (safeName(currentOwner?.name ?? '') !== ownerName) return 'error' as const;
                let record = await kv.get<AuthRecord>(authKey(ownerName));
                if (record) {
                    // An index is a lookup hint; only the current account link can
                    // authorize a handoff for the verified Google identity.
                    if (record.google?.sub !== identity.sub) return 'error' as const;
                    // A new provider exchange proves the current linked identity;
                    // it can repair a prior epoch/auth partial write. An old claim
                    // ticket cannot take this path and remains rejected.
                    record = await synchronizeVerifiedAuthRecordEpoch(ownerName, record);
                    await storeGoogleTicket(ticket, {
                        name: ownerName,
                        sessionEpoch: record.sessionEpoch ?? 0,
                        sub: identity.sub,
                        email: identity.email,
                        suggestedName: '',
                        nonce: state.nonce,
                    });
                    return 'ok' as const;
                }
                // Another callback may have replaced the dangling index while we
                // looked up its old account. Never erase that replacement owner.
                if (!await kv.delIfEqual(googleIdentityKey(identity.sub), currentOwner)) {
                    return 'error' as const;
                }
                return 'signup' as const;
            }, { failClosed: true }), { failClosed: true });
            if (resolved === 'ok') return bounce(res, target, 'ok', ticket);
            if (resolved === 'error') return bounce(res, target, 'error');
        }

        await storeGoogleTicket(ticket, {
            needsSignup: true,
            sub: identity.sub,
            email: identity.email,
            suggestedName: suggestedNameFrom(identity),
            nonce: state.nonce,
        });
        return bounce(res, target, 'signup', ticket);
    } catch (err) {
        console.error('[auth/google/callback]', err);
        return bounce(res, target, 'error');
    }
}
