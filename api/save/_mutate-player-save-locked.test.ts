import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

/*
 * mutatePlayerSaveLocked (api/save/_mutate-player-save.ts) is mutatePlayerSave
 * for a writer that already holds the save's lock: PvP claim-rewards locks both
 * fighters' saves around its receipts and credits. withKvLock is not
 * re-entrant, so mutatePlayerSave cannot run inside that lock; the locked
 * variant runs the same read, settle, decision and exact compare-and-set
 * without taking it again.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let withKvLock: typeof import('../_lock.js').withKvLock;
let saves: typeof import('./_mutate-player-save.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ withKvLock } = await import('../_lock.js'));
    saves = await import('./_mutate-player-save.js');
});

after(async () => {
    for (const key of await kv.keys('*lockedwriterqa*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function seedTired(name: string): Promise<number> {
    const at = Date.now() - 30_000;
    await kv.set(`save:${name}`, {
        _saveVersion: 4, _saveAt: at, _regenAt: at,
        character: { name, ryo: 10, hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100 },
    });
    return at;
}

describe('mutatePlayerSaveLocked', { concurrency: false }, () => {
    it('runs under the save lock its caller already holds, where mutatePlayerSave cannot', async () => {
        const name = 'lockedwriterqareentry';
        await seedTired(name);
        await withKvLock(`save:${name}`, async () => {
            await assert.rejects(
                saves.mutatePlayerSave(name, ({ character }) => ({ ok: true, value: null, character })),
                (error: Error) => error.name === 'LockContendedError' || /lock/i.test(error.message),
                'withKvLock is not re-entrant: mutatePlayerSave fails closed inside the lock',
            );
            const out = await saves.mutatePlayerSaveLocked(name, ({ character }) => ({
                ok: true, value: 'credited', character: { ...character, ryo: Number(character.ryo) + 5 },
            }));
            assert.ok(out.ok, JSON.stringify(out));
            assert.equal(out.value, 'credited');
            assert.equal(out._saveVersion, 5);
        }, { failClosed: true });
        const stored = await kv.get<Json>(`save:${name}`);
        assert.equal((stored?.character as Json).ryo, 15);
        assert.equal(stored?._saveVersion, 5);
    });

    it('settles the idle recovery earned since the last save into the write, and carries the cursor', async () => {
        const name = 'lockedwriterqaregen';
        const at = await seedTired(name);
        const out = await withKvLock(`save:${name}`, () => saves.mutatePlayerSaveLocked(name, ({ character }) => ({
            ok: true, value: null, character: { ...character, ryo: 99 },
        })), { failClosed: true });
        assert.ok(out.ok);
        const stored = (await kv.get<Json>(`save:${name}`))!;
        const character = stored.character as Json;
        assert.equal(character.ryo, 99);
        assert.ok(Number(character.hp) >= 40, `hp ${character.hp} lost the idle recovery`);
        assert.ok(Number(character.chakra) >= 50, `chakra ${character.chakra} lost the idle recovery`);
        assert.ok(Number(character.stamina) >= 30, `stamina ${character.stamina} lost the idle recovery`);
        // The write moved no vital, so it carries the settled cursor (whole
        // ticks past the stored one) instead of fencing it to the write instant.
        assert.ok(Number(stored._regenAt) >= at + 29_000 && Number(stored._regenAt) <= Number(stored._saveAt), `cursor ${stored._regenAt}`);
    });

    it('answers 404 for a save that is not there, and writes nothing', async () => {
        const out = await saves.mutatePlayerSaveLocked('lockedwriterqamissing', ({ character }) => ({ ok: true, value: null, character }));
        assert.equal(out.ok, false);
        assert.equal(!out.ok && out.status, 404);
        assert.equal(!out.ok && out.code, 'save-not-found');
        assert.equal(await kv.get('save:lockedwriterqamissing'), null);
    });
});

describe('carriedRegenCursor', () => {
    const settled = { hp: 40, chakra: 50, stamina: 30 };
    const regen = { excluded: false, cursor: 1_000 };

    it('carries the settled cursor through a write that moved no vital', () => {
        assert.equal(saves.carriedRegenCursor(settled, { ...settled, ryo: 5 }, regen), 1_000);
    });

    it('fences the cursor when the write itself changed a vital: its time is not idle recovery', () => {
        assert.equal(saves.carriedRegenCursor(settled, { ...settled, hp: 1 }, regen), undefined);
        assert.equal(saves.carriedRegenCursor(settled, { ...settled, stamina: 0 }, regen), undefined);
    });

    it('fences excluded state and a record with no clock', () => {
        assert.equal(saves.carriedRegenCursor(settled, settled, { excluded: true, cursor: 1_000 }), undefined);
        assert.equal(saves.carriedRegenCursor(settled, settled, { excluded: false, cursor: 0 }), undefined);
    });
});
