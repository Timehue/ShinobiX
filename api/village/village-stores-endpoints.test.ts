import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'village-stores-test-admin';
process.env.SESSION_SECRET = 'village-stores-test-secret-32-bytes-long';

/*
 * Village Stores endpoint wiring (memory KV): the sector-war `garrison-feed`
 * action (permissions + toggle), the war-structure materials gate (L6+ refuse /
 * accept), the cafeteria COOK path (recipes + daily cap), and the kill switch.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const SECTOR = 26;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';
const CONTEST_ID = `${SECTOR}:moonshadowvillage-vs-frostfangvillage`;
const CONTEST_KEY = `shared:sector-war:${CONTEST_ID}`;
const FROST_STATE = 'game:village-state:frostfangvillage';
const FROST_WAR = 'shared:village-war:frostfangvillage';
const FROST_KAGE_KEY = 'village:kage:frostfang-village';
const FROST_CHAT_KEY = 'chat:village:frostfang-village';

let sectorWar: Handler;
let warStructure: Handler;
let cafeteria: Handler;
type KvLike = import('../_storage.js').KvLike;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    sectorWar = (await import('./sector-war.js')).default as unknown as Handler;
    warStructure = (await import('./war-structure.js')).default as unknown as Handler;
    cafeteria = (await import('../player/cafeteria.js')).default as unknown as Handler;
});
beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.DISABLE_VILLAGE_STORES;
});
after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_VILLAGE_STORES;
});

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}
async function call(handler: Handler, body: Record<string, unknown>): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const playerName = String(body.playerName ?? '');
    const token = issuePlayerToken(playerName) ?? '';
    const req = { method: 'POST', body, headers: { 'x-player-name': playerName, 'x-player-token': token }, socket: { remoteAddress: '127.0.0.1' } } as never;
    await handler(req, res);
    return out;
}
async function seedPlayer(name: string, village: string, over: Record<string, unknown> = {}) {
    await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, village, level: 50, ryo: 1000, maxHp: 100, hp: 100, maxChakra: 100, maxStamina: 100, stats: {}, jutsu: [], equipment: {}, inventory: [], itemStacks: [], ...over } });
}
function contest(now: number, over: Record<string, unknown> = {}) {
    const startedAt = now - 60 * 60 * 1000;
    return { id: CONTEST_ID, sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: DEFENDER, winCondition: 'combat', attackerPoints: 0, defenderPoints: 0, startedAt, endsAt: startedAt + 72 * 60 * 60 * 1000, updatedAt: startedAt, flipped: false, ...over };
}

describe('sector-war garrison-feed (Village Stores)', { concurrency: false }, () => {
    type Feed = Record<string, { on: boolean; covered: boolean; by: string }>;
    it('refuses a plain villager and a non-participant Kage; each side toggles ONLY its own entry, so the enemy cannot switch a village\'s feed off', async () => {
        const now = Date.now();
        await kv.set(CONTEST_KEY, contest(now));
        await kv.set(FROST_KAGE_KEY, { seatedKage: 'frostkage' });
        await kv.set('game:village-state:moonshadowvillage', { anbuAppointees: ['moonanbu'] });
        await kv.set('village:kage:ember-village', { seatedKage: 'emberkage' });
        for (const n of ['villager', 'frostkage', 'moonanbu']) await seedPlayer(n, n === 'moonanbu' ? ATTACKER : DEFENDER);
        await seedPlayer('emberkage', 'Ember Village');

        const denied = await call(sectorWar, { action: 'garrison-feed', playerName: 'villager', sectorWarId: CONTEST_ID, on: true });
        assert.equal(denied.statusCode, 403);
        const outsider = await call(sectorWar, { action: 'garrison-feed', playerName: 'emberkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(outsider.statusCode, 403, 'a Kage of a village not in this war is refused');

        const on = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(on.statusCode, 200, JSON.stringify(on.body));
        assert.equal(on.body?.village, DEFENDER);
        assert.equal(on.body?.garrisonFed, true);
        const c = on.body?.contest as Record<string, unknown>;
        assert.equal(c.garrisonFed, true, 'the caller\'s own entry is mirrored onto the flat compat fields');
        assert.equal(c.garrisonFedBy, DEFENDER);
        assert.equal((c.garrisonFeed as Feed)[DEFENDER].on, true);
        assert.equal((c.garrisonFeed as Feed)[ATTACKER], undefined);
        assert.equal('appliedBattles' in c, false, 'client projection');
        let stored = await kv.get<{ garrisonFeed?: Feed; garrisonFed?: unknown }>(CONTEST_KEY);
        assert.equal(stored?.garrisonFeed?.[DEFENDER].on, true);
        assert.equal(stored?.garrisonFeed?.[DEFENDER].by, 'frostkage');
        assert.equal(stored?.garrisonFed, undefined, 'the legacy single flag is no longer written');

        // The ATTACKER's ANBU turning "off" only writes Moonshadow's own entry - Frostfang's stays on.
        const off = await call(sectorWar, { action: 'garrison-feed', playerName: 'moonanbu', sectorWarId: CONTEST_ID, on: false });
        assert.equal(off.statusCode, 200, JSON.stringify(off.body));
        assert.equal(off.body?.village, ATTACKER);
        const offView = off.body?.contest as Record<string, unknown>;
        assert.equal(offView.garrisonFed, undefined, 'Moonshadow\'s view does not mirror Frostfang\'s feed');
        stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.equal(stored?.garrisonFeed?.[DEFENDER].on, true, 'enemy toggle cannot switch Frostfang\'s paid feed off');
        assert.equal(stored?.garrisonFeed?.[ATTACKER].on, false);

        // Each side's toggle is independent: Moonshadow on, then Frostfang off.
        const moonOn = await call(sectorWar, { action: 'garrison-feed', playerName: 'moonanbu', sectorWarId: CONTEST_ID, on: true });
        assert.equal(moonOn.statusCode, 200);
        assert.equal((moonOn.body?.contest as Record<string, unknown>).garrisonFedBy, ATTACKER);
        stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.deepEqual([stored?.garrisonFeed?.[DEFENDER].on, stored?.garrisonFeed?.[ATTACKER].on], [true, true]);
        const frostOff = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: false });
        assert.equal(frostOff.statusCode, 200);
        stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.deepEqual([stored?.garrisonFeed?.[DEFENDER].on, stored?.garrisonFeed?.[ATTACKER].on], [false, true]);
        assert.equal(stored?.garrisonFeed?.[DEFENDER].covered, false, 'a feed the daily pass never paid for stays uncovered');
    });
    it('keeps the day\'s PAID coverage across a same-day re-toggle, and never resurrects an older day\'s', async () => {
        const now = Date.now();
        const today = new Date(now).toISOString().slice(0, 10);
        const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        await kv.set(FROST_KAGE_KEY, { seatedKage: 'frostkage' });
        await seedPlayer('frostkage', DEFENDER);
        // The daily pass already burned this war's garrison rations TODAY.
        await kv.set(CONTEST_KEY, contest(now, {
            storesDate: today,
            garrisonFeed: { [DEFENDER]: { on: true, covered: true, updatedAt: now - 60_000, by: 'frostkage' } },
        }));

        const off = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: false });
        assert.equal(off.statusCode, 200, JSON.stringify(off.body));
        let stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.deepEqual(
            [stored?.garrisonFeed?.[DEFENDER].on, stored?.garrisonFeed?.[DEFENDER].covered],
            [false, true],
            'the rations are already spent — switching off must not burn them',
        );
        const backOn = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(backOn.statusCode, 200, JSON.stringify(backOn.body));
        stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.deepEqual(
            [stored?.garrisonFeed?.[DEFENDER].on, stored?.garrisonFeed?.[DEFENDER].covered],
            [true, true],
            'toggling back on the same UTC day keeps the cap the village already paid for',
        );

        // …but an entry switched off on an EARLIER day starts uncovered: today's
        // pass skipped it, so nothing was bought for today.
        await kv.set(CONTEST_KEY, contest(now, {
            storesDate: today,
            garrisonFeed: { [DEFENDER]: { on: false, covered: true, updatedAt: new Date(`${yesterday}T12:00:00.000Z`).getTime(), by: 'frostkage' } },
        }));
        const stale = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(stale.statusCode, 200, JSON.stringify(stale.body));
        stored = await kv.get<{ garrisonFeed?: Feed }>(CONTEST_KEY);
        assert.equal(stored?.garrisonFeed?.[DEFENDER].covered, false, 'yesterday\'s coverage cannot raise today\'s cap for free');
    });
    it('heralds the feed ONCE per war per day — a retried (or double-clicked) toggle does not double-post', async () => {
        const now = Date.now();
        await kv.set(FROST_KAGE_KEY, { seatedKage: 'frostkage' });
        await seedPlayer('frostkage', DEFENDER);
        await kv.set(CONTEST_KEY, contest(now));

        for (let i = 0; i < 3; i += 1) {
            const on = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
            assert.equal(on.statusCode, 200, JSON.stringify(on.body));
        }
        // The herald is fire-and-forget — let the queued writes land.
        let chat: Array<Record<string, unknown>> = [];
        for (let i = 0; i < 50 && chat.length === 0; i += 1) {
            await new Promise((r) => setTimeout(r, 10));
            chat = (await kv.get<Array<Record<string, unknown>>>(FROST_CHAT_KEY)) ?? [];
        }
        const fedLines = chat.filter((line) => String(line.text ?? '').includes('is feeding the Sector'));
        assert.equal(fedLines.length, 1, `expected exactly one Garrison-fed herald, got ${fedLines.length}`);
        assert.equal(String(fedLines[0].receiptId ?? '').endsWith(new Date(now).toISOString().slice(0, 10)), true,
            'the receipt is keyed on war + village + UTC day, so a retry dedupes');
    });
    it('is a 404 under the kill switch and a 409 on a finished war', async () => {
        const now = Date.now();
        await kv.set(FROST_KAGE_KEY, { seatedKage: 'frostkage' });
        await seedPlayer('frostkage', DEFENDER);
        await kv.set(CONTEST_KEY, contest(now, { flipped: true }));
        const over = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(over.statusCode, 409);
        process.env.DISABLE_VILLAGE_STORES = '1';
        await kv.set(CONTEST_KEY, contest(now));
        const off = await call(sectorWar, { action: 'garrison-feed', playerName: 'frostkage', sectorWarId: CONTEST_ID, on: true });
        assert.equal(off.statusCode, 404);
    });
});

describe('war-structure materials gate (Village Stores)', { concurrency: false }, () => {
    async function seed(level: number, materialPoints: number, seals = 10_000) {
        await kv.set(FROST_KAGE_KEY, { seatedKage: 'frostkage' });
        await seedPlayer('frostkage', DEFENDER);
        await kv.set(FROST_STATE, { treasury: { honorSeals: seals, materialPoints, ryo: 5 } });
        await kv.set(FROST_WAR, { warResources: 0, structures: { ramparts: 0, watchtower: 0, barracks: 0, warAcademy: 0, supplyDepot: level, treasuryVault: 0 }, sectors: {}, mercLeases: [], dormant: false, lastWarPassDate: '', terrainSetBy: {} });
    }
    it('refuses L6 without 400 points (seals untouched), accepts with them and debits + ledgers', async () => {
        await seed(5, 399);
        const short = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
        assert.equal(short.statusCode, 402);
        assert.deepEqual({ error: short.body?.error, need: short.body?.need, have: short.body?.have }, { error: 'materials-required', need: 400, have: 399 });
        const state = await kv.get<{ treasury: Record<string, number> }>(FROST_STATE);
        assert.equal(state?.treasury.honorSeals, 10_000);
        assert.equal((await kv.get<{ structures: Record<string, number> }>(FROST_WAR))?.structures.supplyDepot, 5);

        await seed(5, 400);
        const ok = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
        assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
        assert.equal(ok.body?.newLevel, 6);
        assert.equal(ok.body?.materialsSpent, 400);
        assert.equal(ok.body?.remainingMaterialPoints, 0);
        const after = await kv.get<{ treasury: Record<string, number> }>(FROST_STATE);
        assert.equal(after?.treasury.materialPoints, 0);
        assert.equal(after?.treasury.ryo, 5, 'other treasury fields preserved');
        assert.equal(after?.treasury.honorSeals, 10_000 - Number(ok.body?.cost));
        const rec = await kv.get<{ structures: Record<string, number>; storesLedger: Array<Record<string, unknown>> }>(FROST_WAR);
        assert.equal(rec?.structures.supplyDepot, 6);
        assert.deepEqual(rec?.storesLedger.map((e) => [e.kind, e.amount, e.by, e.ref]), [['structure', 400, 'frostkage', 'supplyDepot:6']]);
    });
    it('debits BEFORE it grants: a failure between the two writes leaves NO free structure, only a reconcile row', async () => {
        // The war record used to be written FIRST, so a crash between the two
        // writes minted an L6..L10 structure (up to 2,400 materials + its seal
        // cost) out of nothing. The order is now debit → grant, journalled.
        await seed(5, 400);
        const realSet = kv.set.bind(kv);
        let attemptedGrant = false;
        (kv as { set: KvLike['set'] }).set = (async (key, value, options) => {
            if (key === FROST_WAR) { attemptedGrant = true; throw new Error('kv write failed'); }
            return realSet(key, value, options);
        }) as KvLike['set'];
        try {
            const out = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
            assert.equal(out.statusCode, 500);
        } finally {
            (kv as { set: KvLike['set'] }).set = realSet;
        }
        assert.equal(attemptedGrant, true, 'the grant was attempted (and failed) after the debit');

        const rec = await kv.get<{ structures: Record<string, number> }>(FROST_WAR);
        assert.equal(rec?.structures.supplyDepot, 5, 'no free structure — the level did not move');
        const state = await kv.get<{ treasury: Record<string, number> }>(FROST_STATE);
        assert.ok((state?.treasury.honorSeals ?? 0) < 10_000, 'the seals were taken first');
        assert.equal(state?.treasury.materialPoints, 0, 'the materials were taken first');

        const { readEconomyTxSnapshot } = await import('../_economy-tx.js');
        const row = (await readEconomyTxSnapshot(50)).stuck.find((tx) => tx.kind === 'village-war-structure');
        assert.equal(row?.state, 'needs-reconcile', 'the unfinished purchase is parked for the reconciler');
        assert.equal(row?.debitKey, FROST_STATE);
        assert.equal(row?.creditKey, FROST_WAR);

        // The mirror case — the TREASURY write is the one that fails. Because it
        // now goes first, the structure is simply never granted; under the old
        // order this was the free-mint window.
        await seed(5, 400);
        const realSet2 = kv.set.bind(kv);
        (kv as { set: KvLike['set'] }).set = (async (key, value, options) => {
            if (key === FROST_STATE) throw new Error('kv write failed');
            return realSet2(key, value, options);
        }) as KvLike['set'];
        try {
            const out = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
            assert.equal(out.statusCode, 500);
        } finally {
            (kv as { set: KvLike['set'] }).set = realSet2;
        }
        const after = await kv.get<{ structures: Record<string, number> }>(FROST_WAR);
        assert.equal(after?.structures.supplyDepot, 5, 'no free L6 when the debit fails');
        const untouched = await kv.get<{ treasury: Record<string, number> }>(FROST_STATE);
        assert.deepEqual(
            [untouched?.treasury.honorSeals, untouched?.treasury.materialPoints],
            [10_000, 400],
            'nothing was charged either — the purchase simply did not happen',
        );
    });
    it('levels ≤ 5 need no materials; the kill switch waives the gate', async () => {
        await seed(2, 0);
        const low = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
        assert.equal(low.statusCode, 200, JSON.stringify(low.body));
        assert.equal(low.body?.materialsSpent, 0);
        await seed(9, 0);
        process.env.DISABLE_VILLAGE_STORES = '1';
        const waived = await call(warStructure, { playerName: 'frostkage', village: DEFENDER, structure: 'supplyDepot' });
        assert.equal(waived.statusCode, 200, JSON.stringify(waived.body));
        assert.equal(waived.body?.newLevel, 10);
    });
});

describe('cafeteria cook (Village Stores)', { concurrency: false }, () => {
    it('cooks field rations (1 meat + 30 ryo → 5 rations) and campaign rations (pelt|scale + 80 → 20), capped at 40/day', async () => {
        await seedPlayer('cook', DEFENDER, { ryo: 500, itemStacks: [{ itemId: 'hunt-beast-meat', count: 2 }], inventory: ['hunt-ash-scale', 'hunt-frost-pelt', 'hunt-ash-scale'] });
        const a = await call(cafeteria, { playerName: 'cook', recipeId: 'field-rations' });
        assert.equal(a.statusCode, 200, JSON.stringify(a.body));
        assert.deepEqual({ cooked: a.body?.cooked, dailyCooked: a.body?.dailyCooked, dailyCap: a.body?.dailyCap }, { cooked: 5, dailyCooked: 5, dailyCap: 40 });
        let ch = a.body?.character as Record<string, unknown>;
        assert.equal(ch.ryo, 470);
        assert.deepEqual(ch.itemStacks, [{ itemId: 'hunt-beast-meat', count: 1 }, { itemId: 'ration-pack', count: 5 }]);
        assert.equal(typeof a.body?._saveVersion, 'number');

        const b = await call(cafeteria, { playerName: 'cook', recipeId: 'campaign-rations' });
        assert.equal(b.statusCode, 200, JSON.stringify(b.body));
        ch = b.body?.character as Record<string, unknown>;
        assert.equal(ch.ryo, 390);
        assert.equal(b.body?.dailyCooked, 25);
        assert.deepEqual(ch.inventory, ['hunt-ash-scale', 'hunt-ash-scale'], 'the pelt is consumed first (recipe material order)');
        assert.deepEqual((ch.itemStacks as Array<{ itemId: string; count: number }>).find((s) => s.itemId === 'ration-pack'), { itemId: 'ration-pack', count: 25 });

        // 25 + 20 > 40 → refused; 25 + 5 = 30 fits; then 35, 40, then refused.
        const over = await call(cafeteria, { playerName: 'cook', recipeId: 'campaign-rations' });
        assert.equal(over.statusCode, 400);
        assert.match(String(over.body?.error), /Daily ration limit/);
        const c = await call(cafeteria, { playerName: 'cook', recipeId: 'field-rations' });
        assert.equal(c.statusCode, 200);
        assert.equal(c.body?.dailyCooked, 30);
        const noMeat = await call(cafeteria, { playerName: 'cook', recipeId: 'field-rations' });
        assert.equal(noMeat.statusCode, 400, 'meat ran out');
        assert.match(String(noMeat.body?.error), /needs 1/);
    });
    it('unknown recipe is a 400, the kill switch a 404, and meals still work', async () => {
        await seedPlayer('cook', DEFENDER, { ryo: 500 });
        assert.equal((await call(cafeteria, { playerName: 'cook', recipeId: 'nope' })).statusCode, 400);
        process.env.DISABLE_VILLAGE_STORES = '1';
        assert.equal((await call(cafeteria, { playerName: 'cook', recipeId: 'field-rations' })).statusCode, 404);
        const meal = await call(cafeteria, { playerName: 'cook', mealId: 'small-ramen' });
        assert.equal(meal.statusCode, 200, JSON.stringify(meal.body));
    });
});
