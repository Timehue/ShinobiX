import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuBusyFraction, memoryUsedFraction, parsePrometheus, samplerDatabaseUrl, summarizeSamples } from './sampler.mjs';

test('samplerDatabaseUrl moves to the transaction-mode port and drops sslmode', () => {
    const session = 'postgresql://postgres.ref:p%40ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
    assert.equal(samplerDatabaseUrl(session, '6543'), 'postgresql://postgres.ref:p%40ss@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
    assert.equal(samplerDatabaseUrl(session, ''), 'postgresql://postgres.ref:p%40ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres');
});

const scrape = (idle0, user0, idle1, user1) => `# HELP node_cpu_seconds_total x
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} ${idle0}
node_cpu_seconds_total{cpu="0",mode="user"} ${user0}
node_cpu_seconds_total{cpu="1",mode="idle"} ${idle1}
node_cpu_seconds_total{cpu="1",mode="user"} ${user1}
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 250
`;

test('parsePrometheus reads names, labels and values', () => {
    const m = parsePrometheus(scrape(10, 5, 10, 5));
    assert.equal(m.length, 6);
    assert.deepEqual(m[0], { name: 'node_cpu_seconds_total', labels: { cpu: '0', mode: 'idle' }, value: 10 });
});

test('cpuBusyFraction is busy time over total time across CPUs', () => {
    const a = parsePrometheus(scrape(100, 0, 100, 0));
    const b = parsePrometheus(scrape(110, 30, 105, 15)); // 15 idle + 45 busy of 60
    assert.equal(cpuBusyFraction(a, b), 0.75);
    assert.equal(cpuBusyFraction(a, a), null);
});

test('memoryUsedFraction', () => {
    assert.equal(memoryUsedFraction(parsePrometheus(scrape(0, 0, 0, 0))), 0.75);
    assert.equal(memoryUsedFraction([]), null);
});

test('summarizeSamples ignores missing figures', () => {
    const s = summarizeSamples([
        { runtime: { eventLoop: { utilization: 0.2, delayMs: { p99: 12 } }, pool: { waiting: 0 } }, db: { dbBytes: 5 } },
        { runtime: { eventLoop: { utilization: 0.6, delayMs: { p99: 40 } }, pool: { waiting: 3 } }, db: null, host: { cpuBusy: 0.9 } },
        { runtime: null },
    ]);
    assert.equal(s.eluAvg, 0.4);
    assert.equal(s.eluMax, 0.6);
    assert.equal(s.loopP99Max, 40);
    assert.equal(s.poolWaitingMax, 3);
    assert.equal(s.dbBytesMax, 5);
    assert.equal(s.supabaseCpuMax, 0.9);
    assert.equal(s.cpuCoresAvg, null);
});
