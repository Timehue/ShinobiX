import { kv } from '../_storage.js';
import {
    REGISTRY_KEY,
    buildPublicPlayerIndexEntry,
    needsPublicPlayerIndexBackfill,
    parsePublicPlayerIndexEntry,
    type PublicPlayerIndexEntry,
} from './_public-index.js';

export type PublicIndexReadResult = {
    rawRegistry: Record<string, unknown>;
    entries: Map<string, PublicPlayerIndexEntry>;
    staleKeys: string[];
    backfilled: number;
};

export async function readPublicPlayerIndex(options: { backfill?: boolean; logContext?: string } = {}): Promise<PublicIndexReadResult> {
    const rawRegistry = await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY) ?? {};
    const registryKeys = Object.keys(rawRegistry);
    const entries = new Map<string, PublicPlayerIndexEntry>();
    const staleKeys: string[] = [];

    for (const key of registryKeys) {
        const raw = rawRegistry[key];
        const parsed = parsePublicPlayerIndexEntry(raw, key);
        if (parsed) entries.set(key, parsed);
        if (needsPublicPlayerIndexBackfill(raw)) staleKeys.push(key);
    }

    let backfilled = 0;
    if (options.backfill && staleKeys.length > 0) {
        try {
            const saves = await kv.mget<Record<string, unknown>[]>(...staleKeys.map((key) => `save:${key}`));
            const patch: Record<string, PublicPlayerIndexEntry> = {};
            const now = Date.now();
            for (let i = 0; i < staleKeys.length; i++) {
                const key = staleKeys[i]!;
                const save = saves[i] ?? null;
                const char = (save?.character ?? null) as Record<string, unknown> | null;
                if (!char) continue;
                const prior = entries.get(key);
                const entry = buildPublicPlayerIndexEntry(char, key, now, prior?.lastSeen ?? 0);
                entries.set(key, entry);
                patch[key] = entry;
            }
            const patchCount = Object.keys(patch).length;
            if (patchCount > 0) {
                await kv.hset(REGISTRY_KEY, patch);
                backfilled = patchCount;
            }
        } catch (err) {
            console.warn(`[${options.logContext ?? 'public-index'}] public index backfill failed`, err);
        }
    }

    return { rawRegistry, entries, staleKeys, backfilled };
}
