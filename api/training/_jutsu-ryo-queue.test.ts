import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { advanceQueuedJutsuRyoTraining, cancelQueuedJutsuRyoTraining, queueJutsuRyoTraining, type ServerJutsuTraining } from './_jutsu-ryo.js';

const active = (overrides: Partial<ServerJutsuTraining> = {}): ServerJutsuTraining => ({
    serverToken: 'active-token',
    jutsuId: 'fireball',
    label: 'Fireball',
    fromLevel: 5,
    toLevel: 6,
    ryoCost: 5000,
    startedAt: 100,
    endsAt: 200,
    ...overrides,
});

describe('server-settled jutsu queue', () => {
    test('debits at queue time and refunds the queued cost atomically', () => {
        const queued = queueJutsuRyoTraining({ level: 30, ryo: 20_000, jutsuMastery: [{ jutsuId: 'water-wave', level: 4 }] }, active(), 'water-wave', 'Water Wave', 'queued-token', 0);
        assert.equal(queued.ok, true);
        if (!queued.ok) return;
        assert.equal(queued.character.ryo, 15_500);
        assert.equal(queued.active.next?.serverToken, 'queued-token');
        const cancelled = cancelQueuedJutsuRyoTraining(queued.character, queued.active);
        assert.equal(cancelled.ok, true);
        if (!cancelled.ok) return;
        assert.equal(cancelled.character.ryo, 20_000);
        assert.equal(cancelled.active.next, null);
    });

    test('promotes and auto-claims elapsed queued training on the server', () => {
        const run = active({
            next: { serverToken: 'queued-token', jutsuId: 'water-wave', label: 'Water Wave', fromLevel: 4, toLevel: 5, ryoCost: 4500, durationMs: 100 },
        });
        const settled = advanceQueuedJutsuRyoTraining({ level: 30, ryo: 10_000, jutsuMastery: [{ jutsuId: 'fireball', level: 5 }, { jutsuId: 'water-wave', level: 4 }] }, run, 301);
        assert.equal(settled.active, null);
        const rows = settled.character.jutsuMastery as Array<{ jutsuId: string; level: number }>;
        assert.equal(rows.find((row) => row.jutsuId === 'fireball')?.level, 6);
        assert.equal(rows.find((row) => row.jutsuId === 'water-wave')?.level, 5);
    });
});
