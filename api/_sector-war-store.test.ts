import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv } from './_storage.js';
import { newSectorWarSession, sectorWarKey } from './_sector-war.js';
import { listUnsettledDueSectorWars } from './_sector-war-store.js';

const NOW = 1_800_000_000_000;

describe('sector-war store: settlement visibility', { concurrency: false }, () => {
    it('never sends an overdue hidden funding row to due settlement', async () => {
        const store = _makeMemoryKv();
        const legacy = {
            ...newSectorWarSession({
                sector: 40,
                attackerVillage: 'Leaf',
                defenderVillage: 'Mist',
                winCondition: 'combat',
                now: NOW - 100,
            }),
            id: '40:legacy-vs-mist',
            endsAt: NOW - 1,
        };
        const funding = {
            ...newSectorWarSession({
                sector: 41,
                attackerVillage: 'Leaf',
                defenderVillage: 'Sand',
                winCondition: 'combat',
                now: NOW - 100,
            }),
            id: '41:leaf-vs-sand',
            endsAt: NOW - 1,
            declarationGeneration: 1,
            declarationFunding: {
                version: 1 as const,
                status: 'funding' as const,
                declarationId: 'sector:41:leaf-vs-sand:g1',
                fingerprint: 'a'.repeat(64),
                source: {
                    kind: 'war-resources' as const,
                    recordKey: 'shared:village-war:leaf',
                    accountId: 'Leaf',
                    amount: 200,
                },
                createdAt: NOW - 100,
                ownerId: 'owner-a',
                leaseExpiresAt: NOW - 50,
                takeoverCount: 0,
            },
        };
        await store.set(sectorWarKey(legacy.id), legacy);
        await store.set(sectorWarKey(funding.id), funding);

        const due = await listUnsettledDueSectorWars(NOW, store);
        assert.deepEqual(due.map(row => row.id), [legacy.id]);

        await store.set(sectorWarKey(funding.id), {
            ...funding,
            declarationFunding: {
                ...funding.declarationFunding,
                status: 'active' as const,
                fundedAt: NOW - 75,
                activatedAt: NOW - 75,
            },
        });
        const afterActivation = await listUnsettledDueSectorWars(NOW, store);
        assert.deepEqual(afterActivation.map(row => row.id).sort(), [funding.id, legacy.id].sort());
    });
});
