import { createHash } from 'node:crypto';

export const FINDING_SAMPLE_LIMIT = 200;

export class FindingReport {
    constructor(categories, sampleLimit = FINDING_SAMPLE_LIMIT) {
        this.sampleLimit = sampleLimit;
        this.counts = Object.fromEntries(categories.map((category) => [category, 0]));
        this.samples = Object.fromEntries(categories.map((category) => [category, []]));
    }

    add(category, entry) {
        if (!Object.prototype.hasOwnProperty.call(this.counts, category)) {
            throw new Error(`Unknown integrity finding category: ${category}`);
        }
        this.counts[category] += 1;
        if (this.samples[category].length < this.sampleLimit) this.samples[category].push(entry);
    }

    total(categories = Object.keys(this.counts)) {
        return categories.reduce((sum, category) => sum + (this.counts[category] ?? 0), 0);
    }
}

export function subjectLabel(name, includeIdentifiers = false) {
    if (includeIdentifiers) return String(name);
    return `player-${createHash('sha256').update(String(name).toLowerCase()).digest('hex').slice(0, 12)}`;
}

function canonicalize(value, seen) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
        return value;
    }
    if (seen.has(value)) throw new TypeError('Cannot canonicalize a cyclic value.');
    seen.add(value);
    try {
        if (Array.isArray(value)) return value.map((entry) => canonicalize(entry, seen));
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key], seen);
        return out;
    } finally {
        seen.delete(value);
    }
}

export function canonicalJson(value) {
    return JSON.stringify(canonicalize(value, new Set()));
}

export function definitionsEqual(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

export function scanScope(available, requestedLimit) {
    const total = Math.max(0, Number.isSafeInteger(available) ? available : 0);
    const limit = Math.max(0, Number.isSafeInteger(requestedLimit) ? requestedLimit : 0);
    const selected = limit > 0 ? Math.min(total, limit) : total;
    return {
        available: total,
        limit,
        selected,
        completeScan: selected === total,
    };
}

export function strictLedgerCompatibilityReasons(record, statFields) {
    const char = record?.character;
    if (!char || typeof char !== 'object') return [];
    const reasons = [];
    const stats = char.stats && typeof char.stats === 'object' && !Array.isArray(char.stats)
        ? char.stats
        : {};
    const missingStats = statFields.filter((field) => !Object.prototype.hasOwnProperty.call(stats, field));
    if (missingStats.length > 0) reasons.push({ reason: 'missing-stat-ledger-fields', fields: missingStats });
    if (record._saveVersion === undefined || record._saveVersion === null) reasons.push({ reason: 'missing-save-version' });
    return reasons;
}
