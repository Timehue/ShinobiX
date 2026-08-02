/*
 * Canonical store for admin-authored shared game content (P0-4).
 *
 * ── The problem this replaces ───────────────────────────────────────────────
 * Global content (authored jutsu, items, AIs, events, missions, raids, cards,
 * pet kits, VN + gate configs) has always lived inside the `save:admin1` /
 * `save:admin2` PLAYER saves. Phase 0 found the publish path unguarded:
 * `POST /api/save/<slot>?signal=1` takes NO lock and performs NO version
 * check, so two admin tabs race and a stale tab silently reverts newer
 * content (docs/audits/shared-content-audit.md, finding 4 — the High one).
 *
 * ── The shape of the fix ────────────────────────────────────────────────────
 * Content gets its own keys — `content:<field>` — written ONLY through a
 * locked, version-guarded publish (`publishContent`). Nothing is migrated:
 *   • both publish paths (the new /api/admin/content-publish endpoint and the
 *     legacy ?signal=1 save) write the canonical record AND keep mirroring the
 *     admin slot, so every existing reader — server catalogs and every live
 *     client — keeps working untouched;
 *   • server catalogs DUAL-READ: the canonical record joins the existing merge
 *     as one more source, ordered LAST. While nothing has been published the
 *     store is empty and every catalog resolves byte-identically to before.
 *
 * The eventual cutover (stop writing slots, point the client at this store) is
 * deliberately NOT part of P0-4 — see docs/runbooks/shared-content-cutover.md.
 */
import type { KvLike } from './_storage.js';
import { safeLogValue } from './_safe-log.js';
import { SHARED_ADMIN_CONTENT_FIELDS } from './save/_state-ownership.js';

type ContentKv = Pick<KvLike, 'get' | 'set'>;

async function getDefaultKv(): Promise<ContentKv> {
    return (await import('./_storage.js')).kv;
}

/** The publishable fields — the same set the admin slots carry today. */
export const CONTENT_FIELDS: readonly string[] = SHARED_ADMIN_CONTENT_FIELDS;

export const CONTENT_KEY_PREFIX = 'content:';
export const CONTENT_CACHE_TTL_MS = 60_000;
/** Defensive ceiling on one field's entry count (authored catalogs are small). */
export const CONTENT_MAX_ENTRIES = 5_000;

export function contentKey(field: string): string {
    return `${CONTENT_KEY_PREFIX}${field}`;
}

export function isContentField(field: string): boolean {
    return CONTENT_FIELDS.includes(field);
}

export type ContentRecord = {
    field: string;
    /** Monotonic publish counter — the optimistic-concurrency token. */
    version: number;
    updatedAt: number;
    updatedBy: string;
    /** Array fields carry a list; VN / gate-config fields carry one object. */
    value: unknown;
};

export function nextContentVersion(current: unknown): number {
    const n = Number(current);
    return (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0) + 1;
}

/**
 * Normalize a published value. Deliberately structural only — authored content
 * is owner-authored and must NOT be rebalanced or clamped here (the same ruling
 * that keeps admin items out of budgetItemBonuses, see api/pvp/_multipliers.ts).
 * Entries must be objects; entries without a usable id are dropped, because an
 * id-less entry can never be resolved by any consumer anyway.
 */
export function normalizeContentValue(field: string, value: unknown): unknown {
    if (!Array.isArray(value)) return value ?? null;
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const entry = raw as Record<string, unknown>;
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        if (!id || id.length > 120 || seen.has(id)) continue;
        seen.add(id);
        out.push({ ...entry, id });
        if (out.length >= CONTENT_MAX_ENTRIES) break;
    }
    return out;
}

/** Thrown when a publish loses the optimistic-concurrency check. */
export class ContentVersionConflictError extends Error {
    constructor(readonly field: string, readonly storedVersion: number, readonly baseVersion: number) {
        super(`content:${field} changed since version ${baseVersion} (now ${storedVersion})`);
        this.name = 'ContentVersionConflictError';
    }
}

/**
 * Publish one content field. MUST be called inside withKvLock(contentKey(field))
 * by the caller (the endpoint owns the lock so it can also mirror the admin slot
 * inside the same critical section).
 *
 * `baseVersion` is the version the editor loaded. Omitting it is allowed for
 * first-write / scripted publishes; supplying a stale one throws
 * ContentVersionConflictError instead of silently reverting a newer edit — the
 * exact failure mode the unguarded ?signal=1 path allowed.
 */
export async function publishContent(
    field: string,
    value: unknown,
    opts: { actor: string; baseVersion?: number; kv?: ContentKv },
): Promise<ContentRecord> {
    if (!isContentField(field)) throw new Error(`not a publishable content field: ${field}`);
    const store = opts.kv ?? await getDefaultKv();
    const key = contentKey(field);
    const current = await store.get<ContentRecord>(key);
    const storedVersion = Number(current?.version ?? 0);
    if (typeof opts.baseVersion === 'number' && Number.isFinite(opts.baseVersion) && opts.baseVersion < storedVersion) {
        throw new ContentVersionConflictError(field, storedVersion, opts.baseVersion);
    }
    const record: ContentRecord = {
        field,
        version: nextContentVersion(storedVersion),
        updatedAt: Date.now(),
        updatedBy: String(opts.actor || 'unknown').slice(0, 64),
        value: normalizeContentValue(field, value),
    };
    await store.set(key, record);
    return record;
}

/** Read one field's canonical record (null when never published). */
export async function readContentRecord(field: string, opts: { kv?: ContentKv } = {}): Promise<ContentRecord | null> {
    if (!isContentField(field)) return null;
    const store = opts.kv ?? await getDefaultKv();
    return (await store.get<ContentRecord>(contentKey(field))) ?? null;
}

let cache: { at: number; value: Record<string, unknown> } | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

/**
 * All published content as ONE record shaped like an admin slot
 * (`{ creatorJutsus: [...], creatorItems: [...], … }`) so catalog builders can
 * accept it as one more source with zero shape translation. Memoized 60s to
 * match the admin-slot catalogs; a KV failure falls back to the last good read
 * (never throws — a storage hiccup must not take a fight down).
 */
export async function loadPublishedContent(opts: { kv?: ContentKv; force?: boolean } = {}): Promise<Record<string, unknown>> {
    const now = Date.now();
    if (!opts.force && !opts.kv && cache && now - cache.at < CONTENT_CACHE_TTL_MS) return cache.value;
    if (!opts.kv && inflight) return inflight;
    const run = (async () => {
        try {
            const store = opts.kv ?? await getDefaultKv();
            const records = await Promise.all(
                CONTENT_FIELDS.map((field) => store.get<ContentRecord>(contentKey(field)).catch(() => null)),
            );
            const value: Record<string, unknown> = {};
            for (const record of records) {
                if (record && typeof record === 'object' && isContentField(String(record.field)) && record.value != null) {
                    value[String(record.field)] = record.value;
                }
            }
            if (!opts.kv) cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[content-store]', safeLogValue(error));
            return cache?.value ?? {};
        } finally {
            if (!opts.kv) inflight = null;
        }
    })();
    if (!opts.kv) inflight = run;
    return run;
}

/**
 * Mirror an admin slot's content fields into the canonical store.
 *
 * Used by BOTH publish paths so the canonical record can never go stale behind
 * a slot write: the new endpoint calls it with the fields it published, and the
 * legacy ?signal=1 save calls it with whatever content fields that write
 * carried. Best-effort per field — a mirror failure must not fail the write
 * that already committed; the slot remains authoritative until the cutover.
 */
export async function mirrorSlotContent(
    record: Record<string, unknown>,
    opts: { actor: string; kv?: ContentKv },
): Promise<string[]> {
    const mirrored: string[] = [];
    for (const field of CONTENT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
        try {
            // No baseVersion: a mirror follows a commit that already happened,
            // so it must not be rejected by the CAS — it IS the newest state.
            await publishContent(field, record[field], { actor: opts.actor, kv: opts.kv });
            mirrored.push(field);
        } catch (error) {
            console.error('[content-store] mirror failed', safeLogValue(field), safeLogValue(error));
        }
    }
    if (mirrored.length > 0) __resetContentCache();
    return mirrored;
}

/** Test hook / post-write invalidation — drop the 60s memo. */
export function __resetContentCache(): void {
    cache = null;
    inflight = null;
}
