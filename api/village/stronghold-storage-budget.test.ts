import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { STRONGHOLD_DIMS, buildStrongholdTiles, type StrongholdVisit } from '../../shared/sector-stronghold.js';
import { projectKvValue } from '../_storage-projection.js';

// A stronghold step is one request per tile. It used to read the whole player
// save twice (once for the village's war objectives, once for incapacitation)
// and every war row in full, on every tile. These cases pin the reads to the
// few fields each decision uses, and check the projected war lookup decides
// exactly as the whole-row one does.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'stronghold-budget-secret-32-characters!';

type Call = { method: string; keys: string[] };
let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let action: typeof import('./_stronghold.js').handleStrongholdAction;
let campaign: typeof import('../_village-war-campaign.js');
const calls: Call[] = [];
const sector = 12;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ handleStrongholdAction: action } = await import('./_stronghold.js'));
    campaign = await import('../_village-war-campaign.js');
    // Production's Postgres store answers a projection where the data lives.
    const store = kv as unknown as Record<string, unknown>;
    const rawMget = kv.mget.bind(kv);
    store.mgetProjected = async (keys: string[], projection: Record<string, readonly string[]>) =>
        (await rawMget(...keys)).map(value => projectKvValue(value, projection));
    for (const method of ['get', 'mget', 'mgetProjected', 'set', 'compareSet', 'del', 'delIfEqual', 'keys']) {
        const original = store[method] as (...args: unknown[]) => Promise<unknown>;
        store[method] = async (...args: unknown[]) => {
            calls.push({ method, keys: Array.isArray(args[0]) ? args[0] as string[] : method === 'mget' ? args as string[] : [String(args[0])] });
            return original.apply(kv, args);
        };
    }
});

async function seed(name: string) {
    const character = { name, level: 60, village: 'Frostfang Village', hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${name}`, { _saveVersion: 1, character });
    onlineStore.upsert({ name, sector, character });
}

function openNeighbour(visit: StrongholdVisit): number {
    const tiles = buildStrongholdTiles(sector), width = STRONGHOLD_DIMS.width;
    return [visit.tile + 1, visit.tile - 1, visit.tile + width, visit.tile - width]
        .find(tile => tiles[tile] && tiles[tile].kind === 'empty' && !tiles[tile].solid)!;
}

test('a stronghold step reads save fields, never the whole save or whole war rows', async () => {
    const name = 'shbudgetstep';
    await seed(name);
    await kv.set('world:war:budget-old', { id: 'budget-old', villages: ['Frostfang Village', 'Ashen Leaf Village'], startedAt: 1, updatedAt: 1, endedAt: 2 });
    const entered = await action(name, 'stronghold-enter', { sector, presenceId: 'budget-tab-0001' });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    const visit = entered.body.visit as StrongholdVisit;
    calls.length = 0;
    const stepped = await action(name, 'stronghold-step', { sector, presenceId: 'budget-tab-0001', version: visit.version, tile: openNeighbour(visit) });
    assert.equal(stepped.status, 200, JSON.stringify(stepped.body));
    assert.equal((stepped.body.visit as StrongholdVisit).steps, visit.steps + 1);
    const wholeReads = calls.filter(call => (call.method === 'get' || call.method === 'mget')
        && call.keys.some(key => key.startsWith('save:') || key.startsWith('world:war:')));
    assert.deepEqual(wholeReads, [], 'no whole save or war row is read on a step');
    assert.equal(calls.filter(call => call.method === 'mgetProjected' && call.keys.includes(`save:${name}`)).length, 2,
        'the village before the lock and the vitals under it, as before, but projected');
    assert.equal(calls.filter(call => ['set', 'compareSet', 'del'].includes(call.method) && call.keys.some(key => key.startsWith('save:'))).length, 0);
});

test('a save whose character holds none of the projected fields is still decided on the whole save', async () => {
    // An empty projection cannot tell "no character" from "a character without
    // these fields". Whole-save semantics: a character exists, and nothing in it
    // says incapacitated, so the step is allowed.
    const name = 'shbudgetbare';
    await seed(name);
    const entered = await action(name, 'stronghold-enter', { sector, presenceId: 'budget-tab-0002' });
    assert.equal(entered.status, 200, JSON.stringify(entered.body));
    const visit = entered.body.visit as StrongholdVisit;
    await kv.set(`save:${name}`, { _saveVersion: 2, character: { stats: {} } });
    const stepped = await action(name, 'stronghold-step', { sector, presenceId: 'budget-tab-0002', version: visit.version, tile: openNeighbour(visit) });
    assert.equal(stepped.status, 200, JSON.stringify(stepped.body));
    await kv.set(`save:${name}`, { _saveVersion: 3 });
    const refused = await action(name, 'stronghold-step', { sector, presenceId: 'budget-tab-0002', version: (stepped.body.visit as StrongholdVisit).version, tile: visit.tile });
    assert.equal(refused.status, 409, 'no character at all: refused exactly as before');
    assert.match(String(refused.body.error), /Recover before exploring/);
});

test('the projected war lookup decides exactly as the whole-row lookup', async () => {
    const now = Date.now();
    const objective = (id: string, at: number, village: string) => ({ id, sector: at, village, mode: 'card', opensAt: now - 10_000, closesAt: now + 10_000, limit: 3, bouts: 0, wins: {} });
    const live = (extra: Record<string, unknown> = {}) => ({
        villages: ['Frostfang Village', 'Ashen Leaf Village'], startedAt: now - 20_000, updatedAt: now,
        campaign: { version: 2, startsAt: now - 10_000, endsAt: now + 10_000,
            strongholds: [objective('stronghold-0-0', 12, 'Frostfang Village'), objective('stronghold-1-0', 31, 'Ashen Leaf Village')],
            shrine: [], intel: {}, pvp: {}, pve: {}, usage: {}, admissions: { a: 1 }, receipts: { r: 1 } },
        ...extra,
    });
    const rows: Array<[string, Record<string, unknown>]> = [
        ['live', live()],
        ['ended', live({ endedAt: now - 1 })],
        ['funding pending', live({ declarationFunding: { status: 'pending' } })],
        ['funding active', live({ declarationFunding: { status: 'active' } })],
        ['not started', live({ campaign: { ...live().campaign as object, startsAt: now + 5_000 } })],
        ['over', live({ campaign: { ...live().campaign as object, endsAt: now - 5_000 } })],
        ['no campaign', { villages: ['Frostfang Village', 'Ashen Leaf Village'], startedAt: 1, updatedAt: 1 }],
        ['other villages', live({ villages: ['Stormveil Village', 'Moonshadow Village'] })],
    ];
    for (const [label, row] of rows) {
        const existing = await kv.keys('world:war:*');
        if (existing.length) await kv.del(...existing);
        await kv.set(`world:war:${label.replace(/ /g, '-')}`, { id: label, ...row });
        for (const village of ['Frostfang Village', 'Ashen Leaf Village', 'Stormveil Village', '']) {
            for (const at of [12, 31, 40]) {
                const whole = (await campaign.villageCampaignStronghold(village, at))?.objective ?? null;
                const projected = await campaign.villageCampaignStrongholdObjective(village, at);
                assert.deepEqual(projected, whole, `${label}: ${village || '(no village)'} at sector ${at}`);
            }
        }
    }
});
