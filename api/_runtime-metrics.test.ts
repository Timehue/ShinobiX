import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeMetricsSampler } from './_runtime-metrics.js';

function spin(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* hold the main thread */ }
}

test('a blocked main thread reads as high utilization and a long loop delay', async () => {
    const sampler = new RuntimeMetricsSampler();
    try {
        sampler.snapshot(); // open a fresh window
        // Let the histogram tick once, then block the loop for 150 ms.
        await new Promise((resolve) => setTimeout(resolve, 30));
        spin(150);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const busy = sampler.snapshot();
        assert.ok(busy.eventLoop.utilization > 0.5, `utilization ${busy.eventLoop.utilization}`);
        assert.ok(busy.eventLoop.delayMs.max >= 100, `max delay ${busy.eventLoop.delayMs.max}`);
        assert.ok(busy.cpu.cores > 0.3, `cpu ${busy.cpu.cores}`);

        // The next window starts after the reset, so it no longer sees the spin.
        await new Promise((resolve) => setTimeout(resolve, 60));
        const idle = sampler.snapshot();
        assert.ok(idle.eventLoop.delayMs.max < 100, `idle max delay ${idle.eventLoop.delayMs.max}`);
        assert.ok(idle.eventLoop.utilization < busy.eventLoop.utilization);
    } finally {
        sampler.stop();
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
