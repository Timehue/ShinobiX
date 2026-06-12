import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';

// ─── Generalized admin/game action audit log ──────────────────────────────────
//
// Generalizes the proven moderation audit pattern (api/admin/moderation.ts:
// `mod:audit`, a capped append-only list under a lock) to other domains that
// previously had NO audit trail: content edits (jutsu/item/image/bloodline),
// reward grants/corrections, and sector/territory changes.
//
// One capped list per domain, newest-first:
//   audit:content   audit:reward   audit:sector   audit:combat
//
// Every write is best-effort and lock-serialized so concurrent admin actions
// can't clobber each other's entries. `before`/`after` are COMPACT SUMMARIES
// (changed fields only) — never whole entities — so the list stays small and
// never leaks base64 image blobs into the log.

export type AuditDomain = 'content' | 'reward' | 'sector' | 'combat';

export interface AuditEntry {
    ts: number;
    actor: string;            // admin/player slug, or 'admin' for password auth
    domain: AuditDomain;
    action: string;           // e.g. 'jutsu.edit', 'image.delete', 'reward.grant'
    entityType?: string;      // e.g. 'jutsu', 'item', 'image', 'bloodline'
    entityId?: string;
    before?: unknown;         // compact summary, truncated
    after?: unknown;          // compact summary, truncated
    reason?: string;
    meta?: Record<string, unknown>;
}

const AUDIT_PREFIX = 'audit:';
// Matches the moderation log's retention — months of activity at typical
// volumes, well under the KV value-size ceiling.
export const MAX_AUDIT_ENTRIES = 5000;
// Cap the serialized size of a single before/after summary so a careless caller
// (or a hand-edited blob) can't bloat the log with a megabyte of JSON.
export const MAX_SUMMARY_LEN = 2000;

export function auditKey(domain: AuditDomain): string { return `${AUDIT_PREFIX}${domain}`; }

// Pure: clamp a before/after summary to a safe serialized size. Strings are
// truncated directly; objects are JSON-checked and replaced with a marker if
// they exceed the cap (so the rest of the entry still records cleanly).
export function clampAuditValue(v: unknown, maxLen: number = MAX_SUMMARY_LEN): unknown {
    if (v === undefined || v === null) return v;
    if (typeof v === 'string') {
        return v.length <= maxLen ? v : v.slice(0, maxLen) + '…[truncated]';
    }
    try {
        const s = JSON.stringify(v);
        if (s === undefined) return '[unserializable]';
        if (s.length <= maxLen) return v;
        return s.slice(0, maxLen) + '…[truncated]';
    } catch {
        return '[unserializable]';
    }
}

// Pure: prepend the newest entry and cap the list to `max` (newest-first).
export function appendCapped(existing: AuditEntry[], entry: AuditEntry, max: number = MAX_AUDIT_ENTRIES): AuditEntry[] {
    const list = Array.isArray(existing) ? existing : [];
    return [entry, ...list].slice(0, max);
}

// Record an audit entry. Best-effort: never throws into the calling handler, so
// a logging hiccup can never fail a real admin action.
export async function recordAudit(entry: Omit<AuditEntry, 'ts'> & { ts?: number }): Promise<void> {
    try {
        const full: AuditEntry = {
            ...entry,
            ts: entry.ts ?? Date.now(),
            before: clampAuditValue(entry.before),
            after: clampAuditValue(entry.after),
        };
        const key = auditKey(entry.domain);
        await withKvLock(key, async () => {
            const existing = (await kv.get<AuditEntry[]>(key)) ?? [];
            await kv.set(key, appendCapped(existing, full));
        });
    } catch {
        // best-effort
    }
}

export async function readAudit(domain: AuditDomain, limit: number = 200): Promise<AuditEntry[]> {
    try {
        const existing = (await kv.get<AuditEntry[]>(auditKey(domain))) ?? [];
        const n = Math.max(1, Math.min(Math.floor(limit) || 0, MAX_AUDIT_ENTRIES));
        return existing.slice(0, n);
    } catch {
        return [];
    }
}
