// Local synthetic handler benchmark. No network, database, or real player data.
// Run: node --import tsx scripts/benchmark-game-state-membership.mjs [--output=path.json]
// Measures membership read work with four populated councils, a current public
// index, cold process-frame cache, and an explicitly simulated 15-connection pool.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.VERCEL;
globalThis.fetch = async () => { throw new Error('Network is forbidden in this synthetic benchmark.'); };
const { kv } = await import('../api/_storage.ts');
const { projectKvValue } = await import('../api/_storage-projection.ts');
const { __clearProcCache } = await import('../api/_proc-cache.ts');
const { WAR_VILLAGES } = await import('../api/_war-map-sectors.ts');
const { leadershipVillageKey } = await import('../shared/village-anbu.ts');
const { buildPublicPlayerIndexEntry } = await import('../api/player/_public-index.ts');
const imported = await import('../api/game-state.ts');
const handler = typeof imported.default === 'function' ? imported.default : imported.default.default;
const now = Date.UTC(2026, 8, 16, 12);
Date.now = () => now;
const saves = new Map();
const registry = {};
for (const [index, village] of WAR_VILLAGES.entries()) {
    const names = Array.from({ length: 13 }, (_, seat) => `fixture${index}seat${seat}`);
    for (const [seat, name] of names.entries()) {
        const character = { name, village, level: 20, monthlyPvpKills: seat >= 6 ? 100 - seat : 0,
            pvpKillMonth: '2026-09', inventory: ['fixture-only-private-item'] };
        saves.set(`save:${name}`, { character, _saveVersion: 1, creatorEvents: ['x'.repeat(128 * 1024)] });
        registry[name] = buildPublicPlayerIndexEntry(character, name, now);
    }
    await kv.set(`game:village-state:${leadershipVillageKey(village)}`, { anbuAppointees: names.slice(0, 3) });
    await kv.set(`village:elder-council:${leadershipVillageKey(village)}`, {
        version: 1, startedAt: now - 1000, nextSelectionAt: now + 86400000,
        seats: names.slice(3, 6), winningScores: [1, 1],
    });
}
await kv.hset('player:registry', registry);

let counters;
let active = 0;
const waiters = [];
async function simulatedRead(value) {
    if (active >= 15) await new Promise(resolve => waiters.push(resolve));
    else active++;
    try {
        await new Promise(resolve => setTimeout(resolve, 2));
        const encoded = JSON.stringify(value);
        counters.membershipJsonBytes += Buffer.byteLength(encoded);
        return JSON.parse(encoded);
    } finally {
        const next = waiters.shift();
        if (next) next();
        else active--;
    }
}
const originalGet = kv.get.bind(kv);
kv.get = async key => {
    if (!key.startsWith('save:')) return originalGet(key);
    counters.fullSaveReads++;
    return simulatedRead(saves.get(key) ?? null);
};
kv.mgetProjected = async (keys, projection) => {
    counters.projectedBatches++;
    counters.projectedRows += keys.length;
    return simulatedRead(keys.map(key => projectKvValue(saves.get(key), projection)));
};
const samples = [];
let digest;
for (let i = 0; i < 7; i++) {
    __clearProcCache();
    counters = { fullSaveReads: 0, projectedBatches: 0, projectedRows: 0, membershipJsonBytes: 0 };
    let payload;
    let status = 200;
    const res = { setHeader() {}, status(value) { status = value; return this; },
        json(value) { payload = value; return this; }, end() { return this; } };
    const start = performance.now();
    await handler({ method: 'GET', query: {}, headers: {} }, res);
    const durationMs = performance.now() - start;
    assert.equal(status, 200);
    for (const village of WAR_VILLAGES) {
        const state = payload.villageStates[leadershipVillageKey(village)];
        assert.equal(state.anbuMembers.length, 10);
        assert.equal(state.elderAppointees.filter(Boolean).length, 3);
    }
    const nextDigest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    if (digest) assert.equal(nextDigest, digest);
    digest = nextDigest;
    samples.push({ durationMs: Number(durationMs.toFixed(3)), ...counters });
}
const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
const report = { kind: 'synthetic-game-state-membership', node: process.version,
    cache: 'cold process frame; populated current councils and public index',
    simulatedPool: { connections: 15, perReadDelayMs: 2 },
    fixture: { villages: 4, saves: 52, paddingBytesPerSave: 128 * 1024 },
    samples, medianMs: durations[3], minMs: durations[0], maxMs: durations[6], payloadSha256: digest,
    limitations: 'Handler and mocked storage transfer only; no HTTP, Postgres, real network, or production latency.' };
const json = JSON.stringify(report, null, 2);
const output = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length);
if (output) writeFileSync(output, `${json}\n`);
console.log(json);
