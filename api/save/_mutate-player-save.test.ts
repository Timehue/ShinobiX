import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { versionedPlayerRecord, writeVersionedPlayerSaveWithStore } from './_mutate-player-save.js';
import { _makeMemoryKv } from '../_storage.js';

describe('_mutate-player-save', () => {
    it('commits council wins atomically with counter gains and rejects stale replays', async () => {
        const store = _makeMemoryKv();
        const before = { _saveVersion: 1, character: { name: 'Rin', village: 'Frostfang Village', totalAiKills: 1234, totalPvpKills: 900 } };
        await store.set('save:rin', before);
        const won = { ...before.character, totalAiKills: 1235, totalPvpKills: 901 };
        const committed = await writeVersionedPlayerSaveWithStore(store, 'save:rin', before, won);
        await assert.rejects(writeVersionedPlayerSaveWithStore(store, 'save:rin', before, won), /player-save-version-conflict/);
        const saved = await store.get<Record<string, any>>('save:rin');
        assert.deepEqual(saved, committed.record);
        assert.deepEqual((saved!.character as Record<string, unknown>).elderWinDays, [{ day: new Date().toISOString().slice(0, 10), village: 'frostfangvillage', pvp: 1, pve: 1 }]);
        assert.equal(before.character.hasOwnProperty('elderWinDays'), false);
    });

    it('adopts a write whose reply was lost, reading it back the way Postgres keeps it', async () => {
        // Postgres keeps JSON, so a record carrying an undefined field or a -0
        // reads back without them. A plain deep-equal called that landed write
        // lost, and the caller reported a committed write as failed.
        const before = { _saveVersion: 1, character: { name: 'Rin', ryo: 10 } };
        let stored: unknown = before;
        const jsonStore = {
            get: async <T>() => JSON.parse(JSON.stringify(stored)) as T,
            compareSet: async (_key: string, _expected: unknown, value: unknown) => {
                stored = JSON.parse(JSON.stringify(value));
                throw new Error('reply-lost');
            },
        };
        const out = await writeVersionedPlayerSaveWithStore(jsonStore, 'save:rin', before, { name: 'Rin', ryo: 20, cleared: undefined, drift: -0 });
        assert.equal(out._saveVersion, 2);
        assert.equal((stored as { _saveVersion: number })._saveVersion, 2, 'the write did land');
    });

    it('still reports a write whose read-back shows it never landed', async () => {
        const before = { _saveVersion: 1, character: { name: 'Rin', ryo: 10 } };
        const jsonStore = {
            get: async <T>() => JSON.parse(JSON.stringify(before)) as T,
            compareSet: async () => { throw new Error('store-down'); },
        };
        await assert.rejects(writeVersionedPlayerSaveWithStore(jsonStore, 'save:rin', before, { name: 'Rin', ryo: 20 }), /store-down/);
    });

    it('bumps the stored player save version', () => {
        const current = { _saveVersion: 7, character: { name: 'Old', ryo: 10 } };
        const nextCharacter = { name: 'Old', ryo: 20 };
        const out = versionedPlayerRecord(current, nextCharacter);
        assert.equal(out._saveVersion, 8);
        assert.equal(out.record._saveVersion, 8);
        assert.equal(out.record.character, nextCharacter);
    });

    it('does not mutate the input save record', () => {
        const current = { _saveVersion: 2, character: { name: 'Old', ryo: 10 } };
        versionedPlayerRecord(current, { name: 'Old', ryo: 20 });
        assert.equal(current._saveVersion, 2);
        assert.deepEqual(current.character, { name: 'Old', ryo: 10 });
    });

    it('starts absent versions at one', () => {
        const out = versionedPlayerRecord({ character: { name: 'Old' } }, { name: 'Old' });
        assert.equal(out._saveVersion, 1);
    });

    it('applies an atomic top-level record patch with the character mutation', () => {
        const current = { _saveVersion: 3, activeTraining: { token: 'abc' }, character: { name: 'Old', stamina: 10 } };
        const out = versionedPlayerRecord(current, { name: 'Old', stamina: 5 }, { activeTraining: null });
        assert.equal(out._saveVersion, 4);
        assert.equal(out.record.activeTraining, null);
        assert.deepEqual(out.record.character, { name: 'Old', stamina: 5 });
        assert.deepEqual(current.activeTraining, { token: 'abc' });
    });
});
