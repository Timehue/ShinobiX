// Route-specific request-body size classification for the Express server
// (server.ts). The 50 MB JSON parser is granted ONLY to the exact routes that
// carry large image / import payloads — NOT to the whole /admin/* tree, where an
// unauthenticated caller could otherwise force a 50 MB buffer + synchronous JSON
// parse BEFORE the handler's auth check runs. Player saves get a dedicated 1 MB
// parser so an oversized save is rejected at the parser boundary (matching the
// save handler's own 1 MB cap) instead of being buffered/parsed under the larger
// default first. Every other route is parsed under DEFAULT_JSON_LIMIT (256 KB):
// this runs before any auth check, so a 5 MB default let anyone make the server
// buffer and parse 5 MB on a poll route. The few routes that legitimately need
// more are named below.

// Large-body routes:
//   • images — image upload (data:image blobs).
//     NOT `img` (GET-only, no body) and NOT `generate-image` (its body is a
//     prompt + label, each capped at 1000 chars; the big blob is the RESPONSE).
//     Both used to get the 50 MB parser before their auth checks ran.
//   • admin/bloodline-review — the ONE admin surface that receives data:image
//     content; item-review + save-snapshot are included for content-review /
//     restore parity. Every OTHER /admin/* route takes a small body and no
//     longer gets the 50 MB parser (closes the pre-auth 50 MB parse surface).
export const BIG_BODY_RE =
    /(?:^|\/)images(?:\/|$)|\/admin\/(?:bloodline-review|item-review|save-snapshot)(?:\/|$)/;

// Player-save routes (bare and /api-prefixed). `save-snapshot` is deliberately
// NOT matched (it ends in `-snapshot`, not `save/…`), and it is already handled
// as a big-body admin route above. Capped at 1 MB: the save handler already
// rejects bodies over 1 MB, so nothing legitimate exceeds it — enforcing it here
// stops the oversized body before it is buffered/parsed.
export const SAVE_BODY_RE = /(?:^|\/)save(?:\/|$)/;

// ── Routes the 256 KB default would break (sweep of every client POST,
//    2026-11-16). Everything else sends a name, ids and a few scalars.

// Admin writes of whole blobs. Admin credentials get 5 MB (what every route had
// before the default was lowered); anyone else gets 1 MB.
//   • admin/content-publish — every authored catalog in one body (~300-400 KB
//     of JSON before any inline image edited this session).
//   • game-state — `villageLeadershipImages` is the whole base64 portrait map
//     (~355 KB measured). Its player kinds are small (`villageState` rows are
//     row-capped at 256 KB, ~5 KB in practice), which the 1 MB tier covers.
export const ADMIN_LARGE_BODY_RE = /(?:^|\/)(?:admin\/content-publish|game-state)(?:\/|$)/;

// Player routes whose body carries the sender's whole live character, inline
// avatar and pet art included (a challenge measured ~450 KB, an animated avatar
// can reach ~2.7 MB). The handlers discard that character and rebuild it from
// the save, so the real fix is a client that stops sending it; until then they
// keep the old 5 MB.
export const LARGE_BODY_RE = /(?:^|\/)(?:player\/challenge|village-guard\/challenge)(?:\/|$)/;

// One image in the body: the 1024 px profile portrait (validated at ≤1 MiB
// decoded, ~1.4 MB of base64) and a starter pet that may carry its art inline.
export const MEDIUM_BODY_RE = /(?:^|\/)(?:avatar-model\/profile-portrait|pet\/choose-starter)(?:\/|$)/;

export type BodyLimitClass = 'big' | 'save' | 'admin-large' | 'large' | 'medium' | 'default';

/** The JSON limit of every other route. */
export const DEFAULT_JSON_LIMIT = '256kb';

/**
 * True for the error a body parser raises when a body is over its limit. The
 * server answers it with a 413 rather than a logged 500: an oversized body is
 * the client's input, not a server fault.
 */
export function isOversizedBodyError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { type?: unknown; status?: unknown; statusCode?: unknown };
    return e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413;
}

/** Which JSON body-size limit a request path should be parsed under. */
export function classifyBodyLimit(path: string): BodyLimitClass {
    if (BIG_BODY_RE.test(path)) return 'big';
    if (SAVE_BODY_RE.test(path)) return 'save';
    if (ADMIN_LARGE_BODY_RE.test(path)) return 'admin-large';
    if (LARGE_BODY_RE.test(path)) return 'large';
    if (MEDIUM_BODY_RE.test(path)) return 'medium';
    return 'default';
}
