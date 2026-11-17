import type { AdminRole } from './_auth.js';
import { recordAudit } from './_audit.js';
import { allow } from './_ratelimit.js';

// ─── Audit records for the most powerful admin actions ───────────────────────
//
// Moderation and content edits already leave a trail (api/_audit.ts). These
// three did not: a raw admin save overwrite (`POST /api/save/<name>?signal=1`),
// a full server reset, and admin logins. Everything here is LOGGING ONLY: no
// caller may branch on the result, and every write is best-effort through
// recordAudit, which never throws.
//
// Never pass a password, token or raw header value into these helpers. The
// save diff below redacts any field whose name looks like a credential, and it
// records only short scalar values, so a base64 image or a whole sub-object
// shows up as its size, never its contents.

export type AdminCredentialVia = 'token' | 'password';

export function adminActorLabel(role: AdminRole | null | undefined): string {
    return role ? `admin:${role}` : 'admin:unknown';
}

// ─── Compact save diff ───────────────────────────────────────────────────────

/** Bookkeeping fields that change on every write and say nothing. */
const SKIP_FIELDS = new Set(['_saveVersion', '_saveAt', '_regenAt', '_baseSaveVersion']);
/** Field names whose values are never recorded, only the fact that they changed. */
const SECRET_FIELD_RE = /pass(?:word)?|token|secret|hash|salt|session|recovery|api_?key/i;
export const MAX_DIFF_FIELDS = 30;
const MAX_INLINE_STRING = 60;
/** Objects expanded one level into `<field>.<key>` paths. */
const EXPANDED_FIELDS = new Set(['character']);

export type SaveFieldDiff = {
    /** Changed field paths, sorted, at most MAX_DIFF_FIELDS. */
    changed: string[];
    /** Total number of changed paths, including any past the cap. */
    changedCount: number;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return Number.isNaN(a) && Number.isNaN(b);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        const bb = b as unknown[];
        return a.length === bb.length && a.every((item, i) => deepEqual(item, bb[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
    return true;
}

/** A short, safe stand-in for one value in the diff. */
export function auditValueSummary(field: string, v: unknown): unknown {
    if (SECRET_FIELD_RE.test(field)) return '[redacted]';
    if (v === undefined) return '[absent]';
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') {
        return v.length <= MAX_INLINE_STRING && !v.startsWith('data:') ? v : `[string ${v.length}]`;
    }
    if (Array.isArray(v)) return `[array ${v.length}]`;
    if (isPlainObject(v)) return `[object ${Object.keys(v).length} keys]`;
    return `[${typeof v}]`;
}

/**
 * Which fields an overwrite changed, top level plus one level into
 * `character`, with a short summary of each side. Pure.
 */
export function compactSaveDiff(before: unknown, after: unknown): SaveFieldDiff {
    const prev = isPlainObject(before) ? before : {};
    const next = isPlainObject(after) ? after : {};
    const paths: Array<{ path: string; leaf: string; from: unknown; to: unknown }> = [];
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of keys) {
        if (SKIP_FIELDS.has(key)) continue;
        const from = prev[key];
        const to = next[key];
        if (deepEqual(from, to)) continue;
        if (EXPANDED_FIELDS.has(key) && isPlainObject(from) && isPlainObject(to)) {
            const inner = new Set([...Object.keys(from), ...Object.keys(to)]);
            for (const k of inner) {
                if (!deepEqual(from[k], to[k])) paths.push({ path: `${key}.${k}`, leaf: k, from: from[k], to: to[k] });
            }
            continue;
        }
        paths.push({ path: key, leaf: key, from, to });
    }
    paths.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const kept = paths.slice(0, MAX_DIFF_FIELDS);
    const diff: SaveFieldDiff = { changed: kept.map((p) => p.path), changedCount: paths.length, before: {}, after: {} };
    for (const p of kept) {
        diff.before[p.path] = auditValueSummary(p.leaf, p.from);
        diff.after[p.path] = auditValueSummary(p.leaf, p.to);
    }
    return diff;
}

/** Record one admin save overwrite (`?signal=1`) after it committed. */
export function recordAdminSaveOverwrite(input: {
    role: AdminRole | null;
    via: AdminCredentialVia | null;
    target: string;
    kind: 'player' | 'clan' | 'content-slot';
    existing: unknown;
    written: unknown;
}): Promise<boolean> {
    const diff = compactSaveDiff(input.existing, input.written);
    const versionOf = (v: unknown) => (isPlainObject(v) && Number.isFinite(Number(v._saveVersion)) ? Number(v._saveVersion) : null);
    return recordAudit({
        domain: 'admin',
        actor: adminActorLabel(input.role),
        action: 'save.overwrite',
        entityType: input.kind,
        entityId: input.target,
        before: diff.before,
        after: diff.after,
        meta: {
            role: input.role,
            via: input.via,
            created: input.existing === null || input.existing === undefined,
            fromVersion: versionOf(input.existing),
            toVersion: versionOf(input.written),
            changedFields: diff.changed,
            changedCount: diff.changedCount,
        },
    });
}

// ─── Admin login outcomes ────────────────────────────────────────────────────

/**
 * Failure records are throttled process-wide. Each IP is already held to a
 * handful of wrong guesses per window by the auth budgets, but a caller with
 * many addresses could otherwise turn guessing into a stream of audit-row
 * rewrites. Past the throttle a failure is simply not recorded; the auth
 * decision is unaffected either way.
 */
export const AUTH_FAILURE_AUDIT_LIMIT = 30;
const AUTH_FAILURE_AUDIT_WINDOW_MS = 60_000;

export type AdminAuthAuditInput = {
    outcome: 'success' | 'failure';
    /** `admin-auth`: the login form. `password-header`: an `x-admin-password` header on any route. */
    source: 'admin-auth' | 'password-header';
    role?: AdminRole | null;
    ip?: string | null;
    /** True when this failure spent the address's last allowed guess. */
    lockedOut?: boolean;
};

// Auth records are written one at a time, in order. A burst of wrong headers
// fires these without waiting, and parallel writers would contend for the one
// `audit:auth` lock until recordAudit gave up and dropped them. Railway runs a
// single replica, so an in-process queue is enough.
let authAuditQueue: Promise<unknown> = Promise.resolve();

/** Test hook: resolves once every queued auth record has been written. */
export function flushAdminAuthAudit(): Promise<void> {
    return authAuditQueue.then(() => undefined);
}

export function recordAdminAuthAudit(input: AdminAuthAuditInput): Promise<boolean> {
    if (input.outcome === 'failure'
        && !allow('audit-admin-auth-failure', AUTH_FAILURE_AUDIT_LIMIT, AUTH_FAILURE_AUDIT_WINDOW_MS).ok) {
        return Promise.resolve(false);
    }
    const write = authAuditQueue.then(() => writeAdminAuthAudit(input));
    authAuditQueue = write;
    return write;
}

function writeAdminAuthAudit(input: AdminAuthAuditInput): Promise<boolean> {
    const success = input.outcome === 'success';
    return recordAudit({
        domain: 'auth',
        actor: success ? adminActorLabel(input.role) : 'unknown',
        action: success ? 'admin.login' : (input.source === 'admin-auth' ? 'admin.login-failed' : 'admin.password-rejected'),
        entityType: 'admin-session',
        meta: {
            source: input.source,
            ip: input.ip ?? null,
            ...(success ? { role: input.role ?? null } : {}),
            ...(input.lockedOut ? { lockedOut: true } : {}),
        },
    });
}
