import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMetricsSampler } from './_runtime-metrics.js';

function spin(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* hold the main thread */ }
}

test('a blocked main thread records loop activity and delay, then resets the sampling window', async () => {
    const sampler = new RuntimeMetricsSampler();
    try {
        sampler.snapshot(); // open a fresh window
        // Let the histogram tick once, then block the loop for 150 ms.
        await new Promise((resolve) => setTimeout(resolve, 30));
        spin(150);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const busy = sampler.snapshot();
        // Other workers can deschedule this process during its timer waits.
        // Their load changes the measured fractions without breaking sampling.
        assert.ok(busy.eventLoop.utilization > 0 && busy.eventLoop.utilization <= 1, `utilization ${busy.eventLoop.utilization}`);
        assert.ok(busy.eventLoop.delayMs.max >= 100, `max delay ${busy.eventLoop.delayMs.max}`);
        assert.ok(Number.isFinite(busy.cpu.cores) && busy.cpu.cores >= 0, `cpu ${busy.cpu.cores}`);

        // Read synchronously before another timer tick: the previous delay
        // must be cleared. An idle wait can itself stall under parallel load.
        const reset = sampler.snapshot();
        assert.equal(reset.eventLoop.delayMs.max, 0);
    } finally {
        sampler.stop();
    }
});

test('CPU fractions use elapsed microseconds and independent sampling windows', () => {
    let now = 1000;
    let cumulative = { user: 1000, system: 2000 };
    const cpu = mock.method(process, 'cpuUsage', (previous?: NodeJS.CpuUsage) => ({
        user: cumulative.user - (previous?.user ?? 0),
        system: cumulative.system - (previous?.system ?? 0),
    }));
    const sampler = new RuntimeMetricsSampler(() => now);
    try {
        now += 100;
        cumulative = { user: 26000, system: 27000 };
        assert.equal(sampler.snapshot().cpu.cores, 0.5);
        now += 250;
        cumulative = { user: 36000, system: 42000 };
        assert.equal(sampler.snapshot().cpu.cores, 0.1);
        now += 50;
        cumulative = { user: 86000, system: 92000 };
        assert.equal(sampler.snapshot().cpu.cores, 2, 'process CPU may include several active threads');
    } finally {
        sampler.stop();
        cpu.mock.restore();
    }
});

test('sources are reported, and a throwing source fails soft', () => {
    const sampler = new RuntimeMetricsSampler();
    try {
        const ok = sampler.snapshot({
            pool: () => ({ max: 15, total: 4, idle: 1, waiting: 2 }),
            sockets: () => 7,
            onlinePlayers: () => 5,
        });
        assert.deepEqual(ok.pool, { max: 15, total: 4, idle: 1, waiting: 2 });
        assert.deepEqual(ok.realtime, { sockets: 7, onlinePlayers: 5 });
        assert.ok(ok.memory.rssMb > 0);

        const broken = sampler.snapshot({
            pool: () => { throw new Error('boom'); },
            sockets: () => { throw new Error('boom'); },
        });
        assert.equal(broken.pool, null);
        assert.deepEqual(broken.realtime, { sockets: 0, onlinePlayers: 0 });
    } finally {
        sampler.stop();
    }
});
