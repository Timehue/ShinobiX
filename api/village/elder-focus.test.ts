import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'elder-focus-tests-session-secret';

let kv: typeof import('../_storage.js').kv;
let handler: typeof import('./elder-focus.js').default;
let token: typeof import('../_auth.js').issuePlayerToken;
let reconcile: typeof import('./_elders.js').reconcileElderFocus;
let mutate: typeof import('../save/_mutate-player-save.js').mutatePlayerSave;
let settleRead: typeof import('../_elapsed-state.js').settleSaveRecordForRead;
let validateState: typeof import('../_village-state-validate.js').validateVillageStateWrite;
const village = 'Frostfang Village';
const stateKey = 'game:village-state:frostfangvillage';
const kageKey = 'village:kage:frostfang-village';
async function council(seats: [string, string, string]) {
    const startedAt = Math.floor(Date.now() / 86400000) * 86400000;
    await kv.set('village:elder-council:frostfangvillage', { version: 1, startedAt,
        nextSelectionAt: startedAt + 30 * 86400000, seats, winningScores: [1, 1] });
}


before(async () => {
    ({ kv } = await import('../_storage.js'));
    handler = (await import('./elder-focus.js')).default as unknown as typeof handler;
    token = (await import('../_auth.js')).issuePlayerToken;
    reconcile = (await import('./_elders.js')).reconcileElderFocus;
    mutate = (await import('../save/_mutate-player-save.js')).mutatePlayerSave;
    settleRead = (await import('../_elapsed-state.js')).settleSaveRecordForRead;
    validateState = (await import('../_village-state-validate.js')).validateVillageStateWrite;
});

async function seed(name: string, extra: Record<string, unknown> = {}) {
    const { PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js');
    const record = { _saveVersion: 1, _saveAt: Date.now(), character: {
        name, village, level: 13, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, ryo: 1000, pets: [],
        petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, ...extra,
    } };
    await kv.set(`save:${name}`, record);
    return record;
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const name of ['kage', 'rin', 'mei', 'villager']) await seed(name);
    await seed('outsider', { village: 'Stormveil Village' });
    await kv.set(kageKey, { seatedKage: 'kage', kageSystemUnlocked: true });
    await kv.set(stateKey, { seatedKage: 'villager', treasury: { ryo: 123 }, elderAppointees: ['', '', ''] });
});

async function request(name: string | null, body: Record<string, unknown> = {}, method = 'POST', endpoint = handler) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = {
        setHeader() { return res; },
        status(status: number) { out.status = status; return res; },
        json(value: Record<string, any>) { out.body = value; return res; },
        end() { return res; },
    };
    await endpoint({ method, body: { playerName: name ?? 'villager', focus: 'trade', ...body },
        query: { playerName: name ?? 'villager' }, headers: name ? { 'x-player-token': token(name) } : {},
        socket: { remoteAddress: '127.0.0.88' },
    } as never, res as never);
    return out;
}

test('AI seats expose no focus, reject direct selection, and require authentication', async () => {
    assert.equal((await request(null)).status, 401);
    assert.equal((await request('villager', {}, 'DELETE')).status, 405);
    assert.equal((await request('villager', { focus: 'forged' })).status, 400);
    const get = await request('villager', {}, 'GET');
    assert.deepEqual(get.body.elderAppointees, ['', '', '']);
    for (const focus of ['war', 'trade', 'training']) assert.equal((await request('villager', { focus })).status, 403);
    assert.equal((await kv.get<any>('save:villager')).character.elderFocus, undefined);
});

test('only the authoritative seated Kage can appoint or clear a real village player', async () => {
    const appointment = { action: 'appoint', appointee: 'rin', focus: 'war' };
    assert.equal((await request('villager', appointment)).status, 403, 'the village-state Kage mirror is not authority');
    assert.equal((await request('kage', { ...appointment, appointee: 'Elder Sova' })).status, 400);
    assert.equal((await request('kage', { ...appointment, appointee: 'outsider' })).status, 400);
    assert.equal((await request('kage', appointment)).status, 200);
    assert.deepEqual((await kv.get<any>('village:elder-council:frostfangvillage')).seats, ['rin', '', '']);
    assert.equal((await kv.get<any>(stateKey)).treasury.ryo, 123);
    assert.equal((await request('kage', { ...appointment, focus: 'training' })).status, 403, 'Kage cannot override elected seats');
    assert.equal((await request('rin', { action: 'clear', focus: 'war' })).status, 403);
    assert.equal((await request('kage', { action: 'clear', focus: 'war' })).status, 200);
});

test('a player-filled seat unlocks only its focus, with idempotent repeated selection', async () => {
    await council(['', 'rin', '']);
    const chosen = await request('villager');
    assert.equal(chosen.status, 200);
    assert.equal(chosen.body.character.elderFocus, 'trade');
    assert.equal(chosen.body.unchanged, false);
    const again = await request('villager');
    assert.equal(again.body.unchanged, true);
    assert.equal(again.body._saveVersion, chosen.body._saveVersion);
    assert.equal((await request('villager', { focus: 'training' })).status, 403);
    assert.equal((await request('villager', { playerName: 'mei' })).status, 401);
});

test('clearing an elder removes the stale bonus before the next authoritative purchase', async () => {
    await council(['', 'rin', '']);
    await request('villager');
    await council(['', '', '']);
    const { shopDiscountPercent } = await import('../shop/_settlement.js');
    const result = await mutate('villager', ({ character }) => ({ ok: true, character,
        value: { discount: shopDiscountPercent(character, 'ryo') } }));
    assert.equal(result.ok, true);
    if (result.ok) {
        assert.equal(result.value.discount, 0);
        assert.equal(result.character.elderFocus, undefined);
    }
    assert.equal((await kv.get<any>('save:villager')).character.elderFocus, undefined);
    assert.equal((await request('villager')).status, 403);
});

test('an elder leaving the village or losing their save disables the seat', async () => {
    await council(['', 'rin', '']);
    await request('villager');
    await seed('rin', { village: 'Stormveil Village' });
    assert.deepEqual((await request('villager', {}, 'GET')).body.elderAppointees, ['', '', '']);
    assert.equal((await request('villager')).status, 403);
    await kv.del('save:rin');
    const character = (await kv.get<any>('save:villager')).character;
    assert.equal((await reconcile(character)).elderFocus, undefined);
});

test('training seals no legacy AI bonus and grants the bonus only with a player training elder', async () => {
    const start = (await import('../training/start.js')).default as unknown as typeof handler;
    await seed('villager', { elderFocus: 'training' });
    const withoutElder = await request('villager', { stat: 'strength', tierId: '15m' }, 'POST', start);
    assert.equal(withoutElder.status, 200);
    assert.equal(withoutElder.body.bonusPct, 0);
    assert.equal(withoutElder.body.character.elderFocus, undefined);
    await council(['', '', 'rin']);
    await request('mei', { focus: 'training' });
    const withElder = await request('mei', { stat: 'strength', tierId: '15m' }, 'POST', start);
    assert.equal(withElder.status, 200);
    assert.equal(withElder.body.bonusPct, 10);
});

test('owner reads migrate old AI focus saves with a version bump; foreign reads only project', async () => {
    const record = await seed('villager', { elderFocus: 'training' });
    const preview = await settleRead('villager', record, { persist: false });
    assert.equal((preview.record.character as Record<string, unknown>).elderFocus, undefined);
    assert.equal((await kv.get<any>('save:villager')).character.elderFocus, 'training');
    const settled = await settleRead('villager', record, { persist: true });
    assert.equal((settled.record.character as Record<string, unknown>).elderFocus, undefined);
    assert.ok(Number(settled.record._saveVersion) > 1);
    assert.equal((await kv.get<any>('save:villager')).character.elderFocus, undefined);
});

test('generic village saves cannot forge, replace or restore appointments, including Kage/admin saves', async () => {
    for (const isAdmin of [false, true]) {
        const prev = { elderAppointees: ['', '', ''] };
        const out = await validateState(prev, { elderAppointees: ['rin', 'mei', 'villager'] },
            { callerName: 'kage', isAdmin, village }, { seatedKage: 'kage' });
        assert.deepEqual(out.next.elderAppointees, prev.elderAppointees);
        assert.ok(out.suppressed.some(reason => reason.includes('elderAppointees')));
    }
});

test('real jutsu starts and queues derive focus speed from the seat, ignoring submitted bonuses', async () => {
    const jutsu = (await import('../training/jutsu-ryo.js')).default as unknown as typeof handler;
    const jutsuId = 'starter-nin-earth-1';
    await seed('villager', { ryo: 50_000, elderFocus: 'training', jutsuMastery: [{ jutsuId, level: 1 }] });
    const start = await request('villager', { action: 'start', requestId: 'jutsu-start-00001', jutsuId, trainingBonusPct: 60 }, 'POST', jutsu);
    assert.equal(start.status, 200, JSON.stringify(start.body));
    assert.equal(start.body.activeJutsuTraining.endsAt - start.body.activeJutsuTraining.startedAt, 600_000);
    await council(['', '', 'rin']);
    await request('villager', { focus: 'training' });
    const queue = await request('villager', { action: 'queue', requestId: 'jutsu-queue-00001', jutsuId,
        serverToken: start.body.activeJutsuTraining.serverToken, trainingBonusPct: 60 }, 'POST', jutsu);
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    assert.equal(queue.body.activeJutsuTraining.next.durationMs, 540_000);
});

test('defense focus requires a real elder and an active war with the opponent village', async () => {
    const { elderWarDefensePct } = await import('./_elder-defense.js');
    const enemy = 'Stormveil Village';
    const warKey = 'world:war:frostfangvillage-vs-stormveilvillage';
    const war = { id: 'frostfangvillage-vs-stormveilvillage', villages: [village, enemy], startedAt: Date.now() - 1000 };
    const character = { village, elderFocus: 'war' };
    await kv.set(warKey, war);
    assert.equal(await elderWarDefensePct(character, enemy), 0);
    await request('kage', { action: 'appoint', appointee: 'rin', focus: 'war' });
    assert.equal(await elderWarDefensePct(character, enemy), 1);
    assert.equal(await elderWarDefensePct(character, village), 0);
    assert.equal(await elderWarDefensePct(character, 'Moonshadow Village'), 0);
    for (const patch of [{ endedAt: Date.now() }, { pendingUntil: Date.now() + 60_000 }, { declarationFunding: { status: 'funding' } }]) {
        await kv.set(warKey, { ...war, ...patch });
        assert.equal(await elderWarDefensePct(character, enemy), 0);
    }
    await kv.set(warKey, war);
    await request('kage', { action: 'clear', focus: 'war' });
    assert.equal(await elderWarDefensePct(character, enemy), 0);
});

test('real shop purchases use the occupied trade seat and stop discounting after removal', async () => {
    const shop = (await import('../shop/purchase.js')).default as unknown as typeof handler;
    await seed('villager', { ryo: 1000, fateShards: 1000, inventory: [] });
    await council(['', 'rin', '']);
    await request('villager');
    const discounted = await request('villager', { requestId: 'elder-shop-00001', itemId: 'shinobi-vest', qty: 1 }, 'POST', shop);
    assert.equal(discounted.status, 200, JSON.stringify(discounted.body));
    assert.equal(discounted.body.character.ryo, 829);
    await council(['', '', '']);
    const regular = await request('villager', { requestId: 'elder-shop-00002', itemId: 'golden-apple', qty: 1 }, 'POST', shop);
    assert.equal(regular.status, 200, JSON.stringify(regular.body));
    assert.equal(regular.body.character.fateShards, 980);
    assert.equal(regular.body.character.elderFocus, undefined);
});
