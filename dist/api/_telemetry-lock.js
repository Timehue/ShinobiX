"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withTelemetryLock = withTelemetryLock;
const _lock_js_1 = require("./_lock.js");
const _storage_js_1 = require("./_storage.js");
// Tests and injected jobs can supply a non-global store. Serialize those within
// the process; production's shared KV uses the distributed lock so concurrent
// instances cannot lose read-modify-write telemetry updates.
const localTails = new Map();
async function withLocalLock(key, fn) {
    const previous = localTails.get(key);
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    localTails.set(key, current);
    if (previous)
        await previous;
    try {
        return await fn();
    }
    finally {
        release();
        if (localTails.get(key) === current)
            localTails.delete(key);
    }
}
async function withTelemetryLock(key, store, fn) {
    if (store === _storage_js_1.kv) {
        return (0, _lock_js_1.withKvLock)(`telemetry:${key}`, fn, { failClosed: true });
    }
    return withLocalLock(key, fn);
}
