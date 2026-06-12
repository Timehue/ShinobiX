"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUMMARY_LEN = exports.MAX_AUDIT_ENTRIES = void 0;
exports.auditKey = auditKey;
exports.clampAuditValue = clampAuditValue;
exports.appendCapped = appendCapped;
exports.recordAudit = recordAudit;
exports.readAudit = readAudit;
const _storage_js_1 = require("./_storage.js");
const _lock_js_1 = require("./_lock.js");
const AUDIT_PREFIX = 'audit:';
// Matches the moderation log's retention — months of activity at typical
// volumes, well under the KV value-size ceiling.
exports.MAX_AUDIT_ENTRIES = 5000;
// Cap the serialized size of a single before/after summary so a careless caller
// (or a hand-edited blob) can't bloat the log with a megabyte of JSON.
exports.MAX_SUMMARY_LEN = 2000;
function auditKey(domain) { return `${AUDIT_PREFIX}${domain}`; }
// Pure: clamp a before/after summary to a safe serialized size. Strings are
// truncated directly; objects are JSON-checked and replaced with a marker if
// they exceed the cap (so the rest of the entry still records cleanly).
function clampAuditValue(v, maxLen = exports.MAX_SUMMARY_LEN) {
    if (v === undefined || v === null)
        return v;
    if (typeof v === 'string') {
        return v.length <= maxLen ? v : v.slice(0, maxLen) + '…[truncated]';
    }
    try {
        const s = JSON.stringify(v);
        if (s === undefined)
            return '[unserializable]';
        if (s.length <= maxLen)
            return v;
        return s.slice(0, maxLen) + '…[truncated]';
    }
    catch {
        return '[unserializable]';
    }
}
// Pure: prepend the newest entry and cap the list to `max` (newest-first).
function appendCapped(existing, entry, max = exports.MAX_AUDIT_ENTRIES) {
    const list = Array.isArray(existing) ? existing : [];
    return [entry, ...list].slice(0, max);
}
// Record an audit entry. Best-effort: never throws into the calling handler, so
// a logging hiccup can never fail a real admin action.
async function recordAudit(entry) {
    try {
        const full = {
            ...entry,
            ts: entry.ts ?? Date.now(),
            before: clampAuditValue(entry.before),
            after: clampAuditValue(entry.after),
        };
        const key = auditKey(entry.domain);
        await (0, _lock_js_1.withKvLock)(key, async () => {
            const existing = (await _storage_js_1.kv.get(key)) ?? [];
            await _storage_js_1.kv.set(key, appendCapped(existing, full));
        });
    }
    catch {
        // best-effort
    }
}
async function readAudit(domain, limit = 200) {
    try {
        const existing = (await _storage_js_1.kv.get(auditKey(domain))) ?? [];
        const n = Math.max(1, Math.min(Math.floor(limit) || 0, exports.MAX_AUDIT_ENTRIES));
        return existing.slice(0, n);
    }
    catch {
        return [];
    }
}
