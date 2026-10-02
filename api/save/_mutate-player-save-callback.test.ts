import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let mutatePlayerSave: typeof import('./_mutate-player-save.js').mutatePlayerSave;
let PET_BREEDING_MIGRATION_VERSION: number;

const PREFIX = 'mutatecallbackqa';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ mutatePlayerSave } = await import('./_mutate-player-save.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
});

function settledCharacter(name: string): Json {
    // Full vitals and a stamped pet migration: none of the settles that run
    // before the callback has anything to change.
    return {
        name,
        level: 12,
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
        pets: [],
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        ryo: 50,
    };
}

describe('mutatePlayerSave callback contract', { concurrency: false }, () => {
    it('commits a callback that assigns a top-level field in place', async () => {
        const name = `${PREFIX}inplace`;
        await kv.set(`save:${name}`, { _saveVersion: 4, _saveAt: Date.now(), character: settledCharacter(name) });

        // This used to edit the very object the compare-and-set expected, so the
        // write failed as `player-save-version-conflict` although nothing else
        // had touched the save.
        const out = await mutatePlayerSave(name, ({ character }) => {
            character.ryo = 75;
            return { ok: true, character, value: null };
        });

        assert.equal(out.ok, true);
        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal(stored?._saveVersion, 5);
        assert.equal((stored?.character as Json).ryo, 75);
    });

    it('keeps the record untouched when the callback assigns onto ctx.record', async () => {
        const name = `${PREFIX}recordpatch`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), activeSeal: 'a', character: settledCharacter(name) });

        const out = await mutatePlayerSave(name, ({ record, character }) => {
            record.activeSeal = 'b';
            return { ok: true, character: { ...character, ryo: 51 }, value: null, recordPatch: { activeSeal: 'c' } };
        });

        assert.equal(out.ok, true);
        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal(stored?.activeSeal, 'c', 'only recordPatch reaches the committed row');
        assert.equal((stored?.character as Json).ryo, 51);
    });

    it('hands the same object as ctx.character and ctx.record.character when the settles changed nothing', async () => {
        const name = `${PREFIX}identity`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: settledCharacter(name) });

        let same: boolean | undefined;
        const out = await mutatePlayerSave(name, ({ record, character }) => {
            same = record.character === character;
            return { ok: true, write: false, character, value: null };
        });

        assert.equal(out.ok, true);
        assert.equal(same, true);
    });

    it('hands different objects when a settle rewrote the character', async () => {
        const name = `${PREFIX}migrated`;
        // No migration stamp: the owned-pet migration rewrites the character.
        const { petBreedingMigrationVersion: _stamp, ...unmigrated } = settledCharacter(name);
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: unmigrated });

        let same: boolean | undefined;
        await mutatePlayerSave(name, ({ record, character }) => {
            same = record.character === character;
            return { ok: true, write: false, character, value: null };
        });

        assert.equal(same, false);
    });

    it('undoes a decision\'s outside writes when its save write loses the compare-and-set', async () => {
        const name = `${PREFIX}conflictundo`;
        await kv.set(`save:${name}`, { _saveVersion: 2, _saveAt: Date.now(), character: settledCharacter(name) });
        const marker = `claim:${name}`;
        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === `save:${name}`) return false;
            return original.call(kv, key, expected, value, options);
        };
        try {
            await assert.rejects(mutatePlayerSave(name, async ({ character }) => {
                await kv.set(marker, 'claimed');
                return { ok: true, character: { ...character, ryo: 999 }, value: null, onConflict: () => kv.del(marker).then(() => undefined) };
            }), /player-save-version-conflict/);
        } finally {
            kv.compareSet = original;
        }

        assert.equal(await kv.get(marker), null, 'the claim recorded ahead of the payout was taken back');
        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal((stored?.character as Json).ryo, 50, 'nothing was paid');
        assert.equal(stored?._saveVersion, 2);
    });

    it('leaves outside writes alone when the save write fails for any other reason', async () => {
        const name = `${PREFIX}transport`;
        await kv.set(`save:${name}`, { _saveVersion: 2, _saveAt: Date.now(), character: settledCharacter(name) });
        let undone = false;
        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            // A lost acknowledgement: the row may or may not have been written.
            if (key === `save:${name}`) throw new Error('socket hang up');
            return original.call(kv, key, expected, value, options);
        };
        try {
            await assert.rejects(mutatePlayerSave(name, ({ character }) => ({
                ok: true, character: { ...character, ryo: 999 }, value: null, onConflict: () => { undone = true; },
            })), /socket hang up/);
        } finally {
            kv.compareSet = original;
        }
        assert.equal(undone, false, 'a write that may have landed is never undone');
    });

    it('runs afterCommit once the save is committed, while the save lock is still held', async () => {
        const name = `${PREFIX}aftercommit`;
        await kv.set(`save:${name}`, { _saveVersion: 6, _saveAt: Date.now(), character: settledCharacter(name) });
        let seen: { version: number; stored: number; locked: boolean } | undefined;
        const out = await mutatePlayerSave(name, ({ character }) => ({
            ok: true,
            character: { ...character, ryo: 60 },
            value: null,
            afterCommit: async ({ _saveVersion }) => {
                const stored = await kv.get<Json>(`save:${name}`);
                seen = { version: _saveVersion, stored: Number(stored?._saveVersion), locked: Boolean(await kv.get(`lock:save:${name}`)) };
            },
        }));

        assert.equal(out.ok, true);
        assert.deepEqual(seen, { version: 7, stored: 7, locked: true });
    });

    it('never runs afterCommit for a decision that writes nothing, or whose write lost', async () => {
        const name = `${PREFIX}aftercommitskip`;
        await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character: settledCharacter(name) });
        let ran = 0;
        await mutatePlayerSave(name, ({ character }) => ({
            ok: true, write: false, character, value: null, afterCommit: () => { ran += 1; },
        }));

        const original = kv.compareSet;
        kv.compareSet = async (key, expected, value, options) => {
            if (key === `save:${name}`) return false;
            return original.call(kv, key, expected, value, options);
        };
        try {
            await assert.rejects(mutatePlayerSave(name, ({ character }) => ({
                ok: true, character: { ...character, ryo: 1 }, value: null, afterCommit: () => { ran += 1; },
            })), /player-save-version-conflict/);
        } finally {
            kv.compareSet = original;
        }
        assert.equal(ran, 0);
    });

    it('says whether the save or only its character is missing', async () => {
        const absent = await mutatePlayerSave(`${PREFIX}absent`, ({ character }) => ({ ok: true, character, value: null }));
        assert.deepEqual(absent, { ok: false, status: 404, error: 'Player save not found.', code: 'save-not-found' });

        await kv.set(`save:${PREFIX}hollow`, { _saveVersion: 3 });
        const hollow = await mutatePlayerSave(`${PREFIX}hollow`, ({ character }) => ({ ok: true, character, value: null }));
        assert.deepEqual(hollow, { ok: false, status: 404, error: 'Player save not found.', code: 'character-not-found' });
    });
});
