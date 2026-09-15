import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

test('sequential event and checkpoint proofs replace nested snapshots through the real versioned save CAS', async () => {
    const { kv, saveStoreKind } = await import('../_storage.js');
    assert.equal(saveStoreKind, 'memory-qa');
    const { writeVersionedPlayerSaveWithStore } = await import('../save/_mutate-player-save.js');
    const { makeHollowGatePendingOperation, recoverHollowGatePendingOperation } = await import('./_pending-operation.js');
    const { withKvLock } = await import('../_lock.js');
    const name = 'hgpendingproofreplacement';
    const token = 'proof-replacement-run';
    const saveKey = `save:${name}`;
    const runKey = `hg-run:${name}:${token}`;
    const initialRun: HollowGateRunToken = {
        playerName: name, mintedAt: Date.now(), floorDepth: 5, currentFloor: 1, seed: 'proof-replacement',
        entryCurrencies: { ryo: 1000, hollowShards: 100 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        rewardLedger: { currencies: { ryo: 200 }, items: {}, sourceIds: ['earlier-earned-ryo'] },
        resolvedEventIds: [], recentConsumableIds: [],
    };
    const character = {
        name, ryo: 1200, hollowShards: 100, hollowGateRun: { runToken: token },
    };
    const initialSave = { _saveVersion: 1, character };
    await kv.set(runKey, initialRun);
    await kv.set(saveKey, initialSave);

    await withKvLock(runKey, async () => {
        const afterEvent: HollowGateRunToken = {
            ...initialRun,
            rewardLedger: { currencies: { ryo: 300 }, items: {}, sourceIds: ['earlier-earned-ryo', 'chest'] },
            resolvedEventIds: ['chest:floor:1:tile:28'],
        };
        const eventProof = makeHollowGatePendingOperation({ token, kind: 'event', id: 'chest:floor:1:tile:28',
            before: initialRun, after: afterEvent,
            response: { action: 'chest', credit: { ryo: 100 }, runState: { keys: 2, torch: 4 } },
        });
        const eventWrite = await writeVersionedPlayerSaveWithStore(kv, saveKey, initialSave,
            { ...character, ryo: 1300, hollowGatePendingOperation: eventProof }, {}, { hollowGateCurrencySource: 'run' });
        const recoveredEvent = await recoverHollowGatePendingOperation(kv, runKey, initialRun, name, token);
        assert.ok(recoveredEvent);
        assert.deepEqual(recoveredEvent.rewardLedger, afterEvent.rewardLedger);

        const afterCheckpoint: HollowGateRunToken = {
            ...recoveredEvent,
            entryCurrencies: { ryo: 1300, hollowShards: 86 },
            rewardLedger: { currencies: {}, items: {}, sourceIds: [] },
            recentConsumableIds: ['checkpoint-request'],
        };
        const checkpointProof = makeHollowGatePendingOperation({ token, kind: 'consumable', id: 'checkpoint-request',
            before: recoveredEvent, after: afterCheckpoint,
            response: { action: 'sanctify', entryCurrencies: afterCheckpoint.entryCurrencies, runState: { torch: 4 } },
        });
        const eventCharacter = eventWrite.record.character as Record<string, unknown>;
        const checkpointWrite = await writeVersionedPlayerSaveWithStore(kv, saveKey, eventWrite.record,
            { ...eventCharacter, hollowShards: 86, hollowGatePendingOperation: checkpointProof }, {},
            { hollowGateCurrencySource: 'checkpoint' });
        const stored = await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(saveKey);
        assert.equal(stored?._saveVersion, 3);
        assert.deepEqual(stored?.character.hollowGatePendingOperation, JSON.parse(JSON.stringify(checkpointProof)),
            'a different operation cannot inherit old positional before/after fields or old response facts');
        assert.deepEqual(checkpointWrite.record, stored, 'the acknowledged snapshot matches the CAS record');

        const recoveredCheckpoint = await recoverHollowGatePendingOperation(kv, runKey, recoveredEvent, name, token);
        assert.ok(recoveredCheckpoint);
        assert.deepEqual(recoveredCheckpoint.entryCurrencies, { ryo: 1300, hollowShards: 86 });
        assert.deepEqual(recoveredCheckpoint.rewardLedger, { currencies: {}, items: {}, sourceIds: [] });
        assert.deepEqual(await recoverHollowGatePendingOperation(kv, runKey, recoveredCheckpoint, name, token), recoveredCheckpoint);
        assert.deepEqual(await kv.get(saveKey), stored, 'repair and repeated repair never charge or rewrite the player save');
    }, { failClosed: true });
});
