import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import {
    coordinateWarfrontStart,
    warfrontInitializingKey,
} from './_warfront-start-coordinator.js';

describe('Warfront start coordination', () => {
    it('converges concurrent starts on one publication and runs one initializer', async () => {
        const store = _makeMemoryKv();
        const seal = { token: 'one-authoritative-seal', seed: 7301 };
        let published: typeof seal | null = null;
        let simulations = 0;
        let releaseSimulation!: () => void;
        const simulationHeld = new Promise<void>((resolve) => { releaseSimulation = resolve; });
        const readPublished = async () => published;
        const initialize = async () => {
            simulations += 1;
            await simulationHeld;
            published = seal;
            return seal;
        };
        const options = { leaseTtlSeconds: 120, waitForPublishedMs: 2_000, pollIntervalMs: 1 };

        const first = coordinateWarfrontStart(store, 'Kakashi', readPublished, initialize, options);
        await new Promise<void>((resolve) => setImmediate(resolve));
        const second = coordinateWarfrontStart(store, 'Kakashi', readPublished, initialize, options);
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.equal(simulations, 1, 'the NX loser must not run the full simulation');
        releaseSimulation();

        const results = await Promise.all([first, second]);
        assert.deepEqual(results.map((result) => result.status).sort(), ['initialized', 'resumed']);
        assert.deepEqual(results.map((result) => result.status === 'busy' ? null : result.value), [seal, seal]);
        assert.equal(await store.get(warfrontInitializingKey('Kakashi')), null);
    });

    it('fails closed when the lease cannot be acquired or stored', async () => {
        const store = _makeMemoryKv();
        await store.set(warfrontInitializingKey('Raiko'), 'other-owner', { ex: 120 });
        let simulations = 0;
        let publicationReads = 0;
        const busy = await coordinateWarfrontStart(
            store,
            'Raiko',
            async () => { publicationReads += 1; return null; },
            async () => { simulations += 1; return { token: 'must-not-exist' }; },
            { leaseTtlSeconds: 120, waitForPublishedMs: 70, pollIntervalMs: 5, maxPollIntervalMs: 20 },
        );
        assert.deepEqual(busy, { status: 'busy' });
        assert.equal(simulations, 0);
        assert.ok(publicationReads <= 8, `backoff must bound polling reads (saw ${publicationReads})`);

        const broken = {
            set: async () => { throw new Error('storage unavailable'); },
            delIfEqual: async () => true,
        };
        await assert.rejects(
            () => coordinateWarfrontStart(
                broken,
                'Sakura',
                async () => null,
                async () => { simulations += 1; return { token: 'must-not-exist' }; },
                { leaseTtlSeconds: 120, waitForPublishedMs: 0 },
            ),
            /storage unavailable/,
        );
        assert.equal(simulations, 0);
    });

    it('rechecks publication after claiming the lease and skips stale preflight work', async () => {
        const store = _makeMemoryKv();
        const seal = { token: 'published-during-claim', seed: 81 };
        let published: typeof seal | null = null;
        let simulations = 0;
        const interleavingStore = {
            set: async (...args: Parameters<typeof store.set>) => {
                const acquired = await store.set(...args);
                if (acquired === 'OK') published = seal;
                return acquired;
            },
            delIfEqual: store.delIfEqual.bind(store),
        };

        const result = await coordinateWarfrontStart(
            interleavingStore,
            'Minato',
            async () => published,
            async () => { simulations += 1; return seal; },
            { leaseTtlSeconds: 120, waitForPublishedMs: 0 },
        );

        assert.deepEqual(result, { status: 'resumed', value: seal });
        assert.equal(simulations, 0);
    });

    it('cannot delete a replacement lease after the original owner expires', async () => {
        const store = _makeMemoryKv();
        const key = warfrontInitializingKey('Obito');
        const result = await coordinateWarfrontStart(
            store,
            'Obito',
            async () => null,
            async () => {
                await store.set(key, 'replacement-owner', { ex: 120 });
                return { token: 'published' };
            },
            { leaseTtlSeconds: 120, waitForPublishedMs: 0 },
        );

        assert.equal(result.status, 'initialized');
        assert.equal(await store.get(key), 'replacement-owner');
    });
});
