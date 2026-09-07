/*
 * Server-side dual-read catalog for admin-authored AI profiles.
 *
 * The client merges admin1, admin2, then canonical published content by id,
 * with the later source winning. Reproduce that ordering here so a Solo PvE
 * seal resolves the same profile the player selected. Built-in ids remain
 * source-authoritative at the caller; same-id admin entries are cosmetic only.
 */
import { loadAdminContentRecords } from './_admin-content-records.js';
import { safeLogValue } from './_safe-log.js';
const CACHE_TTL_MS = 60_000;
const MAX_AI_PROFILES = 500;

export type AdminAiProfile = Record<string, unknown> & { id: string };
type AdminAiRecord = { creatorAis?: unknown };

export function buildAdminAiCatalog(records: readonly (AdminAiRecord | null | undefined)[]): Map<string, AdminAiProfile> {
    const out = new Map<string, AdminAiProfile>();
    for (const record of records) {
        const list = Array.isArray(record?.creatorAis) ? record.creatorAis : [];
        for (const raw of list.slice(0, MAX_AI_PROFILES)) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            const value = raw as Record<string, unknown>;
            const id = typeof value.id === 'string' ? value.id.trim() : '';
            if (!id || id.length > 120 || !/^[A-Za-z0-9:_-]+$/.test(id)) continue;
            out.set(id, { ...value, id });
        }
    }
    return out;
}

let cache: { at: number; value: Map<string, AdminAiProfile> } | null = null;
let inflight: Promise<Map<string, AdminAiProfile>> | null = null;

export async function loadAdminAiObjects(): Promise<ReadonlyMap<string, AdminAiProfile>> {
    const now = Date.now();
    if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const value = buildAdminAiCatalog(await loadAdminContentRecords());
            cache = { at: Date.now(), value };
            return value;
        } catch (error) {
            console.error('[admin-ai-catalog]', safeLogValue(error));
            return cache?.value ?? new Map<string, AdminAiProfile>();
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

export function __resetAdminAiCatalogCache(): void {
    cache = null;
    inflight = null;
}
