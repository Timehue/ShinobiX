import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'leadership-integration-tests-secret';

let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let anbu: typeof import('./anbu.js').default;
let elders: typeof import('./elder-focus.js').default;
let orders: typeof import('./orders.js').default;
let upgrade: typeof import('./upgrade.js').default;
let gate: typeof import('./hollow-gate-unlock.js').default;
let terrain: typeof import('./war-terrain.js').default;
let exam: typeof import('../exams/pass.js').default;
let roles: typeof import('../_war-role.js');
let roster: typeof import('./_anbu.js').readVillageAnbu;
let seedIndex: typeof import('../player/_public-index.js').buildPublicPlayerIndexEntry;
const village = 'Frostfang Village';
const stateKey = 'game:village-state:frostfangvillage';
const kageKey = 'village:kage:frostfang-village';

before(async () => {
    ({ kv } = await import('../_storage.js'));
    token = (await import('../_auth.js')).issuePlayerToken;
    anbu = (await import('./anbu.js')).default as unknown as typeof anbu;
    elders = (await import('./elder-focus.js')).default as unknown as typeof elders;
    orders = (await import('./orders.js')).default as unknown as typeof orders;
    upgrade = (await import('./upgrade.js')).default as unknown as typeof upgrade;
    gate = (await import('./hollow-gate-unlock.js')).default as unknown as typeof gate;
    terrain = (await import('./war-terrain.js')).default as unknown as typeof terrain;
    exam = (await import('../exams/pass.js')).default as unknown as typeof exam;
    roles = await import('../_war-role.js');
    roster = (await import('./_anbu.js')).readVillageAnbu;
    seedIndex = (await import('../player/_public-index.js')).buildPublicPlayerIndexEntry;
});

async function seed(name: string, extra: Record<string, unknown> = {}) {
    const character = { name, village, level: 90, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, pets: [], ryo: 500000, honorSeals: 30000,
        examsPassed: ['genin', 'chunin', 'jonin'], totalPvpKills: 100, ...extra };
    await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), character });
    await kv.hset('player:registry', { [name]: seedIndex(character, name) });
}

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    const { __clearProcCache } = await import('../_proc-cache.js');
    __clearProcCache();
    for (const name of ['kage', 'elder', 'operative', 'villager', 'newkage']) await seed(name);
    await seed('outsider', { village: 'Stormveil Village' });
    await kv.set(kageKey, { seatedKage: 'kage', kageSystemUnlocked: true });
    await kv.set(stateKey, { seatedKage: 'villager', treasury: { honorSeals: 1000 }, elderAppointees: ['', '', ''], anbuAppointees: ['', '', ''] });
});

async function request(endpoint: typeof anbu, name: string | null, body: Record<string, unknown> = {}, method = 'POST') {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader() { return res; }, status(code: number) { out.status = code; return res; },
        json(value: Record<string, any>) { out.body = value; return res; }, end() { return res; } };
    await endpoint({ method, body: { village, playerName: name ?? 'villager', ...body }, query: { playerName: name ?? 'villager' },
        headers: name ? { 'x-player-token': token(name) } : {}, socket: { remoteAddress: '127.0.0.93' },
    } as never, res as never);
    return out;
}

test('ANBU appointments require the real Kage, valid seats, and a real member', async () => {
    const action = { action: 'appoint', seat: 0, appointee: 'operative' };
    assert.equal((await request(anbu, null, action)).status, 401);
    assert.equal((await request(anbu, 'villager', action)).status, 403, 'stale cached Kage is powerless');
    assert.equal((await request(anbu, 'kage', { ...action, seat: 3 })).status, 400);
    for (const appointee of ['outsider', 'AI Elder']) assert.equal((await request(anbu, 'kage', { ...action, appointee })).status, 400);
    assert.equal((await request(anbu, 'kage', action)).status, 200);
    assert.equal((await request(anbu, 'kage', { ...action, seat: 1 })).status, 409);
    assert.deepEqual((await roster(village)).appointed, ['operative', '', '']);
});

test('concurrent appointments preserve other seats and unrelated village data', async () => {
    const outcomes = await Promise.all([
        request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' }),
        request(anbu, 'kage', { action: 'appoint', seat: 1, appointee: 'elder' }),
    ]);
    assert.ok(outcomes.every(out => out.status === 200));
    assert.deepEqual((await roster(village)).appointed, ['operative', 'elder', '']);
    assert.equal((await kv.get<any>(stateKey)).treasury.honorSeals, 1000);
});

test('appointments grant orders and war weight; clearing and stale writes cannot keep those powers', async () => {
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' });
    assert.deepEqual(await roles.sectorWarRoleOf('operative', village), roles.ROLE_ANBU);
    const order = { action: 'post', id: 'defend-gate', type: 'general', title: 'Defend the gate', body: 'Gather at the village gate.' };
    assert.equal((await request(orders, 'operative', order)).status, 200);
    await request(anbu, 'kage', { action: 'clear', seat: 0 });
    const { validateVillageStateWrite } = await import('../_village-state-validate.js');
    const checked = await validateVillageStateWrite(await kv.get<any>(stateKey), { anbuAppointees: ['operative'], anbuMembers: ['operative'] }, { callerName: 'kage', village, isAdmin: false }, { seatedKage: 'kage' });
    await kv.set(stateKey, checked.next);
    assert.deepEqual((await roster(village)).members, []);
    assert.equal((await request(orders, 'operative', order)).status, 403);
    assert.deepEqual(await roles.sectorWarRoleOf('operative', village), roles.ROLE_VILLAGER);
});

test('all seven earned seats have real ANBU powers and rotate at UTC month rollover', async t => {
    t.mock.method(Date, 'now', () => Date.UTC(2026, 8, 30, 23, 59));
    for (let i = 0; i < 9; i++) await seed(`fighter${i}`, { monthlyPvpKills: 9 - i, pvpKillMonth: '2026-09' });
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'fighter0' });
    assert.deepEqual((await roster(village)).earned, ['fighter1', 'fighter2', 'fighter3', 'fighter4', 'fighter5', 'fighter6', 'fighter7']);
    assert.deepEqual(await roles.sectorWarRoleOf('fighter1', village), roles.ROLE_ANBU);
    assert.equal((await request(orders, 'fighter1', { action: 'post', id: 'patrol-gate', type: 'general', title: 'Patrol', body: 'Patrol the gate.' })).status, 200);
    const { loadAnbuAppointees } = await import('../_anbu-infiltration-store.js');
    assert.deepEqual(await loadAnbuAppointees(village), (await roster(village)).members, 'garrisons and infiltration share the complete roster');
    t.mock.method(Date, 'now', () => Date.UTC(2026, 9, 1, 0, 1));
    assert.deepEqual((await roster(village)).members, ['fighter0'], 'appointed seats survive monthly rollover');
    assert.deepEqual(await roles.sectorWarRoleOf('fighter1', village), roles.ROLE_VILLAGER);
});

test('village changes remove appointed and earned powers and do not block the next candidate', async () => {
    for (let i = 0; i < 8; i++) await seed(`fighter${i}`, { monthlyPvpKills: 9 - i, pvpKillMonth: new Date().toISOString().slice(0, 7) });
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' });
    for (const name of ['operative', 'fighter0']) {
        const saved = await kv.get<any>(`save:${name}`);
        await kv.set(`save:${name}`, { ...saved, character: { ...saved.character, village: 'Stormveil Village' } });
    }
    const list = await roster(village);
    assert.deepEqual(list.appointed, ['', '', '']);
    assert.equal(list.earned.length, 7);
    assert.equal(list.earned.includes('fighter0'), false);
    assert.equal(list.earned.includes('fighter7'), true);
});

test('succession preserves appointments, transfers management, and role weights never stack', async () => {
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'elder' });
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' });
    assert.deepEqual(await roles.sectorWarRoleOf('elder', village), roles.ROLE_ELDER);
    await kv.set(kageKey, { seatedKage: 'elder', kageSystemUnlocked: true });
    assert.deepEqual(await roles.sectorWarRoleOf('elder', village), roles.ROLE_KAGE);
    assert.equal((await request(anbu, 'kage', { action: 'clear', seat: 0 })).status, 403);
    assert.equal((await request(anbu, 'elder', { action: 'clear', seat: 0 })).status, 200);
    assert.equal((await kv.get<any>('village:elder-council:frostfangvillage')).seats[0], 'elder');
    const evidence = { version: 1 as const, sealedAt: 123, p1: { village, role: roles.ROLE_ELDER }, p2: { village: 'Stormveil Village', role: roles.ROLE_VILLAGER } };
    assert.deepEqual(roles.sealedSectorWarRoleOf(evidence, 'p1', village, 123), roles.ROLE_ELDER, 'a later promotion does not rewrite sealed battle weights');
});

test('special Jonin recognizes real Elders and Kage, not ANBU or a stale Kage mirror', async () => {
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' });
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' });
    for (const name of ['operative', 'villager']) assert.equal((await request(exam, name, { examKey: 'specialJonin' })).status, 409);
    for (const name of ['elder', 'kage']) assert.equal((await request(exam, name, { examKey: 'specialJonin' })).status, 200);
});

test('terrain belongs to Kage and Elders with separate quotas; ANBU cannot set it', async () => {
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' });
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' });
    const { HOME_SECTORS } = await import('../_war-map-sectors.js');
    const sectors = HOME_SECTORS[village];
    const change = { sector: sectors[0], terrain: 'snow' };
    assert.equal((await request(terrain, 'operative', change)).status, 403);
    assert.equal((await request(terrain, 'elder', change)).status, 200);
    assert.equal((await request(terrain, 'elder', { ...change, sector: sectors[1] })).status, 409);
    for (const sector of sectors.slice(1, 4)) assert.equal((await request(terrain, 'kage', { ...change, sector })).status, 200);
    assert.equal((await request(terrain, 'kage', { ...change, sector: sectors[4] })).status, 409);
});

test('only the current Kage can spend village funds or pay to extend the Hollow Gate', async () => {
    assert.equal((await request(upgrade, 'villager', { key: 'training' })).status, 403);
    assert.equal((await request(gate, 'villager')).status, 403);
    assert.equal((await request(upgrade, 'kage', { key: 'training' })).status, 200);
    assert.equal((await kv.get<any>(stateKey)).treasury.honorSeals, 990);
    const first = await request(gate, 'kage');
    assert.equal(first.status, 200);
    const second = await request(gate, 'kage');
    assert.equal(second.status, 200);
    assert.equal(second.body.hollowGateUnlockedUntil - first.body.hollowGateUnlockedUntil, 30 * 86400000);
    assert.equal((await kv.get<any>('save:kage')).character.honorSeals, 10000);
});

test('new Elders can inherit former leaders terrain while current quotas and authority remain enforced', async () => {
    const { HOME_SECTORS } = await import('../_war-map-sectors.js');
    const { villageWarKey } = await import('../_war-state.js');
    const sectors = HOME_SECTORS[village];
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' });
    assert.equal((await request(terrain, 'elder', { sector: sectors[0], terrain: 'snow' })).status, 200);
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'newkage' });
    assert.equal((await request(terrain, 'elder', { sector: sectors[0], terrain: 'forest' })).status, 403);
    assert.equal((await kv.get<any>(villageWarKey(village))).sectors[String(sectors[0])].terrain, 'snow', 'changing office preserves the terrain');
    assert.equal((await request(terrain, 'newkage', { sector: sectors[0], terrain: 'forest' })).status, 200);
    assert.equal((await request(terrain, 'newkage', { sector: sectors[1], terrain: 'snow' })).status, 409);
});

test('shared village display includes leadership before the first generic village save', async () => {
    await kv.del(stateKey);
    assert.equal((await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' })).status, 200);
    assert.equal(await kv.get(stateKey), null);
    const frame = (await import('../game-state.js')).default as unknown as typeof anbu;
    const state = (await request(frame, 'villager', {}, 'GET')).body.villageStates.frostfangvillage;
    assert.equal(state.seatedKage, 'kage');
    assert.deepEqual(state.elderAppointees, ['elder', '', '']);
    assert.ok(state.elderTerm.nextSelectionAt > Date.now());
});

test('shared frame clears stale Kage seats and returns the same verified ANBU and elder rosters', async () => {
    await request(anbu, 'kage', { action: 'appoint', seat: 0, appointee: 'operative' });
    await request(elders, 'kage', { action: 'appoint', focus: 'war', appointee: 'elder' });
    await kv.set(kageKey, { kageSystemUnlocked: true });
    const frame = (await import('../game-state.js')).default as unknown as typeof anbu;
    const state = (await request(frame, 'villager', {}, 'GET')).body.villageStates.frostfangvillage;
    assert.equal(state.seatedKage, undefined);
    assert.equal(state.kageSystemUnlocked, true);
    assert.deepEqual(state.anbuMembers, ['operative']);
    assert.deepEqual(state.elderAppointees, ['elder', '', '']);
});

test('committed PvP rewards refresh earned seats before the next client autosave', async () => {
    const { mutatePlayerSave } = await import('../save/_mutate-player-save.js');
    assert.equal((await roster(village)).members.includes('operative'), false);
    const result = await mutatePlayerSave('operative', ({ character }) => ({ ok: true as const, character: {
        ...character, monthlyPvpKills: 1, pvpKillMonth: new Date().toISOString().slice(0, 7), totalPvpKills: 101,
    }, value: {} }));
    assert.equal(result.ok, true);
    assert.equal((await roster(village)).earned.includes('operative'), true);
});
