"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPublicPlayerIndex = readPublicPlayerIndex;
const _storage_js_1 = require("../_storage.js");
const _public_index_js_1 = require("./_public-index.js");
async function readPublicPlayerIndex(options = {}) {
    const rawRegistry = await _storage_js_1.kv.hgetall(_public_index_js_1.REGISTRY_KEY) ?? {};
    const registryKeys = Object.keys(rawRegistry);
    const entries = new Map();
    const staleKeys = [];
    for (const key of registryKeys) {
        const raw = rawRegistry[key];
        const parsed = (0, _public_index_js_1.parsePublicPlayerIndexEntry)(raw, key);
        if (parsed)
            entries.set(key, parsed);
        if ((0, _public_index_js_1.needsPublicPlayerIndexBackfill)(raw))
            staleKeys.push(key);
    }
    let backfilled = 0;
    if (options.backfill && staleKeys.length > 0) {
        try {
            const saves = await _storage_js_1.kv.mget(...staleKeys.map((key) => `save:${key}`));
            const patch = {};
            const now = Date.now();
            for (let i = 0; i < staleKeys.length; i++) {
                const key = staleKeys[i];
                const save = saves[i] ?? null;
                const char = (save?.character ?? null);
                if (!char)
                    continue;
                const prior = entries.get(key);
                const entry = (0, _public_index_js_1.buildPublicPlayerIndexEntry)(char, key, now, prior?.lastSeen ?? 0);
                entries.set(key, entry);
                patch[key] = entry;
            }
            const patchCount = Object.keys(patch).length;
            if (patchCount > 0) {
                await _storage_js_1.kv.hset(_public_index_js_1.REGISTRY_KEY, patch);
                backfilled = patchCount;
            }
        }
        catch (err) {
            console.warn(`[${options.logContext ?? 'public-index'}] public index backfill failed`, err);
        }
    }
    return { rawRegistry, entries, staleKeys, backfilled };
}
