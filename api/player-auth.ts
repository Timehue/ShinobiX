import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors, safeName } from './_utils.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import {
    issuePlayerToken,
    readPlayerSessionEpoch,
    rotatePlayerSessionEpoch,
    isFullAdmin,
    verifyPlayerToken,
    playerSessionsEnabled,
} from './_auth.js';
import {
    consumeGoogleTicket,
    googleAuthEnabled,
    storeGoogleTicket,
    SIGNUP_TICKET_TTL_SECONDS,
    type GoogleHandoffTicket,
} from './_google-auth.js';
import { alreadyHoldsKvLock, withoutKvLeaseContext } from './_kv-lock-context.js';
import { withKvLock } from './_lock.js';
import {
    clearRecoveryCode,
    issueRecoveryCode,
    readRecoveryCode,
    recoveryCodeMatches,
    normalizeRecoveryCode,
} from './_recovery-code.js';
import { getActiveBan, recordClientIp, clientIpFrom, recordClientFingerprint, clientFpFrom } from './admin/moderation.js';
import { recordBetaMetric } from './_beta-metrics.js';
import { newRegistrationsDisabled } from './_launch-controls.js';
import { hasStaffImpersonationName, isCleanPlayerName, TEXT_LIMITS } from './_text-moderation.js';
import crypto from 'crypto';
import { accountDeletionStatus } from './_account-deletion-wait.js';

// Usernames reserved from the ordinary registration flow. New `register`
// requests for these names are refused unless the caller passes the admin
// password via the `x-admin-password` header. The first-time owner registers
// themselves by supplying that header once; after that, the existing auth
// record blocks any further registration anyway. Server reset also preserves
// their save + auth.
// Keep `rill` in sync with PROTECTED_ADMIN_USERNAME in
// shinobij.client/src/constants/game.ts.
//
// ⛔ `shanks` is the GOOGLE PLAY REVIEW account — do not remove it.
// Play Console holds its credentials under "Sign in details" and reuses them to
// review EVERY submission, not just the first. A server reset wipes ordinary
// accounts, so without this entry the reviewer's login would break on the next
// wipe and updates would be rejected for inaccessible content — weeks later,
// with a failure message that never mentions the reset. Being reserved also
// preserves its progression, so the account stays levelled enough for a
// reviewer to reach PvP, clans, pets and the shop without grinding, and stops
// a player squatting the name.
export const RESERVED_USERNAMES = new Set<string>(['rill', 'shanks']);
export function isReservedUsername(name: string): boolean {
    return RESERVED_USERNAMES.has(safeName(name));
}

// Storage-layer name prefixes that must NOT be allowed as player usernames.
// `save:<name>` routes saves through different validators depending on the
// name prefix — `save:clan-*` goes through validateClanSaveWrite (designed for
// shared clan records) instead of sanitizeCharacterSave (designed for
// individual players), so a player who registered as `clan-cheat` would
// bypass every character-level cap. `system` / `admin` / `server` are
// reserved for internal use. Reject these at the registration gate so the
// situation never arises.
const RESERVED_NAME_PREFIXES = ['clan-', 'admin-', 'system-', 'server-'];
// `full` and `content` are the two admin role names. Player and admin session
// tokens are signed differently now (see signAdminToken), but an account named
// after a role is still the one shape a future signing slip would turn into an
// admin token, so neither name is handed out.
const RESERVED_NAME_LITERALS = new Set(['admin', 'admin1', 'admin2', 'system', 'server', 'kage', 'narrator', 'player', 'full', 'content']);
// Object.prototype's own member names plus `prototype`, in the lowercase slug
// form safeName stores. Server code keys plain objects by player slug, and a
// slug like `constructor` or `__proto__` reads an INHERITED member there: the
// sleeper-kill per-target counter `byTarget[slug] ?? 0` returned the Object
// function, so a KO on a player named "constructor" priced NaN Honor Seals and
// slipped its per-target cap. Refused at creation like the storage prefixes
// above; existing accounts keep their names.
export const PROTOTYPE_MEMBER_NAMES: ReadonlySet<string> = new Set([
    '__proto__', 'constructor', 'prototype', 'hasownproperty', 'isprototypeof', 'propertyisenumerable',
    'tostring', 'tolocalestring', 'valueof', '__definegetter__', '__definesetter__', '__lookupgetter__', '__lookupsetter__',
]);
export function isReservedNameShape(name: string): boolean {
    // Check the safeName slug — that's the form the storage key actually uses,
    // so a display name like "clan - cheat" (slug "clan-cheat") is caught by
    // the `clan-` prefix guard exactly as a literal "clan-cheat" would be.
    const n = safeName(name);
    if (!n) return true;
    if (RESERVED_NAME_LITERALS.has(n) || PROTOTYPE_MEMBER_NAMES.has(n)) return true;
    return RESERVED_NAME_PREFIXES.some((p) => n.startsWith(p));
}

// `hash` stores either the legacy HMAC-SHA256 hex (no version prefix) or the
// new scrypt format `scrypt:N:r:p:hex`. New writes always use scrypt.
//
// `hash`/`salt` are OPTIONAL because an account can be passwordless: one created
// through Google sign-in, or a guest account. Those authenticate purely by
// session token. Every password comparison must therefore treat a missing
// credential as an authentication FAILURE, never as a match — see verifyAgainst.
export type AuthRecord = {
    hash?: string;
    salt?: string;
    sessionEpoch?: number;
    /** Linked Google identity. `sub` is Google's stable per-account subject id. */
    google?: { sub: string; email?: string; linkedAt: number };
    /** Guest account: no credential at all, swept after GUEST_INACTIVITY_MS idle. */
    guest?: true;
    /** Digest of the reusable, opaque guest credential; never a password. */
    guestResumeHash?: string;
    /** Authoritative server deadline for that credential. */
    guestResumeExpiresAt?: number;
    /** Narrow recovery marker for an unchanged legacy guest after a failed first-password write. */
    legacyGuestResumeEpoch?: number;
    /**
     * When the account was created. Only the guest sweep reads it, as the floor
     * for a guest who registered but never saved — ongoing activity comes from
     * `player:registry.lastSeen`, which is already written on the save path, so
     * ageing a guest out costs no extra writes anywhere.
     */
    createdAt?: number;
    /** Server time of a cancellable, player-requested 24-hour deletion wait. */
    deletionRequestedAt?: number;
};

/** True when the record carries no password and can only be entered by token. */
export function isPasswordlessRecord(record: AuthRecord | null | undefined): boolean {
    return !!record && (!record.hash || !record.salt);
}

/**
 * A guest who has not yet earned a way back in: still flagged `guest`, and with
 * no password either. The one predicate for "this character belongs to nobody".
 *
 * Both halves are required, because the `guest` flag alone is not enough. Only
 * the Google link clears it (`api/auth/google/callback.ts`); the `change` action
 * below deliberately spreads the record when setting a FIRST password, so the
 * flag survives on an account that now has a real, portable credential.
 *
 * Shared deliberately. Three very different consequences hang off this one line
 * — the tavern/message lock in `api/_guest-gate.ts`, account RECLAMATION in
 * `api/cron/_guest-sweep.ts`, and revoking the browser's resume credential in
 * `guest-resume` below. They were written with different predicates once, which
 * meant a player who set a password could talk in the tavern, still have their
 * character deleted for inactivity two weeks later, and leave the computer they
 * first played on holding a working key to the account. Keep it single.
 *
 * Returns a plain boolean, NOT a `record is AuthRecord` type predicate. A
 * predicate would be unsound: it would narrow the FALSE branch to
 * `null | undefined`, but the commonest record reaching that branch is a
 * perfectly real password account. Callers that need non-null narrowing should
 * test `record` themselves, as the sweep does.
 */
export function isCredentialLessGuest(record: AuthRecord | null | undefined): boolean {
    return record?.guest === true && isPasswordlessRecord(record);
}

/** A guest account is swept after this long with no activity. */
export const GUEST_INACTIVITY_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Storage key for a guest's resume credential.
 *
 * A guest has no password, so once their 24h session token lapses they would be
 * locked out of their own save — which is the whole reason guest play exists.
 * This is the refresh credential that fixes that: a random opaque key the
 * browser keeps, redeemable for a fresh session token, and expiring on its own
 * after GUEST_INACTIVITY_MS so an abandoned guest cannot be resumed after the
 * sweep has taken the account. Server-side and revocable, unlike a long-lived
 * bearer token, and it is not a password — nothing about it is reusable
 * anywhere else, and it disappears the moment the guest links Google.
 */
export function guestResumeKey(resume: string): string {
    return `guest-resume:${String(resume ?? '').slice(0, 128)}`;
}

export function guestResumeDigest(resume: string): string {
    return crypto.createHash('sha256').update(resume).digest('hex');
}

/** Successful ownership claims remove the guest's previous login authority. */
export function withoutGuestResumeAuthority(record: AuthRecord): AuthRecord {
    const claimed = { ...record };
    delete claimed.guestResumeHash;
    delete claimed.guestResumeExpiresAt;
    delete claimed.legacyGuestResumeEpoch;
    return claimed;
}

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Server-authoritative password policy. This mirrors account creation's client
 * validation and adds a hard maximum so hostile requests cannot send an
 * unbounded scrypt input.
 */
export function playerPasswordPolicyError(password: unknown): string | null {
    if (typeof password !== 'string') return 'Password must be text.';
    if (password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return 'Password must include at least one letter and one number.';
    }
    return null;
}

function playerPasswordVerificationError(password: unknown): string | null {
    if (typeof password !== 'string' || !password) return 'Missing password.';
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
    }
    return null;
}

function newSalt(): string {
    return crypto.randomBytes(16).toString('hex');
}

/** First value of a request header, normalised to a string. */
function headerValue(req: VercelRequest, key: string): string {
    const v = req.headers[key.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? '';
    return v ?? '';
}

// ─── Password hashing ─────────────────────────────────────────────────────────
// Three stored formats, all verified here:
//   - legacy:       bare HMAC-SHA256 hex (fast, vulnerable to GPU brute force if
//                   leaked). Re-hashed on the next successful login.
//   - scrypt:       `scrypt:N:r:p:hex`. The parameters live in the hash, so a
//                   cost increase never breaks an existing password: it is
//                   verified at the cost it was written with, then re-hashed
//                   at the current cost on that same successful login.
//   - scrypt-hmac:  `scrypt-hmac:N:r:p:hex` = scrypt(legacy HMAC hex). What
//                   `scripts/wrap-legacy-password-hashes.mjs` turns a dormant
//                   legacy row into, so the fast hash stops sitting in the
//                   database and its backups without waiting for that player to
//                   log in. Re-hashed to plain scrypt on their next login.
//
// Verification runs on libuv's threadpool (crypto.scrypt), not the event loop:
// scryptSync stalled every other player's heartbeat for the full derivation.

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
// scrypt needs 128 * N * r bytes — exactly 32 MiB at the current cost, which is
// Node's default ceiling, so give it explicit headroom.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
// A stored row naming absurd parameters (a corrupted or tampered value) must not
// become a memory or CPU bomb at login.
const SCRYPT_MAX_STORED_N = 1 << 16;
const SCRYPT_PREFIX = 'scrypt:';
const WRAPPED_LEGACY_PREFIX = 'scrypt-hmac:';

type ScryptParams = { N: number; r: number; p: number };
const CURRENT_SCRYPT: ScryptParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };

function scryptOptions(params: ScryptParams): crypto.ScryptOptions {
    return { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM };
}

function scryptAsync(input: string, salt: string, keylen: number, params: ScryptParams): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(input, salt, keylen, scryptOptions(params), (err, derived) => (err ? reject(err) : resolve(derived)));
    });
}

function formatScrypt(prefix: string, params: ScryptParams, derived: Buffer): string {
    return `${prefix}${params.N}:${params.r}:${params.p}:${derived.toString('hex')}`;
}

function parseStoredScrypt(hash: string): { wrappedLegacy: boolean; params: ScryptParams; hex: string } | null {
    const wrappedLegacy = hash.startsWith(WRAPPED_LEGACY_PREFIX);
    if (!wrappedLegacy && !hash.startsWith(SCRYPT_PREFIX)) return null;
    const parts = hash.slice(wrappedLegacy ? WRAPPED_LEGACY_PREFIX.length : SCRYPT_PREFIX.length).split(':');
    if (parts.length !== 4) return null;
    const [N, r, p] = parts.slice(0, 3).map(Number);
    const hex = parts[3];
    if (!Number.isSafeInteger(N) || N < 2 || N > SCRYPT_MAX_STORED_N || (N & (N - 1)) !== 0) return null;
    if (!Number.isSafeInteger(r) || r < 1 || r > 16 || !Number.isSafeInteger(p) || p < 1 || p > 4) return null;
    if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 32 || hex.length > 256) return null;
    return { wrappedLegacy, params: { N, r, p }, hex };
}

/** True when a stored hash should be rewritten at the current cost on the next successful login. */
export function passwordHashNeedsUpgrade(hash: string | undefined): boolean {
    if (!hash) return false;
    const parsed = parseStoredScrypt(hash);
    if (!parsed || parsed.wrappedLegacy) return true;
    return parsed.params.N < SCRYPT_N || parsed.params.r < SCRYPT_R || parsed.params.p < SCRYPT_P;
}

/** Synchronous derivation. Only for the one-off dummy record and the legacy `hashPw` export. */
function hashScryptSync(password: string, salt: string): string {
    return formatScrypt(SCRYPT_PREFIX, CURRENT_SCRYPT, crypto.scryptSync(password, salt, SCRYPT_KEYLEN, scryptOptions(CURRENT_SCRYPT)));
}

async function hashScrypt(password: string, salt: string): Promise<string> {
    return formatScrypt(SCRYPT_PREFIX, CURRENT_SCRYPT, await scryptAsync(password, salt, SCRYPT_KEYLEN, CURRENT_SCRYPT));
}

// Keep nonexistent-account verification on the same expensive password path
// as a real account. Without this dummy record, attackers can distinguish an
// unused name both from the response body and from the missing scrypt work.
const DUMMY_AUTH_RECORD: AuthRecord = {
    salt: 'player-auth-enumeration-guard-v1',
    hash: hashScryptSync('DummyAccountPassword1', 'player-auth-enumeration-guard-v1'),
};

function hashLegacy(password: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

/**
 * Wrap a legacy HMAC hash in scrypt without knowing the password. Used by the
 * offline migration script; verification reproduces it from the password via
 * hashLegacy, then scrypt.
 */
export async function wrapLegacyPasswordHash(legacyHash: string, salt: string): Promise<string> {
    return formatScrypt(WRAPPED_LEGACY_PREFIX, CURRENT_SCRYPT, await scryptAsync(legacyHash, salt, SCRYPT_KEYLEN, CURRENT_SCRYPT));
}

// Public alias retained for backward compat with any other callers — always
// uses the modern algorithm now. Synchronous for those callers (tests, seed
// tooling); request paths use the async hashScrypt.
export function hashPw(password: string, salt: string): string {
    return hashScryptSync(password, salt);
}

function safeStringEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
        crypto.timingSafeEqual(ba, ba); // keep timing flat-ish
        return false;
    }
    return crypto.timingSafeEqual(ba, bb);
}

/**
 * Verify a password against a stored AuthRecord. Handles both legacy and
 * modern hash formats. Returns true if valid.
 */
async function verifyAgainst(record: AuthRecord, password: string): Promise<boolean> {
    // Fail closed on a passwordless record (Google-only or guest). Without this
    // guard the comparisons below would throw on `undefined.startsWith`, and any
    // future refactor that swallowed the throw would turn "has no password" into
    // "matches every password". Those accounts authenticate by token only.
    const { hash, salt } = record;
    if (!hash || !salt) return false;
    if (hash.startsWith(SCRYPT_PREFIX) || hash.startsWith(WRAPPED_LEGACY_PREFIX)) {
        const parsed = parseStoredScrypt(hash);
        if (!parsed) return false;
        const input = parsed.wrappedLegacy ? hashLegacy(password, salt) : password;
        const derived = await scryptAsync(input, salt, parsed.hex.length / 2, parsed.params);
        return safeStringEqual(derived.toString('hex'), parsed.hex);
    }
    return safeStringEqual(hashLegacy(password, salt), hash);
}

/**
 * Reverse index from a Google subject id to the shinobi slug that claimed it.
 * `sub` is Google's stable, opaque per-account identifier — never the email,
 * which a user can change and which Google explicitly says not to key on.
 * Claimed with a `{ nx: true }` write so one Google account maps to exactly one
 * shinobi, and cleared whenever the account or the link goes away.
 *
 * ONE GOOGLE ACCOUNT = ONE SHINOBI is a deliberate product decision (owner
 * ruling, 2026-08-17), not a technical limit. Supporting several would be a
 * small change here — a list instead of a name, plus a character picker.
 *
 * What makes it expensive is everything downstream. Preventing two characters
 * being signed in at once is cheap (rotate the sibling's session epoch), and it
 * does close the exploits that need both online together — self-feeding PvP,
 * filling two party slots. But this game's balance risks accumulate while you
 * are away: idle training pays out on wall-clock elapsed time whether or not
 * anyone is signed in, sector war is a 72-hour scored window with uncapped
 * per-player contribution, and clan treasury, clan boss, and ranked all
 * accrue asynchronously. Two characters double all of that no matter who is
 * logged in, so a real "two characters" feature means per-PERSON caps across
 * those five systems, not a login change.
 *
 * Loosening this later is a welcome announcement; tightening it after players
 * hold two characters is not. So it ships strict, to be revisited with live
 * data rather than guessed at pre-launch.
 */
export function googleIdentityKey(sub: string): string {
    return `auth-google:${String(sub ?? '').slice(0, 128)}`;
}

/** Caller holds auth:<name>; never detach a subject reassigned to another account. */
export async function releaseGoogleIdentityForAccount(name: string, sub: string): Promise<boolean> {
    const identityKey = googleIdentityKey(sub);
    return withKvLock(identityKey, async () => {
        const owner = await kv.get<{ name?: string }>(identityKey);
        if (safeName(owner?.name ?? '') !== safeName(name)) return false;
        return kv.delIfEqual(identityKey, owner);
    }, { failClosed: true });
}

type AuthFailure = { status: number; body: Record<string, unknown> };

/**
 * Every gate a brand-new shinobi name has to pass, in one place.
 *
 * Extracted verbatim from `register` so that Google signup and guest play run
 * exactly the same checks — a name that is reserved, blocked, or storage-unsafe
 * has to be refused whichever door it walks through, and a second copy of this
 * list would drift the first time one of them changed.
 */
export function newAccountNameError(req: VercelRequest, name: string): AuthFailure | null {
    // Empty-slug guard: the account identity is the safeName slug. A name
    // made entirely of characters safeName strips (all emoji / punctuation)
    // collapses to '' and would write the bare `auth:` / `save:` keys.
    if (!safeName(name)) {
        return { status: 400, body: { ok: false, error: 'Pick a name with at least one letter or number.' } };
    }

    // Bound the DISPLAY name. Only the derived slug was capped (safeName), so a
    // registration could store an arbitrarily long `character.name` that then
    // rendered in OTHER players' leaderboards, nameplates, chat and clan rosters —
    // breaking their layout. Rejected with a message here; the save sanitizer
    // truncates as a backstop against a tampered client.
    if (name.trim().length > TEXT_LIMITS.playerName) {
        return {
            status: 400,
            body: { ok: false, error: `Names are at most ${TEXT_LIMITS.playerName} characters.` },
        };
    }

    // Names are public identity, so reject blocked terms outright instead
    // of masking them. The check normalizes common leetspeak, punctuation,
    // spacing, and repeated letters before matching.
    if (!isCleanPlayerName(name)) {
        return {
            status: 400,
            body: { ok: false, error: 'That username is not allowed. Pick a different name.' },
        };
    }

    // Reserved-shape defense: storage-layer prefixes like `clan-` route
    // saves through the wrong validator (`validateClanSaveWrite` instead
    // of `sanitizeCharacterSave`), bypassing every character-level cap.
    // Names like `admin` / `system` / `server` are reserved for internal
    // use. Refuse these at the gate so the bad code path never runs.
    if (isReservedNameShape(name)) {
        return { status: 403, body: { ok: false, error: 'That username is reserved. Pick a different name.' } };
    }

    // Names that read as staff ("Admin", "OfficialModerator", "The Owner") are an
    // impersonation surface in chat and whispers, exactly as custom titles are.
    // Existing accounts keep their names; this gates new names and renames.
    if (hasStaffImpersonationName(name)) {
        return { status: 400, body: { ok: false, error: 'Names that look like staff or village leaders are not allowed. Pick a different name.' } };
    }

    // Reserved-username defense: the protected admin account can only be
    // claimed once, and only by someone holding the admin password. This
    // prevents random players from grabbing the privileged username after
    // a fresh server-reset. The reservation is on the *first* registration
    // only — once the auth record exists, the `existing` check refuses any
    // further registration anyway.
    if (isReservedUsername(name) && !isFullAdmin(req)) {
        return {
            status: 403,
            body: { ok: false, error: 'This username is reserved. Ask an admin to register it.' },
        };
    }

    return null;
}

/** The emergency-switch response shared by every account-creating action. */
function registrationsDisabledResponse(res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '300');
    return res.status(503).json({
        ok: false,
        error: 'New registrations are temporarily disabled.',
        code: 'registrations_disabled',
    });
}

/**
 * Claim an unused slug and write its first auth record, under the account lock.
 *
 * `buildRecord` receives the session epoch read inside the lock; whatever it
 * returns is written with NX, which stays the final concurrency gate if a
 * non-cooperating writer races the lock or a lock lease expires.
 */
async function claimNewAccountSlug(
    name: string,
    buildRecord: (sessionEpoch: number) => AuthRecord,
): Promise<{ error: AuthFailure } | { sessionEpoch: number }> {
    const key = authKey(name);
    return await withKvLock(key, () => claimNewAccountSlugLocked(name, buildRecord), { failClosed: true });
}

/** Caller already holds auth:<name>; Google signup adds the subject lock inside it. */
async function claimNewAccountSlugLocked(
    name: string,
    buildRecord: (sessionEpoch: number) => AuthRecord,
): Promise<{ error: AuthFailure } | { sessionEpoch: number }> {
    const key = authKey(name);
    const { accountNameKey } = await import('./_account-name.js');
    if (await kv.get(accountNameKey(name))) {
        return { error: { status: 409, body: { ok: false, error: 'That account name is already taken.' } } };
    }
    const existing = await kv.get<AuthRecord>(key);
    if (existing) {
        return { error: { status: 409, body: { ok: false, error: 'Account already has a password.' } } };
    }

    // A save without an auth row is a legacy account. Only the
    // authenticated admin-reset recovery path may claim it.
    const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
    if (saveBlob) {
        return {
            error: {
                status: 409,
                body: {
                    ok: false,
                    error: 'This account is a legacy account without a server password. Ask an admin to set it for you.',
                    legacyNeedsAdmin: true,
                },
            },
        };
    }

    const sessionEpoch = await readPlayerSessionEpoch(name);
    // Slugs are reusable: an inherited recovery code would otherwise become
    // a working credential to the newly published account.
    // Remove inherited recovery authority before publishing the account. A
    // cleanup failure must not leave a committed, unreachable signup.
    await clearRecoveryCode(name);
    const created = await kv.set(key, buildRecord(sessionEpoch), { nx: true });
    if (!created) {
        return { error: { status: 409, body: { ok: false, error: 'Account already has a password.' } } };
    }
    return { sessionEpoch };
}

export function authKey(name: string): string {
    return `auth:${safeName(name)}`;
}

/**
 * Repair a prior rotate-then-write failure after fresh credential proof. The
 * caller must hold auth:<name> and prove the CURRENT password or Google link;
 * tokens and old handoff tickets must never call this repair path.
 */
export async function synchronizeVerifiedAuthRecordEpoch(name: string, record: AuthRecord): Promise<AuthRecord> {
    if (!alreadyHoldsKvLock(authKey(name))) throw new Error('Credential generation repair requires the account lock.');
    const currentEpoch = await readPlayerSessionEpoch(name);
    const recordEpoch = record.sessionEpoch ?? 0;
    if (!Number.isSafeInteger(recordEpoch) || recordEpoch < 0 || recordEpoch > currentEpoch) {
        throw new Error('Account credential generation is inconsistent.');
    }
    if (recordEpoch === currentEpoch) return record;
    const synchronized = { ...record, sessionEpoch: currentEpoch };
    await kv.set(authKey(name), synchronized);
    return synchronized;
}

async function issuePlayerTokenForRecord(name: string, record: AuthRecord): Promise<string | null> {
    try {
        const recordEpoch = record.sessionEpoch ?? 0;
        const token = issuePlayerToken(name, undefined, recordEpoch);
        if (!token) return null;
        const currentEpoch = await readPlayerSessionEpoch(name);
        // A prior credential mutation may have rotated successfully but failed
        // before its auth-row write. Never mint a token for that stale record;
        // password fallback remains available until the mutation is retried.
        if (recordEpoch !== currentEpoch) return null;
        return token;
    } catch {
        return null;
    }
}

export async function verifyPlayerPassword(name: string, password: string): Promise<boolean> {
    const key = authKey(name);
    const record = await kv.get<AuthRecord>(key);
    if (!record) return false;
    const ok = await verifyAgainst(record, password);
    // Opportunistically migrate legacy and lower-cost hashes on successful login.
    if (ok && passwordHashNeedsUpgrade(record.hash)) {
        try {
            const salt = newSalt();
            const upgradedHash = await hashScrypt(password, salt);
            // Serialize with credential mutations and re-check the observed
            // record. Otherwise a slow legacy migration can overwrite a newly
            // changed password with the old password's upgraded hash.
            await withKvLock(key, async () => {
                const current = await kv.get<AuthRecord>(key);
                if (!current || current.hash !== record.hash || current.salt !== record.salt) return;
                await kv.set(key, { ...current, hash: upgradedHash, salt });
            }, { failClosed: true });
        } catch {
            // Migration is best-effort — auth itself already succeeded.
        }
    }
    return ok;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Parse the body BEFORE rate-limiting so the limiter can bucket per action.
    // This is only JSON.parse — no storage, no hashing — so it cannot be abused for
    // load, and every expensive path (scrypt verification in particular) still sits
    // behind the limiter below.
    let body: unknown;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ ok: false, error: 'Invalid request body.' });
    }
    const {
        action, name: requestedName, password, oldPassword, newPassword, signupTicket, nonce, guestResume, recoveryCode,
    } = body as {
        action?: string;
        name?: string;
        password?: string;
        oldPassword?: string;
        newPassword?: string;
        signupTicket?: string;
        nonce?: string;
        guestResume?: string;
        recoveryCode?: string;
    };

    // Rate-limit auth by IP, KV-backed so an attacker can't hop instances to reset
    // the counter. Keyed on IP and NOT on the supplied name: the name is
    // unauthenticated at this point, so trusting it would let an attacker mint a
    // fresh budget per request and defeat the limit entirely.
    //
    // PER ACTION, because IP keying means one internet connection shares one budget.
    // A single 20-attempt budget spanning register + verify + change was small enough
    // that a group of friends signing up together from one household, dorm, or
    // carrier-NAT address exhausted it collectively — and each of them was then told
    // their password was wrong (the client reported 429 as a credential failure).
    // Splitting the buckets means a login is never blocked by someone else's
    // registration attempts, and the budgets are sized for real group behaviour:
    // logins retry on typos, registrations retry on taken names.
    //
    // `guest` is the tightest of them: it is the only action that creates an
    // account with no cost to the caller at all, so it also carries a second,
    // fingerprint-keyed budget inside the action itself. `guest-resume` is
    // sized like `verify` — it is a returning player's login.
    //
    // `recover` is sized like a password reset rather than a login, because it
    // is one: a real player runs it once, off a code they are reading, so a
    // small budget costs them nothing while keeping the unauthenticated
    // credential-setting path the least attractive door on the endpoint. It is
    // deliberately NOT paired with a per-account attempt lockout — see the
    // action itself for why that would be a griefing vector rather than a
    // defence at this code length.
    const AUTH_BUDGETS: Record<string, number> = {
        verify: 40,
        register: 25,
        'register-google': 15,
        guest: 10,
        'guest-resume': 40,
        change: 15,
        delete: 10,
        recover: 10,
        'recovery-issue': 10,
        'admin-recovery': 20,
        'logout-others': 10,
        'google-unlink': 10,
    };
    const authAction = typeof action === 'string' ? action : 'unknown';
    const authBudget = AUTH_BUDGETS[authAction] ?? 20;
    // `strict` so a storage outage degrades to the per-instance limiter instead of
    // failing OPEN — this is the one endpoint where fail-open means unlimited scrypt,
    // and scrypt is ~100ms of blocking CPU per attempt on a single-threaded server.
    if (!(await enforceRateLimitKv(
        req, res, `player-auth:${authAction}`, authBudget, 15 * 60_000, undefined, { strict: true },
    ))) return;

    let name = requestedName;
    if (typeof name !== 'string' || !name) {
        return res.status(400).json({ ok: false, error: 'Missing name.' });
    }
    if (!safeName(name)) {
        return res.status(400).json({ ok: false, error: 'Pick a name with at least one letter or number.' });
    }
    if (action === 'verify' || action === 'recover') {
        try {
            const { resolveAccountLogin } = await import('./_account-name.js');
            const resolved = await resolveAccountLogin(name);
            if (!resolved) {
                if (typeof password === 'string') await verifyAgainst(DUMMY_AUTH_RECORD, password);
                return res.status(action === 'verify' ? 200 : 400).json({ ok: false, error: 'Account name or credentials are incorrect.' });
            }
            name = resolved;
        } catch {
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }
    const key = authKey(name);

    if (action === 'register') {
        // Keep this check inside the handler as well as the Railway/Express
        // route boundary so a direct serverless invocation cannot bypass the
        // emergency registration switch.
        if (newRegistrationsDisabled()) return registrationsDisabledResponse(res);
        let registeredSessionEpoch = 0;
        // Register a new password. Fails if one already exists — use 'change' to update.
        if (typeof password !== 'string') return res.status(400).json({ ok: false, error: 'Password must be text.' });
        const passwordPolicyError = playerPasswordPolicyError(password);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });

        const nameError = newAccountNameError(req, name);
        if (nameError) return res.status(nameError.status).json(nameError.body);

        try {
            const salt = newSalt();
            const hash = await hashScrypt(password, salt);
            const claim = await claimNewAccountSlug(name, (sessionEpoch) => ({ hash, salt, sessionEpoch }));
            if ('error' in claim) {
                return res.status(claim.error.status).json(claim.error.body);
            }
            registeredSessionEpoch = claim.sessionEpoch;
            await recordBetaMetric({ event: 'account.registered', playerName: safeName(name), source: 'auth' });
        } catch (err) {
            console.error('[player-auth register]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        // Issue a session token so the client can use the cheap token path
        // immediately instead of re-sending the password (and re-running
        // scrypt server-side) on every subsequent request. null when
        // SESSION_SECRET is unset — client then keeps using the password.
        return res.status(200).json({
            ok: true,
            token: issuePlayerToken(name, undefined, registeredSessionEpoch) ?? undefined,
        });
    }

    // Create an account owned by a Google identity, with no password at all.
    // The Google subject comes from the server-side signup ticket minted by
    // /api/auth/google/claim — never from the request body, so a client cannot
    // choose whose identity it is registering as.
    if (action === 'register-google') {
        if (newRegistrationsDisabled()) return registrationsDisabledResponse(res);
        if (!googleAuthEnabled()) {
            return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });
        }
        // A passwordless account with no session tokens could never be entered
        // again. Refuse to create one rather than strand the player.
        if (!playerSessionsEnabled()) {
            return res.status(503).json({ ok: false, error: 'Google sign-in is unavailable.' });
        }
        const ticket = typeof signupTicket === 'string' ? signupTicket : '';
        const ticketNonce = typeof nonce === 'string' ? nonce : '';
        if (!ticket || !ticketNonce) {
            return res.status(400).json({ ok: false, error: 'Missing signup ticket.' });
        }

        const nameError = newAccountNameError(req, name);
        if (nameError) return res.status(nameError.status).json(nameError.body);

        let identity: GoogleHandoffTicket | null;
        try {
            identity = await consumeGoogleTicket(ticket, ticketNonce);
        } catch (err) {
            console.error('[player-auth register-google]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        if (!identity?.sub) {
            return res.status(410).json({ ok: false, error: 'That sign-in link has already been used or expired.' });
        }
        const signupIdentity = identity;

        /**
         * The ticket is consumed up front so it can only ever mint one account,
         * but "that name is taken" is a routine answer, not a dead end. Put the
         * ticket back on every failure so the player can pick another name
         * without walking through Google again.
         */
        const restoreTicket = async () => {
            try {
                await storeGoogleTicket(ticket, signupIdentity, SIGNUP_TICKET_TTL_SECONDS);
            } catch { /* best effort — worst case they re-run the Google flow */ }
        };

        try {
            // Every Google mutation orders the locks account -> subject. The
            // subject reservation and auth publication remain one critical
            // section, so dangling-index cleanup cannot erase this new owner.
            return await withKvLock(key, () => withKvLock(googleIdentityKey(signupIdentity.sub), async () => {
                const identityKey = googleIdentityKey(signupIdentity.sub);
                const owner = { name: safeName(name) };
                const claimedIdentity = await kv.set(identityKey, owner, { nx: true });
                if (!claimedIdentity) {
                    await restoreTicket();
                    return res.status(409).json({
                        ok: false,
                        error: 'That Google account is already linked to another shinobi.',
                        googleTaken: true,
                    });
                }

                let claim: Awaited<ReturnType<typeof claimNewAccountSlugLocked>>;
                try {
                    claim = await claimNewAccountSlugLocked(name, (sessionEpoch) => ({
                        sessionEpoch,
                        createdAt: Date.now(),
                        google: { sub: signupIdentity.sub, email: signupIdentity.email, linkedAt: Date.now() },
                    }));
                } catch (err) {
                    // A rejected write can have committed remotely. Keep its index
                    // if the account now owns this subject; otherwise release only
                    // this reservation and let the same signup ticket be retried.
                    const committed = await kv.get<AuthRecord>(key);
                    if (committed?.google?.sub !== signupIdentity.sub) {
                        await kv.delIfEqual(identityKey, owner);
                        await restoreTicket();
                    }
                    throw err;
                }
                if ('error' in claim) {
                    await kv.delIfEqual(identityKey, owner);
                    await restoreTicket();
                    return res.status(claim.error.status).json(claim.error.body);
                }
                await recordBetaMetric({ event: 'account.registered', playerName: safeName(name), source: 'google' });
                return res.status(200).json({
                    ok: true,
                    name: safeName(name),
                    token: issuePlayerToken(name, undefined, claim.sessionEpoch) ?? undefined,
                });
            }, { failClosed: true }), { failClosed: true });
        } catch (err) {
            console.error('[player-auth register-google]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // Guest play: a real account with a real save, just no owner yet. It is
    // reachable only from the browser that made it, and the daily sweep reclaims
    // it after GUEST_INACTIVITY_MS of silence. Linking Google turns it into an
    // ordinary account in place — same slug, same save, nothing migrated.
    if (action === 'guest') {
        if (newRegistrationsDisabled()) return registrationsDisabledResponse(res);
        // DISABLE_GUEST_PLAY=1 is the kill switch; guest play ships on.
        if (process.env.DISABLE_GUEST_PLAY === '1' || !playerSessionsEnabled()) {
            return res.status(503).json({ ok: false, error: 'Guest play is unavailable.' });
        }
        // A one-click account is friction-free for the player and for a script,
        // so this gets its own much tighter budget than `register`, charged
        // against the browser fingerprint as well as the IP.
        const guestFp = clientFpFrom(req);
        if (!(await enforceRateLimitKv(
            req, res, `player-auth:guest-fp:${guestFp || 'none'}`, 3, 60 * 60_000, undefined, { strict: true },
        ))) return;

        const nameError = newAccountNameError(req, name);
        if (nameError) return res.status(nameError.status).json(nameError.body);

        try {
            const resume = crypto.randomBytes(24).toString('base64url');
            const claim = await claimNewAccountSlug(name, (sessionEpoch) => ({
                sessionEpoch,
                guest: true,
                createdAt: Date.now(),
                guestResumeHash: guestResumeDigest(resume),
                guestResumeExpiresAt: Date.now() + GUEST_INACTIVITY_MS,
            }));
            if ('error' in claim) {
                return res.status(claim.error.status).json(claim.error.body);
            }
            // The auth row already contains its only login door. This unchanged
            // legacy index is optional metadata, never a second required commit.
            try {
                await kv.set(guestResumeKey(resume), { name: safeName(name) }, { ex: Math.floor(GUEST_INACTIVITY_MS / 1000) });
            } catch (err) {
                console.error('[player-auth guest legacy-index]', String(err));
            }
            await recordBetaMetric({ event: 'account.registered', playerName: safeName(name), source: 'guest' });
            return res.status(200).json({
                ok: true,
                name: safeName(name),
                guestResume: resume,
                token: issuePlayerToken(name, undefined, claim.sessionEpoch) ?? undefined,
            });
        } catch (err) {
            console.error('[player-auth guest]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // Trade a guest's resume credential for a fresh session token, so closing
    // the tab and coming back tomorrow does not lose the character. Deliberately
    // NOT single-use: it is the guest's only way back in, so consuming it on a
    // dropped response would lock them out permanently. Its own expiry is the
    // bound, re-stamped here on each successful use.
    if (action === 'guest-resume') {
        if (!playerSessionsEnabled()) {
            return res.status(503).json({ ok: false, error: 'Guest play is unavailable.' });
        }
        const resume = typeof guestResume === 'string' ? guestResume : '';
        if (!resume) return res.status(400).json({ ok: false, error: 'Missing resume key.' });
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(resume)) {
            return res.status(410).json({ ok: false, error: 'This guest character is no longer available.' });
        }

        try {
            return await withKvLock(key, async () => {
                let record = await kv.get<AuthRecord>(key);
                const unavailable = () => res.status(410).json({ ok: false, error: 'This guest character is no longer available.' });
                if (!record) return unavailable();

                const digest = guestResumeDigest(resume);
                const hasBoundAuthority = record.guestResumeHash !== undefined || record.guestResumeExpiresAt !== undefined;
                let legacyOwner: { name?: string } | null = null;
                if (hasBoundAuthority) {
                    if (typeof record.guestResumeHash !== 'string'
                        || !/^[a-f0-9]{64}$/.test(record.guestResumeHash)
                        || !safeStringEqual(record.guestResumeHash, digest)
                        || typeof record.guestResumeExpiresAt !== 'number'
                        || !Number.isFinite(record.guestResumeExpiresAt)) return unavailable();
                    // The stamp is only re-set by a resume, and an active guest
                    // never resumes (the sliding token keeps them in), so it ran
                    // out 14 days after creation however often they played. The
                    // bound is INACTIVITY, the rule the guest sweep reclaims by:
                    // a save written in the last 14 days keeps the key valid.
                    if (record.guestResumeExpiresAt <= Date.now()) {
                        const save = await kv.get<{ _saveAt?: unknown }>(`save:${safeName(name)}`);
                        const savedAt = Number(save?._saveAt);
                        if (!Number.isFinite(savedAt) || savedAt <= 0 || savedAt + GUEST_INACTIVITY_MS <= Date.now()) return unavailable();
                    }
                } else {
                    // A name-only index is sufficient only for a never-reused
                    // epoch-zero legacy account, or with current token proof.
                    legacyOwner = await kv.get<{ name?: string }>(guestResumeKey(resume));
                    if (safeName(legacyOwner?.name ?? '') !== safeName(name)) return unavailable();
                }

                const ban = await getActiveBan(name);
                if (ban) {
                    return res.status(403).json({
                        ok: false,
                        error: 'Account is banned.',
                        ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                    });
                }
                // A successful claim removes digest authority. Its legacy
                // index may still name this account; it can explain the proper
                // login door, but must never mint a session.
                if (!isCredentialLessGuest(record) || record.google) {
                    const residueOwner = legacyOwner ?? await kv.get<{ name?: string }>(guestResumeKey(resume));
                    if (safeName(residueOwner?.name ?? '') === safeName(name)) {
                        await kv.delIfEqual(guestResumeKey(resume), residueOwner);
                    }
                    const doors = [
                        isPasswordlessRecord(record) ? '' : 'its password',
                        record.google ? 'Google' : '',
                    ].filter(Boolean);
                    return res.status(409).json({
                        ok: false,
                        error: doors.length
                            ? `This character has an owner now — sign in with ${doors.join(' or ')}.`
                            : 'This character has an owner now.',
                    });
                }

                const currentEpoch = await readPlayerSessionEpoch(name);
                const recordEpoch = record.sessionEpoch ?? 0;
                if (!Number.isSafeInteger(recordEpoch) || recordEpoch < 0 || recordEpoch > currentEpoch) {
                    throw new Error('Account credential generation is inconsistent.');
                }
                if (!hasBoundAuthority) {
                    const suppliedToken = headerValue(req, 'x-player-token');
                    const currentTokenProof = !!suppliedToken && await verifyPlayerToken(suppliedToken) === safeName(name);
                    const repairedLegacyProof = record.legacyGuestResumeEpoch === currentEpoch && recordEpoch === currentEpoch;
                    if (!currentTokenProof && !repairedLegacyProof && (recordEpoch !== 0 || currentEpoch !== 0)) return unavailable();
                }

                // Current digest/token proof or the restricted legacy path
                // binds authority to this auth row. Refresh and lower-epoch
                // repair commit together; old tokens remain revoked.
                record = {
                    ...record,
                    guestResumeHash: digest,
                    guestResumeExpiresAt: Date.now() + GUEST_INACTIVITY_MS,
                    sessionEpoch: currentEpoch,
                };
                delete record.legacyGuestResumeEpoch;
                await kv.set(key, record);
                const token = await issuePlayerTokenForRecord(name, record);
                if (!token) throw new Error('Guest session could not be issued. Retry from current state.');
                void recordClientIp(name, clientIpFrom(req));
                const resumeFp = clientFpFrom(req);
                if (resumeFp) void recordClientFingerprint(name, resumeFp);
                return res.status(200).json({ ok: true, name: safeName(name), token });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth guest-resume]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }
    if (action === 'verify') {
        // Verify a password. Legacy saves without a credential are recovery
        // cases, never successful authentication.
        const verificationError = playerPasswordVerificationError(password);
        if (verificationError) return res.status(400).json({ ok: false, error: verificationError });
        const verifiedPassword = password as string;
        let record: AuthRecord | null;
        try {
            record = await kv.get<AuthRecord>(key);
        } catch (err) {
            // KV read failure (Supabase timeout, network hiccup, etc.).
            // Return 503 rather than misreporting a storage outage as a wrong
            // password. The client keeps the account locked and offers retry.
            console.error('[player-auth verify]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        if (!record) {
            // Burn the same scrypt work as an existing-account failure before
            // consulting legacy-save recovery state. The result is deliberately
            // ignored: this record can never authenticate a caller.
            await verifyAgainst(DUMMY_AUTH_RECORD, verifiedPassword);
            // Only a real save qualifies as legacy. The client may surface the
            // recovery state, but only authenticated adminreset can claim it.
            try {
                const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
                if (saveBlob) {
                    return res.status(409).json({
                        ok: false,
                        error: 'This legacy account requires authenticated admin recovery.',
                        legacy: true,
                        legacyNeedsAdmin: true,
                    });
                }
                return res.status(200).json({ ok: false });
            } catch (err) {
                console.error('[player-auth verify legacy]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
        }
        // A Google-only or guest account has no password to compare against, so
        // this form can never accept anything for it. Burn the same scrypt work
        // as a real failure, then say plainly which door to use — otherwise a
        // player who forgot they signed up with Google is stuck retyping
        // passwords forever. Player names are already public on the leaderboard,
        // so naming the sign-in method leaks nothing the Hall of Legends doesn't.
        if (isPasswordlessRecord(record)) {
            await verifyAgainst(DUMMY_AUTH_RECORD, verifiedPassword);
            return res.status(200).json({
                ok: false,
                passwordless: true,
                google: !!record.google,
                error: record.google
                    ? 'This account signs in with Google.'
                    : 'This account has no password yet — continue as a guest on the device you created it on, or link Google to secure it.',
            });
        }

        const valid = await verifyAgainst(record, verifiedPassword);
        if (!valid) return res.status(200).json({ ok: false });

        // Derived outside the lock: it is the slow part, and is thrown away if
        // the record turns out to be current already.
        let upgradedCredential: { hash: string; salt: string } | null = null;
        if (passwordHashNeedsUpgrade(record.hash)) {
            const salt = newSalt();
            upgradedCredential = { hash: await hashScrypt(verifiedPassword, salt), salt };
        }

        try {
            return await withKvLock(key, async () => {
                let current = await kv.get<AuthRecord>(key);
                // The password proof was obtained before waiting for the lock. A
                // changed hash cannot be promoted to the new credential generation.
                if (!current || current.hash !== record.hash || current.salt !== record.salt) {
                    return res.status(200).json({ ok: false });
                }
                // Refuse login for banned accounts. The client surfaces this so the
                // user sees a clear "you are banned until X — reason: Y" message.
                const ban = await getActiveBan(name);
                if (ban) {
                    return res.status(403).json({
                        ok: false,
                        error: 'Account is banned.',
                        ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                    });
                }

                current = await synchronizeVerifiedAuthRecordEpoch(name, current);
                // A legacy upgrade remains best effort, while generation repair above
                // must commit before this verified login can mint a usable token.
                if (upgradedCredential && passwordHashNeedsUpgrade(current.hash)) {
                    const upgraded = { ...current, ...upgradedCredential };
                    try {
                        await kv.set(key, upgraded);
                        current = upgraded;
                    } catch { /* Keep the verified legacy credential if migration fails. */ }
                }

                // Capture the login IP + browser fingerprint so the Moderation lookup
                // can link sock-puppets even before the player heartbeats — and even
                // if they're hiding behind a VPN.
                void recordClientIp(name, clientIpFrom(req));
                const fp = clientFpFrom(req);
                if (fp) void recordClientFingerprint(name, fp);

                // Mint a session token so subsequent requests use the cheap HMAC path
                // instead of re-running scrypt on every call. null → SESSION_SECRET
                // unset, client falls back to the password path transparently.
                return res.status(200).json({
                    ok: true,
                    token: (await issuePlayerTokenForRecord(name, current)) ?? undefined,
                    name,
                });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth verify commit]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'change') {
        // Change password — normally requires the current password, and always
        // serializes all credential mutations for this account.
        //
        // A passwordless account (Google sign-in or guest) has no current
        // password to prove, so for those the proof of ownership is a valid
        // session token for this same name: the caller is already inside the
        // account. That turns `change` into "set your first password", which is
        // how a Google player gains a password fallback.
        const suppliedToken = headerValue(req, 'x-player-token');
        const tokenOwner = suppliedToken ? await verifyPlayerToken(suppliedToken) : null;
        const tokenProvesOwnership = !!tokenOwner && tokenOwner === safeName(name);

        if (typeof newPassword !== 'string' || !newPassword) {
            return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
        }
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
        // Shape-check a supplied oldPassword up front, before any storage read,
        // exactly as this action always has: an oversized input is rejected
        // without spending a lookup, and the response cannot be used to probe
        // whether the account exists. Whether an oldPassword is *required* is
        // decided inside the lock, once we know if the record has a password.
        if (typeof oldPassword === 'string' && oldPassword) {
            const oldPasswordError = playerPasswordVerificationError(oldPassword);
            if (oldPasswordError) return res.status(400).json({ ok: false, error: oldPasswordError });
            if (safeStringEqual(oldPassword, newPassword)) {
                return res.status(400).json({ ok: false, error: 'New password must differ from the current password.' });
            }
        }
        let failedGuestCredentialRecord: AuthRecord | null = null;
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                if (!record) {
                    const saveBlob = await kv.get<Record<string, unknown>>(`save:${safeName(name)}`);
                    if (saveBlob) {
                        return res.status(409).json({
                            ok: false,
                            error: 'This legacy account requires authenticated admin recovery.',
                            legacyNeedsAdmin: true,
                        });
                    }
                    // Same answer as a wrong password: a distinct 404 here told
                    // anyone which names have no account behind them.
                    return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
                }

                if (isPasswordlessRecord(record)) {
                    // Setting a first password on a Google or guest account. The
                    // session token is the proof of ownership, since there is no
                    // old password to prove. Re-check the ban here: `verify`
                    // gates on it, and this branch is the one other way to walk
                    // out with a freshly minted token.
                    if (!tokenProvesOwnership || await verifyPlayerToken(suppliedToken) !== safeName(name)) {
                        return res.status(401).json({ ok: false, error: 'Sign in again before setting a password.' });
                    }
                    if (isCredentialLessGuest(record)) failedGuestCredentialRecord = record;
                    const ban = await getActiveBan(name);
                    if (ban) {
                        return res.status(403).json({
                            ok: false,
                            error: 'Account is banned.',
                            ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                        });
                    }
                } else {
                    if (typeof oldPassword !== 'string' || !oldPassword) {
                        return res.status(400).json({ ok: false, error: 'Missing oldPassword or newPassword.' });
                    }
                    if (!(await verifyAgainst(record, oldPassword))) {
                        return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
                    }
                }

                const salt = newSalt();
                const newHash = await hashScrypt(newPassword, salt);
                // Rotate first: if the following hash write fails, old tokens
                // are still revoked (safe failure) and the caller can retry.
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                // Spread the existing record: a password change must not drop the
                // linked Google identity or the guest flag that lives beside it.
                try {
                    await kv.set(key, { ...withoutGuestResumeAuthority(record), hash: newHash, salt, sessionEpoch });
                } catch (err) {
                    const committed = await kv.get<AuthRecord>(key);
                    // A failed first-password claim must not strand the guest's
                    // only resume credential. Old session tokens stay revoked.
                    if (isCredentialLessGuest(record) && committed
                        && JSON.stringify(committed) === JSON.stringify(record)) {
                        await synchronizeVerifiedAuthRecordEpoch(name, committed);
                    }
                    throw err;
                }

                // Gaining a password means gaining something you can forget, so
                // this is the moment to hand over the way back — most of all for
                // the guest claiming their character, whose resume key stops
                // working the instant this write lands.
                //
                // Only when the account has no code yet. A player rotating a
                // password they already had keeps the code they already wrote
                // down: silently invalidating it would turn a routine password
                // change into a lockout for anyone who did not read the response.
                let freshRecoveryCode: string | undefined;
                try {
                    if (!(await readRecoveryCode(name))) freshRecoveryCode = await issueRecoveryCode(name);
                } catch (err) {
                    // Best effort. The password change itself has committed, and
                    // the player can mint a code from their profile at any time;
                    // failing the whole request here would be the worse outcome.
                    console.error('[player-auth change recovery-code]', String(err));
                }

                return res.status(200).json({
                    ok: true,
                    token: issuePlayerToken(name, undefined, sessionEpoch) ?? undefined,
                    ...(freshRecoveryCode ? { recoveryCode: freshRecoveryCode } : {}),
                });
            }, { failClosed: true });
        } catch (err) {
            // A guarded write can poison the current lock context. In that case
            // even the compensating read above is rejected. After the context
            // ends, use a fresh fenced lock to repair only the unchanged guest
            // row's epoch. The failed password write still revokes old tokens.
            if (failedGuestCredentialRecord) {
                try {
                    await withoutKvLeaseContext(() => withKvLock(key, async () => {
                        const current = await kv.get<AuthRecord>(key);
                        if (current && isCredentialLessGuest(current)
                            && JSON.stringify(current) === JSON.stringify(failedGuestCredentialRecord)) {
                            const currentEpoch = await readPlayerSessionEpoch(name);
                            await kv.set(key, {
                                ...current,
                                sessionEpoch: currentEpoch,
                                ...(current.guestResumeHash === undefined && current.guestResumeExpiresAt === undefined
                                    ? { legacyGuestResumeEpoch: currentEpoch }
                                    : {}),
                            });
                        }
                    }, { failClosed: true }));
                } catch (repairError) {
                    console.error('[player-auth change guest-repair]', String(repairError));
                }
            }
            console.error('[player-auth change]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // ─── Self-serve recovery ──────────────────────────────────────────────────
    //
    // Mint the code you will need if you forget your password. Requires proof
    // that you are already inside the account, so this is never a way to obtain
    // a credential for somebody else's shinobi — it is the authenticated act of
    // writing down a spare key.
    //
    // Deliberately does NOT rotate the session epoch, even though it mints a
    // credential. The rule that credential mutations rotate exists so a reset
    // cannot leave a stale session alive; nothing is being reset or revoked
    // here, and rotating would sign the player out of their other devices as
    // the punishment for taking a safety measure. The epoch rotation lands on
    // `recover` below, which is the half that actually changes the password.
    //
    // A PASSWORD account must type its password here even when it holds a valid
    // token. The code is a full credential — `recover` turns it into a new
    // password and a fresh session — so a token alone (lifted from a shared
    // computer's storage, say) used to be enough to mint one, redeem it, and
    // lock the real owner out for good. Passwordless accounts (Google, guest)
    // have nothing else to prove with, so for them the token still suffices.
    if (action === 'recovery-issue') {
        const suppliedToken = headerValue(req, 'x-player-token');
        const tokenOwner = suppliedToken ? await verifyPlayerToken(suppliedToken) : null;
        const tokenProvesOwnership = !!tokenOwner && tokenOwner === safeName(name);
        const suppliedPassword = typeof password === 'string' && password ? password : '';

        if (suppliedPassword && playerPasswordVerificationError(suppliedPassword)) {
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        }
        if (!tokenProvesOwnership && !suppliedPassword) {
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        }
        try {
            // Under the account lock, like every other credential mutation on
            // this endpoint. Two concurrent issues would otherwise both report
            // success while only the last write survived — and the player may
            // well have written down the one that lost. It also orders this
            // against `change`, which mints a code of its own when the account
            // has none.
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                const passwordRequired = !tokenProvesOwnership || (!!record && !isPasswordlessRecord(record));
                if (passwordRequired) {
                    if (!suppliedPassword) {
                        // Only reachable with a valid token for this very account,
                        // so naming what is missing leaks nothing.
                        return res.status(401).json({ ok: false, error: 'Enter your current password to generate a code.', passwordRequired: true });
                    }
                    // Burn the same scrypt work whether or not the account
                    // exists, exactly as `verify` does, so this cannot be used
                    // to probe for names — then answer with one message for
                    // every failure.
                    const matched = await verifyAgainst(record ?? DUMMY_AUTH_RECORD, suppliedPassword);
                    if (!record || !matched) {
                        return res.status(401).json({ ok: false, error: 'Authentication required.' });
                    }
                }
                if (!record) return res.status(401).json({ ok: false, error: 'Authentication required.' });

                const code = await issueRecoveryCode(name);
                return res.status(200).json({ ok: true, recoveryCode: code });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth recovery-issue]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // Redeem a recovery code for a new password. The one unauthenticated path
    // that can set a credential, so every answer it gives is deliberate:
    //
    //  - **One failure message, status 200**, for a name that does not exist, a
    //    name with no code, and a wrong code alike. `verify` answers 200 for a
    //    passwordless account for the same reason — a recovery form that says
    //    "no such shinobi" is an account-enumeration oracle aimed at the
    //    leaderboard, which is a public list of every name worth trying.
    //  - **No per-account attempt lockout.** The obvious hardening is wrong
    //    here: the code carries ~100 bits of entropy, so guessing is hopeless
    //    with or without one, while a name-keyed counter would let anyone lock
    //    a specific player out of their own recovery by spending ten requests
    //    on it. The IP budget above is the bound that costs no victim anything.
    //  - **Single use.** The code is consumed inside the lock and a fresh one
    //    is minted in the same breath, so a player is never left mid-recovery
    //    holding nothing.
    if (action === 'recover') {
        const RECOVERY_FAILED = 'That recovery code is not valid for this shinobi.';

        // Shape errors first, and only ones that depend on the caller's own
        // input rather than on any stored state — those answer identically for
        // every name and so cannot be used to probe.
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
        const normalizedCode = normalizeRecoveryCode(recoveryCode);
        if (!normalizedCode) return res.status(200).json({ ok: false, error: RECOVERY_FAILED });

        try {
            return await withKvLock(key, async () => {
                const [record, stored] = await Promise.all([
                    kv.get<AuthRecord>(key),
                    readRecoveryCode(name),
                ]);
                if (!recoveryCodeMatches(stored, normalizedCode)) {
                    return res.status(200).json({ ok: false, error: RECOVERY_FAILED });
                }
                if (!record) {
                    // A recovery row that outlived its account. It can never
                    // authenticate anything, so drop it rather than leave it to
                    // be inherited by the next holder of this slug.
                    await clearRecoveryCode(name);
                    return res.status(200).json({ ok: false, error: RECOVERY_FAILED });
                }

                // Gate on the ban here too. This branch walks out with a fresh
                // token, so leaving it ungated would make recovery the way
                // around the check `verify` performs.
                const ban = await getActiveBan(name);
                if (ban) {
                    return res.status(403).json({
                        ok: false,
                        error: 'Account is banned.',
                        ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                    });
                }

                // Rotate first, for the reason `change` gives: if the write
                // below fails, every previously issued token is already dead —
                // which is the safe direction for a path whose whole premise is
                // that the account may be in the wrong hands.
                const salt = newSalt();
                const newHash = await hashScrypt(newPassword as string, salt);
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                // Spread, so recovering a password neither unlinks Google nor
                // disturbs anything else living on the record.
                await kv.set(key, { ...withoutGuestResumeAuthority(record), hash: newHash, salt, sessionEpoch });

                let nextCode: string | undefined;
                try {
                    nextCode = await issueRecoveryCode(name);
                } catch (err) {
                    // The password is already changed and the old code is about
                    // to be gone, so report success and let the player mint a
                    // replacement from their profile.
                    console.error('[player-auth recover reissue]', String(err));
                    await clearRecoveryCode(name);
                }

                void recordClientIp(name, clientIpFrom(req));
                const recoverFp = clientFpFrom(req);
                if (recoverFp) void recordClientFingerprint(name, recoverFp);

                return res.status(200).json({
                    ok: true,
                    token: issuePlayerToken(name, undefined, sessionEpoch) ?? undefined,
                    ...(nextCode ? { recoveryCode: nextCode } : {}),
                });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth recover]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'delete') {
        // Delete the auth record when a player deletes their character.
        // Must supply either valid player password or admin authority (token or
        // password).
        if (isFullAdmin(req)) {
            try {
                await withKvLock(key, async () => {
                    const existing = await kv.get<AuthRecord>(key);
                    await rotatePlayerSessionEpoch(name);
                    await kv.del(key);
                    // Release the Google link too, or the sub stays pointed at a
                    // deleted slug and that person can never sign in again.
                    if (existing?.google?.sub) await releaseGoogleIdentityForAccount(name, existing.google.sub);
                    // And the recovery code, or it becomes a credential to
                    // whoever registers this name next.
                    await clearRecoveryCode(name);
                }, { failClosed: true });
            } catch (err) {
                console.error('[player-auth delete]', String(err));
                return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
            }
            return res.status(200).json({ ok: true });
        }
        // A passwordless account (Google or guest) proves ownership with its
        // session token instead — otherwise those players could never delete
        // their own character, since there is no password to supply.
        const deleteToken = headerValue(req, 'x-player-token');
        const deleteTokenOwner = deleteToken ? await verifyPlayerToken(deleteToken) : null;
        const deleteTokenProvesOwnership = !!deleteTokenOwner && deleteTokenOwner === safeName(name);

        if (!deleteTokenProvesOwnership) {
            if (typeof password !== 'string' || !password) {
                return res.status(401).json({ ok: false, error: 'Authentication required.' });
            }
            const verificationError = playerPasswordVerificationError(password);
            if (verificationError) return res.status(400).json({ ok: false, error: verificationError });
        }
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                if (!record) {
                    // Burn the same work as a real wrong password and answer the
                    // same way, so this cannot sort taken names from free ones.
                    if (!deleteTokenProvesOwnership) await verifyAgainst(DUMMY_AUTH_RECORD, password as string);
                    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
                }
                if (deleteTokenProvesOwnership && await verifyPlayerToken(deleteToken) !== safeName(name)) {
                    return res.status(401).json({ ok: false, error: 'Authentication required.' });
                }
                if (!deleteTokenProvesOwnership && !(await verifyAgainst(record, password as string))) {
                    return res.status(401).json({ ok: false, error: 'Incorrect password.' });
                }
                // The old auth-only route must not bypass the waiting period or
                // strand a live save. Missing-save signup recovery remains supported.
                if (await kv.get(`save:${safeName(name)}`)
                    || (record.deletionRequestedAt !== undefined && !accountDeletionStatus(record).ready)) {
                    return res.status(409).json({ ok: false, error: 'Use Settings to request deletion, wait 24 hours, then delete the save first.' });
                }
                await rotatePlayerSessionEpoch(name);
                await kv.del(key);
                if (record.google?.sub) await releaseGoogleIdentityForAccount(name, record.google.sub);
                await clearRecoveryCode(name);
                return res.status(200).json({ ok: true });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth delete]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // Operator-assisted recovery, and the one that should be reached for first.
    //
    // Mints a recovery code for a player and hands it to the ADMIN to relay —
    // over Discord, or however they verified the person in the first place. The
    // player then redeems it through `recover` and chooses their own password.
    //
    // This exists to keep an operator out of the credential. With `adminreset`
    // below, the admin picks the password, which means they know a working
    // credential for somebody else's shinobi, and it stays working until the
    // player thinks to change it — and in practice the password travels through
    // a chat log to reach them. Here the admin only ever holds a single-use
    // code, and the password that ends up on the account is one they never see.
    //
    // It is NOT a new privilege. A full admin could already take an account with
    // `adminreset`, so this adds no power — it removes the reason to use the
    // blunter tool for the ordinary "I forgot my password" request.
    //
    // Rotating the session epoch here is deliberate, and the opposite of the
    // choice `recovery-issue` makes. There the caller is the account's own owner
    // taking a safety measure, and signing them out of their other devices would
    // be a punishment for it. Here somebody ELSE is minting a credential onto
    // the account, which is exactly the case the "credential mutations rotate"
    // rule exists for: every token issued before this moment stops working, so
    // an operator's action cannot be ridden by a session already in flight.
    //
    // The password is left alone on purpose. Clearing it would lock out an
    // attacker who knows it, but it would also strand the player if the code
    // never reaches them, and on a guest-flagged record it would re-open both
    // doors this change just closed — the resume key and the 14-day sweep both
    // key on "credential-less guest". An account that is actively compromised is
    // what `adminreset` is still for.
    if (action === 'admin-recovery') {
        if (!isFullAdmin(req)) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                if (!record) {
                    return res.status(404).json({ ok: false, error: 'Account does not exist.' });
                }
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                // Persist the rotated epoch onto the record, so a later token
                // mint for this account does not read as stale — the same
                // pairing every other rotation on this endpoint performs.
                await kv.set(key, { ...record, sessionEpoch });
                const code = await issueRecoveryCode(name);
                return res.status(200).json({ ok: true, name: safeName(name), recoveryCode: code });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth admin-recovery]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    if (action === 'adminreset') {
        // Admin sets a player's password outright. Prefer `admin-recovery` above
        // for an ordinary "I forgot my password" request — it hands the player a
        // code and lets them choose a password the operator never sees. This one
        // is the blunt instrument, and it is the right tool for a COMPROMISED
        // account, where the point is to make the attacker's known password stop
        // working this second rather than whenever the player gets round to it.
        // Full-admin gate — accepts the admin session token or the password.
        if (!isFullAdmin(req)) {
            return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
        }
        if (!newPassword) return res.status(400).json({ ok: false, error: 'Missing newPassword.' });
        const passwordPolicyError = playerPasswordPolicyError(newPassword);
        if (passwordPolicyError) return res.status(400).json({ ok: false, error: passwordPolicyError });
        // A Google link survives password changes and resets by design, so an
        // attacker who linked THEIR Google account to a stolen session keeps a
        // door in after this reset. `dropGoogle` closes it: the operator ticks it
        // for a compromised account, and the player re-links their own Google
        // once they are back in.
        const dropGoogle = (body as { dropGoogle?: unknown }).dropGoogle === true;
        try {
            const salt = newSalt();
            const newHash = await hashScrypt(newPassword, salt);
            await withKvLock(key, async () => {
                const existing = await kv.get<AuthRecord>(key);
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                // Spread the existing record so an admin reset restores password
                // access without silently unlinking Google or clearing the guest flag.
                const next: AuthRecord = { ...withoutGuestResumeAuthority(existing ?? {}), hash: newHash, salt, sessionEpoch };
                const droppedSub = dropGoogle ? existing?.google?.sub : undefined;
                if (droppedSub) delete next.google;
                await kv.set(key, next);
                if (droppedSub) await releaseGoogleIdentityForAccount(name, droppedSub);
                // Drop any recovery code. An admin reset is what a player asks
                // for when they have lost control of the account, so the
                // outstanding spare key is exactly the thing to invalidate —
                // the player mints a fresh one from their profile once they are
                // back in. Never returned to the admin: it is the player's
                // credential, and an admin who wants in already has this action.
                await clearRecoveryCode(name);
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth adminreset]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
        return res.status(200).json({ ok: true });
    }

    // Sign out every OTHER device. Rotating the epoch kills every outstanding
    // token — the sliding refresh would otherwise keep a copied token alive for
    // as long as someone kept using it — and this device is handed a fresh one,
    // so the player who pressed the button stays signed in.
    if (action === 'logout-others') {
        if (!playerSessionsEnabled()) {
            return res.status(409).json({ ok: false, error: 'Other devices sign in with your password; change it to sign them out.' });
        }
        const suppliedToken = headerValue(req, 'x-player-token');
        const tokenOwner = suppliedToken ? await verifyPlayerToken(suppliedToken) : null;
        if (!tokenOwner || tokenOwner !== safeName(name)) {
            return res.status(401).json({ ok: false, error: 'Authentication required.' });
        }
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                // Re-check under the lock: a credential change may have rotated
                // the epoch while this request waited.
                if (!record || await verifyPlayerToken(suppliedToken) !== safeName(name)) {
                    return res.status(401).json({ ok: false, error: 'Authentication required.' });
                }
                const ban = await getActiveBan(name);
                if (ban) {
                    return res.status(403).json({
                        ok: false,
                        error: 'Account is banned.',
                        ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                    });
                }
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                await kv.set(key, { ...record, sessionEpoch });
                return res.status(200).json({ ok: true, token: issuePlayerToken(name, undefined, sessionEpoch) ?? undefined });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth logout-others]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    // Detach Google from a password account. Requires the current password —
    // never a token alone — for the same reason linking does: a Google link is a
    // door that survives password changes, so only the person who can prove the
    // password may open or close it. An account whose ONLY way in is Google is
    // refused, since unlinking would leave it with no credential at all.
    if (action === 'google-unlink') {
        const suppliedPassword = typeof password === 'string' && password ? password : '';
        if (!suppliedPassword || playerPasswordVerificationError(suppliedPassword)) {
            return res.status(401).json({ ok: false, error: 'Enter your current password to unlink Google.' });
        }
        try {
            return await withKvLock(key, async () => {
                const record = await kv.get<AuthRecord>(key);
                const matched = await verifyAgainst(record ?? DUMMY_AUTH_RECORD, suppliedPassword);
                if (!record || !matched) {
                    if (record && isPasswordlessRecord(record) && record.google) {
                        return res.status(409).json({ ok: false, error: 'Google is your only way to sign in. Set a password before unlinking it.' });
                    }
                    return res.status(401).json({ ok: false, error: 'Incorrect current password.' });
                }
                const sub = record.google?.sub;
                if (!sub) return res.status(409).json({ ok: false, error: 'No Google account is linked.' });
                // This walks out with a fresh token, so it is gated like `verify`.
                const ban = await getActiveBan(name);
                if (ban) {
                    return res.status(403).json({
                        ok: false,
                        error: 'Account is banned.',
                        ban: { until: ban.until, reason: ban.reason, permanent: ban.permanent ?? false },
                    });
                }
                // Credential mutation: rotate, as `change` does, so a session
                // that rode in through the Google link ends with it.
                const sessionEpoch = await rotatePlayerSessionEpoch(name);
                const next: AuthRecord = { ...record, sessionEpoch };
                delete next.google;
                await kv.set(key, next);
                await releaseGoogleIdentityForAccount(name, sub);
                return res.status(200).json({ ok: true, token: issuePlayerToken(name, undefined, sessionEpoch) ?? undefined });
            }, { failClosed: true });
        } catch (err) {
            console.error('[player-auth google-unlink]', String(err));
            return res.status(503).json({ ok: false, error: 'Storage unavailable. Try again.' });
        }
    }

    return res.status(400).json({ ok: false, error: 'Unknown action.' });
}
