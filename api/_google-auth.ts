/**
 * Google sign-in — server-side OAuth 2.0 authorization-code flow.
 *
 * Underscore-prefixed: this is a shared helper, NOT a route. The three routes
 * that use it are api/auth/google/{start,callback,claim}.ts.
 *
 * Why this shape and not Google's JS SDK: the site's CSP (api/_http-security.ts)
 * is `script-src 'self'` with no `frame-src` and `form-action 'self'`, which
 * blocks Google Identity Services, One Tap, and any Google-hosted iframe. A
 * top-level redirect is unaffected, needs no third-party script, and adds no
 * dependency. api/patreon/ already runs exactly this flow; the state-signing and
 * code-exchange shapes here are deliberately close to it.
 *
 * Google is never the identity itself. It resolves to a shinobi slug, and from
 * there the ordinary session token (api/_auth.ts) does all the work — so linking
 * Google changes how you get in, not what your account is.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { kv } from './_storage.js';
import { consumeSingleUseToken } from './_single-use-token.js';

// ─── Env accessors ────────────────────────────────────────────────────────────

export function googleClientId(): string { return String(process.env.GOOGLE_CLIENT_ID ?? '').trim(); }
export function googleClientSecret(): string { return String(process.env.GOOGLE_CLIENT_SECRET ?? '').trim(); }

/**
 * The redirect target registered in Google Cloud Console. Read from env and
 * NEVER derived from `req.headers.host`: Google matches it exactly, and
 * api/_canonical-domain.ts deliberately does not normalise `/api` paths between
 * the apex and `www`, so a host-derived value would silently differ per visitor.
 */
export function googleRedirectUri(): string { return String(process.env.GOOGLE_REDIRECT_URI ?? '').trim(); }

/** Where the callback bounces the browser back to once it is done. */
export function googleAppReturnUrl(): string {
    return String(process.env.GOOGLE_APP_RETURN_URL ?? '').trim() || '/';
}

/**
 * Why the redirect URI is validated rather than trusted.
 *
 * Google matches it as an exact string against the one registered in the Cloud
 * Console. Every near-miss — http instead of https, a www host, a trailing
 * slash, the wrong path — fails at Google's end with `redirect_uri_mismatch`,
 * an error the player sees and the operator does not. Checking the shape here
 * turns a silent production-only failure into a startup log line.
 *
 * Returns a human-readable problem, or null when the value looks usable.
 */
export function googleRedirectUriProblem(env: NodeJS.ProcessEnv = process.env): string | null {
    const raw = String(env.GOOGLE_REDIRECT_URI ?? '').trim();
    if (!raw) return 'GOOGLE_REDIRECT_URI is not set.';

    let url: URL;
    try { url = new URL(raw); } catch { return `GOOGLE_REDIRECT_URI is not a valid URL: ${raw}`; }

    // Google requires https for everything except localhost.
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLocalhost) {
        return `GOOGLE_REDIRECT_URI must use https (got ${url.protocol.replace(':', '')}).`;
    }
    if (url.pathname !== CALLBACK_PATH) {
        return `GOOGLE_REDIRECT_URI must end in ${CALLBACK_PATH} (got ${url.pathname}).`;
    }
    if (url.search || url.hash) {
        return 'GOOGLE_REDIRECT_URI must not carry a query string or fragment.';
    }
    // The canonical-domain middleware deliberately does not normalise /api
    // paths, so a www callback is served rather than redirected — and Google
    // will reject it unless that exact host is also registered.
    if (url.hostname.startsWith('www.')) {
        return `GOOGLE_REDIRECT_URI should use the apex host, not ${url.hostname} — /api paths are not redirected to canonical.`;
    }
    return null;
}

/** The one path Google is allowed to redirect back to; must match server.ts. */
const CALLBACK_PATH = '/api/auth/google/callback';

/**
 * Ships ON when credentials exist and the redirect URI is usable.
 * DISABLE_GOOGLE_AUTH=1 is the kill switch.
 */
export function googleAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.DISABLE_GOOGLE_AUTH === '1') return false;
    if (!String(env.GOOGLE_CLIENT_ID ?? '').trim()) return false;
    if (!String(env.GOOGLE_CLIENT_SECRET ?? '').trim()) return false;
    // A malformed redirect URI cannot produce a working sign-in, so treat it as
    // unconfigured: the button stays hidden instead of leading to a dead end.
    return googleRedirectUriProblem(env) === null;
}

// ─── Constant-time compare ────────────────────────────────────────────────────

function timingSafeEqualStr(a: string, b: string): boolean {
    const ba = Buffer.from(String(a ?? ''));
    const bb = Buffer.from(String(b ?? ''));
    if (ba.length !== bb.length) {
        try { timingSafeEqual(ba, ba); } catch { /* zero-length */ }
        return false;
    }
    return timingSafeEqual(ba, bb);
}

/**
 * Secret used to sign the OAuth `state`. Prefers SESSION_SECRET (the canonical
 * master signing key) and falls back to the Google client secret, matching
 * api/patreon/_patreon.ts. Note this fallback is fine for *state* — which only
 * needs to be unforgeable for a few minutes — and is deliberately NOT used for
 * player session tokens, which have their own secret requirement.
 */
function stateSecret(): string {
    return String(process.env.SESSION_SECRET ?? '').trim() || googleClientSecret();
}

// ─── OAuth state ──────────────────────────────────────────────────────────────

/**
 * Five minutes, not the fifteen the Patreon flow allows. The state here carries
 * the authority to attach a Google identity to an account, so the window in
 * which a half-finished flow is completable should be no wider than an actual
 * sign-in takes.
 */
const STATE_TTL_MS = 5 * 60_000;

export type GoogleAuthMode = 'login' | 'link';

export type GoogleAuthState = {
    mode: GoogleAuthMode;
    /** Set only in link mode: the account the identity will be attached to. */
    name?: string;
    /**
     * The account's session epoch at the moment the flow started, for link mode.
     * If the player logs out, changes their password, or is force-revoked while
     * the redirect is in flight, the epoch moves and this state stops being
     * honoured — an in-flight link cannot outlive the session that authorised it.
     */
    epoch?: number;
    /**
     * Client-generated, echoed back at claim time. The browser that started the
     * flow is the only one that knows it, so a state completed in someone else's
     * browser produces a ticket they cannot redeem. This is what stops an
     * attacker from walking a logged-in victim through a link flow and grafting
     * their own Google account onto the victim's shinobi.
     */
    nonce: string;
    exp: number;
};

/** `<base64url(json)>.<hmac>` — verifiable, self-expiring, no server-side table. */
export function signState(state: Omit<GoogleAuthState, 'exp'>, ttlMs: number = STATE_TTL_MS): string {
    // No floor on the TTL: a caller asking for an already-dead state should get
    // one, so "expired" is a state the tests can actually construct.
    const payload = JSON.stringify({ ...state, exp: Date.now() + ttlMs });
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    const sig = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

/** Returns the state if it is authentic and unexpired, else null. */
export function verifyState(state: string): GoogleAuthState | null {
    const parts = String(state ?? '').split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
    if (!timingSafeEqualStr(sig, expected)) return null;

    let parsed: GoogleAuthState;
    try {
        parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as GoogleAuthState;
    } catch {
        return null;
    }
    if (!parsed || (parsed.mode !== 'login' && parsed.mode !== 'link')) return null;
    if (typeof parsed.nonce !== 'string' || parsed.nonce.length < 16) return null;
    if (!Number.isFinite(parsed.exp) || Date.now() > parsed.exp) return null;
    if (parsed.mode === 'link' && (!parsed.name || !Number.isSafeInteger(parsed.epoch))) return null;
    return parsed;
}

// ─── Authorize / token endpoints ──────────────────────────────────────────────

// Hard-coded, never env-configurable. The ID token below is trusted on the
// strength of having come from *this* host over TLS, so the host must not be
// something an operator (or a leaked env var) can repoint.
const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export function buildAuthorizeUrl(signedState: string, nonce: string): string {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: googleClientId(),
        redirect_uri: googleRedirectUri(),
        // openid+email is all we need: a stable subject id, and an address to
        // show the player so they can tell which Google account they linked.
        scope: 'openid email profile',
        state: signedState,
        nonce,
        // Ask Google to show the account chooser rather than silently reusing
        // whichever account the browser happens to be signed into — players
        // routinely have more than one, and a silent pick links the wrong one.
        prompt: 'select_account',
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type GoogleIdentity = {
    sub: string;
    email: string;
    emailVerified: boolean;
    name: string;
    nonce: string;
};

type IdTokenClaims = {
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    given_name?: string;
    nonce?: string;
};

/** Decode a JWT payload without verifying its signature — see parseIdToken. */
function decodeJwtPayload(idToken: string): IdTokenClaims | null {
    const parts = String(idToken ?? '').split('.');
    if (parts.length !== 3) return null;
    try {
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as IdTokenClaims;
    } catch {
        return null;
    }
}

/**
 * Validate an ID token's claims and reduce it to the identity we store.
 *
 * The signature is deliberately not checked. This token was not handed to us by
 * a browser — it came straight back from Google's own token endpoint over a
 * validated TLS connection, which is the exact case Google documents as not
 * requiring local verification. That is only true because TOKEN_URL is a
 * hard-coded constant; if it ever becomes configurable, JWKS verification stops
 * being optional. Everything a signature would not have told us is still
 * checked: audience, issuer, expiry, the nonce we sent, and email_verified.
 */
export function parseIdToken(idToken: string, expectedNonce: string): GoogleIdentity | null {
    const claims = decodeJwtPayload(idToken);
    if (!claims) return null;

    if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return null;
    if (!claims.aud || !timingSafeEqualStr(claims.aud, googleClientId())) return null;
    if (!Number.isFinite(claims.exp) || Date.now() >= Number(claims.exp) * 1000) return null;
    if (!claims.nonce || !timingSafeEqualStr(claims.nonce, expectedNonce)) return null;

    const sub = String(claims.sub ?? '').trim();
    if (!sub) return null;

    // An unverified address is one someone typed, not one they proved they own.
    // Letting it through would make the account-recovery story a lie.
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (!emailVerified) return null;

    return {
        sub,
        email: String(claims.email ?? '').trim(),
        emailVerified,
        name: String(claims.given_name ?? claims.name ?? '').trim(),
        nonce: String(claims.nonce),
    };
}

/** Exchange an authorization code for Google's ID token. Null on any failure. */
export async function exchangeCodeForIdentity(code: string, expectedNonce: string): Promise<GoogleIdentity | null> {
    if (!googleAuthEnabled()) return null;
    const body = new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: googleClientId(),
        client_secret: googleClientSecret(),
        redirect_uri: googleRedirectUri(),
    });
    let json: { id_token?: string };
    try {
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            console.error(`[google-auth] token exchange failed: ${response.status}`);
            return null;
        }
        json = await response.json() as { id_token?: string };
    } catch (err) {
        console.error('[google-auth] token exchange threw:', (err as Error).message);
        return null;
    }
    if (!json.id_token) return null;
    return parseIdToken(json.id_token, expectedNonce);
}

// ─── Handoff ticket ───────────────────────────────────────────────────────────

/**
 * The callback runs in a top-level browser redirect, so it cannot hand the
 * client a session token through a header — and must not put one in the URL,
 * where it would land in history, referrers, and logs. Instead it stores the
 * outcome server-side under a random key and passes only that key back, which
 * the client immediately strips from the URL and trades for the real token over
 * POST. Same server-minted, single-use shape the reward endpoints use.
 */
/** The handoff hop is a redirect and a fetch — seconds, not minutes. */
const TICKET_TTL_SECONDS = 120;
/**
 * A signup ticket has to survive the whole character creator — village,
 * bloodline, avatar, name — so it gets a much longer window than the handoff.
 */
export const SIGNUP_TICKET_TTL_SECONDS = 30 * 60;

export type GoogleHandoffTicket = {
    /** The resolved account, when the Google identity already maps to one. */
    name?: string;
    /** Set when this Google account has no shinobi yet and one must be created. */
    needsSignup?: true;
    /** Kept server-side. The email is never echoed to whoever holds the ticket. */
    sub: string;
    email: string;
    suggestedName: string;
    /** Must match what the browser that started the flow echoes back. */
    nonce: string;
    /** Outcome of a link-mode flow, reported back to the settings screen. */
    linked?: true;
    exp: number;
};

export function googleTicketKey(ticket: string): string {
    return `auth-google-ticket:${String(ticket ?? '').slice(0, 128)}`;
}

export function newGoogleTicketId(): string {
    return randomBytes(24).toString('base64url');
}

export async function storeGoogleTicket(
    ticket: string,
    payload: Omit<GoogleHandoffTicket, 'exp'>,
    ttlSeconds: number = TICKET_TTL_SECONDS,
): Promise<void> {
    await kv.set(
        googleTicketKey(ticket),
        { ...payload, exp: Date.now() + ttlSeconds * 1000 },
        { ex: ttlSeconds },
    );
}

/**
 * Consume a ticket. The delete rowcount is the gate, so a replayed ticket — or
 * two racing tabs — yields exactly one winner. The nonce must also match, so a
 * ticket intercepted from the URL is useless in a different browser.
 */
export async function consumeGoogleTicket(ticket: string, nonce: string): Promise<GoogleHandoffTicket | null> {
    if (!ticket || !nonce) return null;
    const payload = await consumeSingleUseToken<GoogleHandoffTicket>(kv, googleTicketKey(ticket));
    if (!payload) return null;
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return null;
    if (!timingSafeEqualStr(nonce, payload.nonce)) return null;
    return payload;
}
