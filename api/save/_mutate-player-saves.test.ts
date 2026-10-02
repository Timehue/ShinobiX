import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * mutatePlayerSaves: the two-save form of mutatePlayerSave, for settlements
 * that change two players' saves together. Every lock is taken in one sorted
 * order before any read, each save is settled like a single mutation, and the
 * writes commit in the order the names were given.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

let kv: typeof import('../_storage.js').kv;
let saves: typeof import('./_mutate-player-save.js');
let PET_BREEDING_MIGRATION_VERSION: number;

const ZED = 'twosavezed';
const AMY = 'twosaveamy';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    saves = await import('./_mutate-player-save.js');
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

/** A save whose regeneration cursor is 30 s old: one point per second in each 100-point pool. */
async function seed(name: string, extra: Json = {}): Promise<void> {
    const at = Date.now() - 30_000;
    await kv.set(`save:${name}`, {
        _saveVersion: 5, _saveAt: at, _regenAt: at,
        character: {
            name, level: 20, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, pets: [],
            hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100, ryo: 1_000, ...extra,
        },
    });
}
const stored = async (name: string) => (await kv.get<Json>(`save:${name}`))!;
const ryo = async (name: string) => Number(((await stored(name)).character as Json).ryo);

/** A transfer of `amount` ryo from `from` to `to`. */
function transfer(from: string, to: string, amount: number) {
    return (sides: Readonly<Record<string, { character: Json }>>) => ({
        ok: true as const,
        value: amount,
        sides: {
            [from]: { character: { ...sides[from]!.character, ryo: Number(sides[from]!.character.ryo) - amount } },
            [to]: { character: { ...sides[to]!.character, ryo: Number(sides[to]!.character.ryo) + amount } },
        },
    });
}

/** Replace kv.compareSet for the saves while `run` executes. */
async function withSaveWrites<T>(
    write: (original: typeof kv.compareSet, ...args: Parameters<typeof kv.compareSet>) => ReturnType<typeof kv.compareSet>,
    run: () => Promise<T>,
): Promise<T> {
    const original = kv.compareSet;
    kv.compareSet = (key, expected, value, options) => key.startsWith('save:')
        ? write(original, key, expected, value, options)
        : original.call(kv, key, expected, value, options);
    try {
        return await run();
    } finally {
        kv.compareSet = original;
    }
}

describe('mutatePlayerSaves', { concurrency: false }, () => {
    it('commits every save in the order given, each keeping its own idle recovery', async () => {
        await seed(ZED);
        await seed(AMY);
        const order: string[] = [];
        // ZED sorts after AMY, so the given order is NOT the lock order.
        const out = await withSaveWrites(async (original, key, expected, value, options) => {
            order.push(key);
            return original.call(kv, key, expected, value, options);
        }, () => saves.mutatePlayerSaves([ZED, AMY], transfer(ZED, AMY, 300)));

        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.deepEqual(order, [`save:${ZED}`, `save:${AMY}`], 'the debit commits before the credit');
        assert.equal(out.value, 300);
        assert.equal(await ryo(ZED), 700);
        assert.equal(await ryo(AMY), 1_300);
        for (const name of [ZED, AMY]) {
            const save = await stored(name);
            const character = save.character as Json;
            assert.equal(save._saveVersion, 6, `${name} bumped once`);
            assert.equal(out.saves[name]?._saveVersion, 6);
            assert.equal(out.saves[name]?.written, true);
            assert.ok(Number(character.hp) >= 40, `${name}: hp ${character.hp} lost the idle recovery`);
            assert.ok(Number(character.chakra) >= 50, `${name}: chakra ${character.chakra} lost the idle recovery`);
        }
    });

    it('takes every save lock in sorted order before reading any save', async () => {
        await seed(ZED);
        await seed(AMY);
        const events: string[] = [];
        const originalSet = kv.set;
        const originalGet = kv.get;
        kv.set = (async (key: string, value: unknown, options?: Parameters<typeof originalSet>[2]) => {
            const result = await originalSet.call(kv, key, value, options);
            if (key.startsWith('lock:save:') && result) events.push(`lock ${key.slice('lock:save:'.length)}`);
            return result;
        }) as typeof kv.set;
        kv.get = (async (key: string) => {
            if (key.startsWith('save:')) events.push(`read ${key.slice('save:'.length)}`);
            return originalGet.call(kv, key);
        }) as typeof kv.get;
        try {
            await saves.mutatePlayerSaves([ZED, AMY], transfer(ZED, AMY, 1));
        } finally {
            kv.set = originalSet;
            kv.get = originalGet;
        }
        assert.deepEqual(events.slice(0, 4), [`lock ${AMY}`, `lock ${ZED}`, `read ${ZED}`, `read ${AMY}`]);
    });

    it('a missing save answers 404 naming it, and nothing is written', async () => {
        await seed(ZED);
        let decided = false;
        const out = await saves.mutatePlayerSaves([ZED, AMY], (sides) => { decided = true; return transfer(ZED, AMY, 1)(sides); });
        assert.deepEqual(out, { ok: false, status: 404, error: 'Player save not found.', code: 'save-not-found', playerName: AMY });
        assert.equal(decided, false);
        assert.equal((await stored(ZED))._saveVersion, 5);
    });

    it('leaves a write:false side exactly as it is', async () => {
        await seed(ZED);
        await seed(AMY);
        const out = await saves.mutatePlayerSaves([ZED, AMY], (sides) => ({
            ok: true,
            value: null,
            sides: {
                [ZED]: { write: false, character: sides[ZED]!.character },
                [AMY]: { character: { ...sides[AMY]!.character, ryo: 2_000 } },
            },
        }));
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.saves[ZED]?.written, false);
        assert.equal(out.saves[ZED]?._saveVersion, 5);
        assert.equal((await stored(ZED))._saveVersion, 5, 'the replayed side is not rewritten');
        assert.equal(await ryo(AMY), 2_000);
    });

    it('a refusal from the decision writes nothing', async () => {
        await seed(ZED);
        await seed(AMY);
        const out = await saves.mutatePlayerSaves([ZED, AMY], () => ({ ok: false, status: 409, error: 'refused' }));
        assert.deepEqual(out, { ok: false, status: 409, error: 'refused' });
        assert.equal((await stored(ZED))._saveVersion, 5);
        assert.equal((await stored(AMY))._saveVersion, 5);
    });

    it('a lost compare-and-set on the first write commits nothing and stays retryable', async () => {
        await seed(ZED);
        await seed(AMY);
        await assert.rejects(
            withSaveWrites(async () => false, () => saves.mutatePlayerSaves([ZED, AMY], transfer(ZED, AMY, 300))),
            /player-save-version-conflict/,
        );
        assert.equal(await ryo(ZED), 1_000);
        assert.equal(await ryo(AMY), 1_000);
    });

    it('a failure after the first write committed is a partial commit, never a retryable conflict', async () => {
        await seed(ZED);
        await seed(AMY);
        const failure = await withSaveWrites(async (original, key, expected, value, options) => key === `save:${AMY}`
            ? false
            : original.call(kv, key, expected, value, options),
        () => saves.mutatePlayerSaves([ZED, AMY], transfer(ZED, AMY, 300))).then(() => null, (error: unknown) => error);

        assert.ok(failure instanceof saves.PlayerSavesPartialCommitError, String(failure));
        assert.deepEqual(failure.committed, [ZED]);
        assert.equal(failure.failed, AMY);
        assert.notEqual((failure as Error).message, 'player-save-version-conflict');
        assert.equal(await ryo(ZED), 700, 'the committed debit stands');
        assert.equal(await ryo(AMY), 1_000, 'the failed credit is not there');
    });

    it('lock contention aborts before any save is read or written', async () => {
        await seed(ZED);
        await seed(AMY);
        await kv.set(`lock:save:${ZED}`, 'another-holder', { nx: true, ex: 30 });
        let decided = false;
        await assert.rejects(saves.mutatePlayerSaves([ZED, AMY], (sides) => { decided = true; return transfer(ZED, AMY, 1)(sides); }));
        assert.equal(decided, false);
        assert.equal((await stored(ZED))._saveVersion, 5);
        assert.equal((await stored(AMY))._saveVersion, 5);
        assert.equal(await kv.get(`lock:save:${AMY}`), null, 'the lock it did take is released');
    });

    it("runs each side's afterCommit right after its own write, then the final one, all under the locks", async () => {
        await seed(ZED);
        await seed(AMY);
        const events: string[] = [];
        const locked = async () => Boolean(await kv.get(`lock:save:${ZED}`)) && Boolean(await kv.get(`lock:save:${AMY}`));
        await withSaveWrites(async (original, key, expected, value, options) => {
            events.push(`write ${key.slice('save:'.length)}`);
            return original.call(kv, key, expected, value, options);
        }, () => saves.mutatePlayerSaves([ZED, AMY], (sides) => ({
            ok: true,
            value: null,
            sides: {
                [ZED]: {
                    character: { ...sides[ZED]!.character, ryo: 1 },
                    afterCommit: async (committed) => { events.push(`after ${ZED} v${committed._saveVersion} locked=${await locked()}`); },
                },
                [AMY]: {
                    character: { ...sides[AMY]!.character, ryo: 2 },
                    afterCommit: async () => { events.push(`after ${AMY}`); },
                },
            },
            afterCommit: async (all) => { events.push(`final ${Object.keys(all).sort().join('+')} locked=${await locked()}`); },
        })));
        assert.deepEqual(events, [
            `write ${ZED}`, `after ${ZED} v6 locked=true`, `write ${AMY}`, `after ${AMY}`,
            `final ${AMY}+${ZED} locked=true`,
        ]);
    });

    it("a side's afterCommit that fails with a save still unwritten is a partial commit", async () => {
        await seed(ZED);
        await seed(AMY);
        const failure = await saves.mutatePlayerSaves([ZED, AMY], (sides) => ({
            ok: true,
            value: null,
            sides: {
                [ZED]: { character: { ...sides[ZED]!.character, ryo: 1 }, afterCommit: () => { throw new Error('journal down'); } },
                [AMY]: { character: { ...sides[AMY]!.character, ryo: 2 } },
            },
        })).then(() => null, (error: unknown) => error);
        assert.ok(failure instanceof saves.PlayerSavesPartialCommitError, String(failure));
        assert.deepEqual(failure.committed, [ZED]);
        assert.equal(failure.failed, AMY);
        assert.equal(await ryo(ZED), 1);
        assert.equal(await ryo(AMY), 1_000, 'the next write is never attempted');
    });

    it('a final afterCommit that fails reaches the caller with every save committed', async () => {
        await seed(ZED);
        await seed(AMY);
        await assert.rejects(saves.mutatePlayerSaves([ZED, AMY], (sides) => ({
            ok: true,
            value: null,
            sides: {
                [ZED]: { character: { ...sides[ZED]!.character, ryo: 1 } },
                [AMY]: { character: { ...sides[AMY]!.character, ryo: 2 } },
            },
            afterCommit: () => { throw new Error('completion down'); },
        })), /completion down/);
        assert.equal(await ryo(ZED), 1);
        assert.equal(await ryo(AMY), 2);
    });

    it('refuses the same save on both sides', async () => {
        await assert.rejects(saves.mutatePlayerSaves([ZED, ZED], transfer(ZED, ZED, 1)), /distinct saves/);
    });
});
