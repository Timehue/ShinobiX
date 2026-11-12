import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let leaders: typeof import('./_npc-village-leaders.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    leaders = await import('./_npc-village-leaders.js');
});
beforeEach(async () => {
    await kv.del(leaders.NPC_KAGE_SEAT_KEY);
    for (const v of ['Frostfang Village', 'Stormveil Village', 'Ashen Leaf Village', 'Moonshadow Village']) await kv.del(leaders.npcLeaderKey(v));
});

test('the seats start empty', async () => {
    assert.deepEqual(await leaders.readNpcLeaders(), []);
});

test('the first defeated Kage takes the Kage seat; the next three become elders', async () => {
    const first = await leaders.recordStoryKageDefection('Frostfang Village', 'alice', 1);
    assert.equal(first?.seat, 'kage');
    assert.equal(first?.name, 'Kage Kael Whitefang, Hollow Oath Tyrant');
    assert.equal((await leaders.recordStoryKageDefection('Moonshadow Village', 'bob', 2))?.seat, 'elder');
    assert.equal((await leaders.recordStoryKageDefection('Stormveil Village', 'cara', 3))?.seat, 'elder');
    assert.equal((await leaders.recordStoryKageDefection('Ashen Leaf Village', 'dan', 4))?.seat, 'elder');
    const seated = await leaders.readNpcLeaders();
    assert.deepEqual(seated.map((s) => [s.seat, s.village]), [
        ['kage', 'Frostfang Village'], ['elder', 'Moonshadow Village'], ['elder', 'Stormveil Village'], ['elder', 'Ashen Leaf Village'],
    ]);
});

test('a later finale against the same Kage never moves a seat, and non-finale villages are ignored', async () => {
    await leaders.recordStoryKageDefection('Stormveil Village', 'alice', 1);
    assert.equal(await leaders.recordStoryKageDefection('Stormveil Village', 'bob', 2), null);
    assert.equal(await leaders.recordStoryKageDefection('Cinderhold Village', 'bob', 3), null);
    assert.equal(await leaders.recordStoryKageDefection('Nowhere', 'bob', 4), null);
    const seated = await leaders.readNpcLeaders();
    assert.equal(seated.length, 1);
    assert.equal(seated[0]!.defeatedBy, 'alice');
});

test('a failed write leaves no half-seated arrival, and the retry still takes the Kage seat', async () => {
    const real = kv.compareSetMany!.bind(kv);
    kv.compareSetMany = async () => { throw new Error('storage down'); };
    try {
        await assert.rejects(leaders.recordStoryKageDefection('Frostfang Village', 'alice', 1));
    } finally { kv.compareSetMany = real; }
    assert.equal(await kv.get(leaders.npcLeaderKey('Frostfang Village')), null);
    assert.equal(await kv.get(leaders.NPC_KAGE_SEAT_KEY), null);
    // Another village arriving first now rightly takes the seat; the retry is an elder.
    assert.equal((await leaders.recordStoryKageDefection('Moonshadow Village', 'bob', 2))?.seat, 'kage');
    assert.equal((await leaders.recordStoryKageDefection('Frostfang Village', 'alice', 3))?.seat, 'elder');
});

test('two finales landing at once produce exactly one Kage', async () => {
    const results = await Promise.all([
        leaders.recordStoryKageDefection('Frostfang Village', 'a', 1),
        leaders.recordStoryKageDefection('Moonshadow Village', 'b', 1),
    ]);
    assert.equal(results.filter((r) => r?.seat === 'kage').length, 1);
    assert.equal(results.filter((r) => r?.seat === 'elder').length, 1);
});
