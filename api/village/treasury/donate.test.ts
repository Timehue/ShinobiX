import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'village-donate-test-secret';

/*
 * Village Merit is a KAGE-CHALLENGE gate, so the ryo-value basis a donation
 * earns merit on is balance, not plumbing.
 *
 * Every item used to count a flat 500, so 500 junk items cleared the 250-merit
 * gate in about ten clicks (economy rebalance 2026-10, I-7). Item merit now
 * follows the Village Stores routing (../_donation-merit.ts): provisions
 * (ration packs, supply bundles) keep 500 per item inside their daily donor cap,
 * materials count at their NPC sale value, and any other item is refused (it
 * belongs in a clan treasury, shared/treasury-donation-split.ts).
 * `routed.ryoValue` (craft points x 4) is still NOT the merit basis.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: typeof import('../../_auth.js').issuePlayerToken;
let meritForDonation: typeof import('../_village-merit.js').meritForDonation;
let npcUnitSaleValue: typeof import('../_donation-merit.js').npcUnitSaleValue;
let VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM: number;
let HUNT_MATERIAL_SELL_RYO: Record<string, number>;
let donate: Handler;

const PLAYER = 'meritdonor';
const OUTSIDER = 'meritoutsider';
const VILLAGE = 'Leaf';
const VILLAGE_KEY = 'game:village-state:leaf';

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ meritForDonation } = await import('../_village-merit.js'));
    ({ npcUnitSaleValue, VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM } = await import('../_donation-merit.js'));
    ({ HUNT_MATERIAL_SELL_RYO } = await import('../../../shared/hunt-material-sale.js'));
    donate = (await import('./donate.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [`save:${PLAYER}*`, `save:${OUTSIDER}*`, `${VILLAGE_KEY}*`, 'ratelimit:*', 'lock:*', 'economy-tx:*', 'audit:village-treasury-donate:*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    await kv.set(VILLAGE_KEY, { village: VILLAGE, treasury: { ryo: 0, items: [] } });
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(body: Record<string, unknown>, tokenOwner = PLAYER): Promise<Out> {
    const output = response();
    await donate({
        method: 'POST',
        body: { playerName: PLAYER, village: VILLAGE, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(tokenOwner) ?? '' },
        socket: { remoteAddress: '127.4.0.9' },
    } as never, output.res);
    return output.out;
}

async function seedDonor(character: Record<string, unknown>) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, village: VILLAGE, level: 30, hp: 100, maxHp: 100,
            ryo: 100_000, inventory: [], itemStacks: [], ...character,
        },
    });
}

const meritOf = async () => Number((await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`))?.character.villageMerit ?? 0);

describe('village treasury donation merit', () => {
    it('pays a routed MATERIAL donation its NPC sale value, not a flat 500 per item', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'hunt-torn-hide', count: 10 }] });
        const out = await post({ itemId: 'hunt-torn-hide', count: 10 });
        assert.equal(out.statusCode, 200);
        // Routing still happened — the stack landed in materialPoints, not as a
        // loose treasury item (10 x 3 craft points).
        assert.deepEqual(out.body?.stores, { provisions: 0, materialPoints: 30 });
        assert.equal(npcUnitSaleValue('hunt-torn-hide'), HUNT_MATERIAL_SELL_RYO['hunt-torn-hide']);
        assert.equal(await meritOf(), meritForDonation(10 * 12), '10 hides sell for 120 ryo = 0 merit');
        assert.equal(await meritOf(), 0);
    });

    it('pays valuable materials what selling them would, and relics nothing', async () => {
        // 25 x 50 + 150 = 1,400 material points, inside the 1,500-a-day donor cap.
        await seedDonor({ itemStacks: [{ itemId: 'hunt-legendary-material', count: 25 }, { itemId: 'weekly-boss-core', count: 1 }] });
        const out = await post({ itemId: 'hunt-legendary-material', count: 25 });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(await meritOf(), meritForDonation(25 * HUNT_MATERIAL_SELL_RYO['hunt-legendary-material']), '25 x 240 = 6,000 ryo of value');
        assert.equal(await meritOf(), 6);
        const relic = await post({ itemId: 'weekly-boss-core', count: 1 });
        assert.equal(relic.statusCode, 200, JSON.stringify(relic.body));
        assert.equal(await meritOf(), 6, 'an unsellable relic has no sale value');
    });

    it('keeps a routed RATION donation on its flat 500-per-item basis', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'ration-pack', count: 4 }] });
        const out = await post({ itemId: 'ration-pack', count: 4 });
        assert.equal(out.statusCode, 200);
        assert.deepEqual(out.body?.stores, { provisions: 4, materialPoints: 0 });
        assert.equal(await meritOf(), meritForDonation(4 * VILLAGE_PROVISIONS_MERIT_RYO_PER_ITEM), '4 rations = 2,000 ryo-equivalent = 2 merit');
        assert.equal(await meritOf(), 2);
    });

    it('refuses an item the stores do not take, and moves nothing (it belongs in a clan treasury)', async () => {
        await seedDonor({ itemStacks: [{ itemId: 'item-smoke-bomb', count: 6 }] });
        const loose = await post({ itemId: 'item-smoke-bomb', count: 6 });
        assert.equal(loose.statusCode, 409, JSON.stringify(loose.body));
        assert.match(String(loose.body?.error), /clan treasury/);
        assert.deepEqual((await kv.get<{ character: { itemStacks: unknown[] } }>(`save:${PLAYER}`))?.character.itemStacks, [{ itemId: 'item-smoke-bomb', count: 6 }], 'the bag keeps it');
        assert.deepEqual((await kv.get<{ treasury: { items: unknown[] } }>(VILLAGE_KEY))?.treasury.items, [], 'the treasury gets nothing');
        assert.equal(await meritOf(), 0);
    });

    it('pays ryo its own amount', async () => {
        await seedDonor({ ryo: 100_000 });
        const currency = await post({ currency: 'ryo', amount: 7_500 });
        assert.equal(currency.statusCode, 200);
        assert.equal(await meritOf(), meritForDonation(7_500), 'ryo bills its own amount');
        assert.equal(await meritOf(), 7);
    });

    it('pays Honor Seals and Bone Charms their ryo-value, which a seal used to round to nothing', async () => {
        await seedDonor({ honorSeals: 400, boneCharms: 50 });
        assert.equal((await post({ currency: 'honorSeals', amount: 160 })).statusCode, 200);
        assert.equal(await meritOf(), 10, '160 seals x 62.5 = 10,000 ryo of value');
        assert.equal((await post({ currency: 'boneCharms', amount: 10 })).statusCode, 200);
        assert.equal(await meritOf(), 15, '10 charms x 500 = 5,000 ryo of value');
        assert.equal((await kv.get<{ treasury: { honorSeals: number; boneCharms: number } }>(VILLAGE_KEY))?.treasury.honorSeals, 160);
    });

    it('sends Fate Shards and Aura Stones to the clan and takes no Mythic Seals', async () => {
        await seedDonor({ fateShards: 5, auraStones: 5, mythicSeals: 5 });
        for (const currency of ['fateShards', 'auraStones', 'mythicSeals']) {
            const out = await post({ currency, amount: 1 });
            assert.equal(out.statusCode, 400, `${currency}: ${JSON.stringify(out.body)}`);
        }
        const donor = (await kv.get<{ character: Record<string, number> }>(`save:${PLAYER}`))?.character;
        assert.deepEqual([donor?.fateShards, donor?.auraStones, donor?.mythicSeals], [5, 5, 5], 'nothing was taken');
    });

    it('no longer reaches the 250-merit Kage gate with a pile of junk items', async () => {
        // The I-7 exploit: 500 items at a flat 500 each was 250 merit in ten
        // clicks. Junk is now refused at the door.
        await seedDonor({ itemStacks: [{ itemId: 'item-smoke-bomb', count: 500 }] });
        for (let i = 0; i < 10; i += 1) {
            (await import('../../_ratelimit.js')).__resetRateLimitsForTest();
            assert.equal((await post({ itemId: 'item-smoke-bomb', count: 50, requestId: `village-merit-junk-${String(i).padStart(4, '0')}` })).statusCode, 409);
        }
        assert.equal(await meritOf(), 0);
    });
});

describe('village treasury donation retries (issue #179)', () => {
    beforeEach(async () => {
        (await import('../../_ratelimit.js')).__resetRateLimitsForTest();
    });

    it('a retried currency donation debits, credits and earns merit exactly once', async () => {
        await seedDonor({ ryo: 100_000 });
        const first = await post({ currency: 'ryo', amount: 7_500, requestId: 'village-donate-retry-001' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const retry = await post({ currency: 'ryo', amount: 7_500, requestId: 'village-donate-retry-001' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 92_500);
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 7_500);
        assert.equal(await meritOf(), 7, 'merit earned once');
    });

    it('a retried routed ration donation stocks provisions and spends the daily cap once', async () => {
        const { DONATE_RATIONS_FIELD } = await import('../../_village-stores.js');
        await seedDonor({ itemStacks: [{ itemId: 'ration-pack', count: 6 }] });
        const body = { itemId: 'ration-pack', count: 4, requestId: 'village-donate-rations-1' };
        const first = await post(body);
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(first.body?.stores, { provisions: 4, materialPoints: 0 });
        const retry = await post(body);
        assert.equal(retry.body?.replayed, true);
        assert.deepEqual(retry.body?.stores, { provisions: 4, materialPoints: 0 });
        const donor = (await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`))!.character;
        assert.deepEqual(donor.itemStacks, [{ itemId: 'ration-pack', count: 2 }], 'the packs left the bag once');
        assert.equal(donor[DONATE_RATIONS_FIELD], 4, 'the daily ration cap was spent once');
        assert.equal((await kv.get<{ treasury: { provisions: number } }>(VILLAGE_KEY))?.treasury.provisions, 4);
    });

    it('a failed village-row write keeps the debit and the retry finishes the credit once', async (t) => {
        await seedDonor({ ryo: 100_000 });
        const original = kv.set.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === VILLAGE_KEY) throw new Error('injected village-row write failure');
            return original(...args);
        });
        const failed = await post({ currency: 'ryo', amount: 5_000, requestId: 'village-donate-stuck-001' });
        assert.equal(failed.statusCode, 503, JSON.stringify(failed.body));
        assert.equal(failed.body?.pending, true);
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 95_000);
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 0);
        broken = false;
        const retry = await post({ currency: 'ryo', amount: 5_000, requestId: 'village-donate-stuck-001' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 95_000, 'no second debit');
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 5_000, 'credited once');
        assert.equal(await meritOf(), 5, 'merit earned once');
    });

    it('concurrent duplicates donate once', async () => {
        await seedDonor({ ryo: 100_000 });
        const outs = await Promise.all(Array.from({ length: 5 }, () => post({ currency: 'ryo', amount: 7_500, requestId: 'village-donate-dupes-001' })));
        for (const out of outs) assert.ok(out.statusCode === 200 || out.statusCode === 503, JSON.stringify(out));
        assert.equal(outs.filter((o) => o.statusCode === 200 && !o.body?.replayed).length, 1, 'one request moved value');
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 92_500);
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 7_500);
        assert.equal(await meritOf(), 7, 'merit earned once');
    });

    it('a failed debit write moves nothing, and the retry donates once', async (t) => {
        await seedDonor({ ryo: 100_000 });
        const original = kv.compareSet.bind(kv);
        let fail = true;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (fail && args[0] === `save:${PLAYER}`) { fail = false; throw new Error('injected save write failure'); }
            return original(...args);
        });
        const failed = await post({ currency: 'ryo', amount: 4_000, requestId: 'village-donate-dfail-001' });
        assert.equal(failed.statusCode, 500, JSON.stringify(failed.body));
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 100_000, 'nothing was debited');
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 0, 'nothing was credited');
        assert.equal(await meritOf(), 0);
        const retry = await post({ currency: 'ryo', amount: 4_000, requestId: 'village-donate-dfail-001' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, undefined, 'the retry is the first time it settles');
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 96_000);
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 4_000);
        assert.equal(await meritOf(), 4, 'merit earned once');
    });

    it('outsiders, forged identities, reused ids and short balances move nothing', async () => {
        await seedDonor({ ryo: 10_000 });
        await kv.set(`save:${OUTSIDER}`, { _saveVersion: 1, character: { name: OUTSIDER, village: 'Mist', level: 30, ryo: 50_000 } });
        const outsider = await post({ playerName: OUTSIDER, currency: 'ryo', amount: 1_000, requestId: 'village-donate-outside1' }, OUTSIDER);
        assert.equal(outsider.statusCode, 403, JSON.stringify(outsider.body));
        const forged = await post({ currency: 'ryo', amount: 1_000, requestId: 'village-donate-forged01' }, OUTSIDER);
        assert.ok(forged.statusCode === 401 || forged.statusCode === 403, JSON.stringify(forged));
        const poor = await post({ currency: 'ryo', amount: 20_000, requestId: 'village-donate-poor0001' });
        assert.equal(poor.statusCode, 400, JSON.stringify(poor.body));
        assert.equal((await post({ currency: 'ryo', amount: 1_000, requestId: 'village-donate-reuse001' })).statusCode, 200);
        const reused = await post({ currency: 'ryo', amount: 2_000, requestId: 'village-donate-reuse001' });
        assert.equal(reused.statusCode, 409, 'one id, one donation');
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${PLAYER}`))?.character.ryo, 9_000);
        assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${OUTSIDER}`))?.character.ryo, 50_000);
        assert.equal((await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY))?.treasury.ryo, 1_000);
        assert.equal(await meritOf(), 1);
    });
});

describe('village treasury donation under lock contention', () => {
    it('answers a contended treasury with a retryable 503, not "Internal server error"', async () => {
        await seedDonor({ ryo: 100_000 });
        // Another donor is mid-write on the village-state row. `withKvLock(...,
        // { failClosed: true })` aborts rather than racing a currency write, and
        // that abort used to fall through to the generic 500 — which reads to a
        // player as "the game is broken" instead of "someone beat you to it".
        await kv.set(`lock:${VILLAGE_KEY}`, 'someone-else', { ex: 30 });
        try {
            const out = await post({ currency: 'ryo', amount: 1_000 });
            assert.equal(out.statusCode, 503);
            assert.equal(out.body?.retryable, true);
            assert.match(String(out.body?.error), /retry/i);
            assert.doesNotMatch(String(out.body?.error), /internal server error/i);

            // Nothing moved: the abort lands before any mutation.
            const donor = await kv.get<{ character: Record<string, unknown> }>(`save:${PLAYER}`);
            assert.equal(donor?.character.ryo, 100_000);
            const state = await kv.get<{ treasury: { ryo: number } }>(VILLAGE_KEY);
            assert.equal(state?.treasury.ryo, 0);
        } finally {
            await kv.del(`lock:${VILLAGE_KEY}`);
        }
    });
});

describe('gathered village supply containers', () => {
    it('bundles and packs share the 40-provision cap, preserve per-item merit, and replay without double debit', async (t) => {
        // The cap is per UTC day of Date.now(): freeze the clock so the donations
        // cannot straddle midnight UTC and start a fresh day's allowance.
        t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
        await seedDonor({itemStacks:[{itemId:'village-supply-bundle',count:4},{itemId:'ration-pack',count:20},{itemId:'village-supply-crate',count:1}]});
        const body={itemId:'village-supply-bundle',count:3,requestId:'gather-bundles-donate-1'};
        const first=await post(body);assert.equal(first.statusCode,200,JSON.stringify(first.body));
        assert.deepEqual(first.body?.stores,{provisions:30,materialPoints:0});
        assert.equal(await meritOf(),meritForDonation(3*500));
        assert.equal((await post(body)).body?.replayed,true);
        assert.equal((await post({itemId:'village-supply-crate',count:1,requestId:'gather-crate-over-cap'})).statusCode,429);
        assert.equal((await post({itemId:'ration-pack',count:10,requestId:'gather-packs-remainder'})).statusCode,200);
        assert.equal((await post({itemId:'village-supply-bundle',count:1,requestId:'gather-bundle-over-cap'})).statusCode,429);
        const state=await kv.get<{treasury:{provisions:number;items:unknown[]}}>(VILLAGE_KEY);
        assert.equal(state?.treasury.provisions,40);assert.deepEqual(state?.treasury.items,[]);
        const save=await kv.get<{character:{itemStacks:{itemId:string;count:number}[];rationsDonatedToday:number}}>('save:'+PLAYER);
        assert.equal(save?.character.rationsDonatedToday,40);
        assert.equal(save?.character.itemStacks.find(s=>s.itemId==='village-supply-crate')?.count,1);
    });
    it('a crate survives a failed credit and retry stocks exactly 40 with the original per-item merit',async(t)=>{
        await seedDonor({itemStacks:[{itemId:'village-supply-crate',count:2}]});
        const realSet=kv.set.bind(kv);let fail=true;
        t.mock.method(kv,'set',async(key:string,value:unknown,options?:unknown)=>{
            if(key===VILLAGE_KEY&&fail){fail=false;throw Error('test credit unavailable');}
            return realSet(key,value,options as never);
        });
        const body={itemId:'village-supply-crate',count:1,requestId:'gather-crate-lost-credit'};
        const first=await post(body);assert.ok(first.statusCode>=500);
        t.mock.restoreAll();
        const retry=await post(body);assert.equal(retry.statusCode,200,JSON.stringify(retry.body));
        assert.equal((await kv.get<{treasury:{provisions:number}}>(VILLAGE_KEY))?.treasury.provisions,40);
        assert.equal(await meritOf(),meritForDonation(500));
        const ch=(await kv.get<{character:Record<string,unknown>}>('save:'+PLAYER))!.character;
        assert.deepEqual(ch.itemStacks,[{itemId:'village-supply-crate',count:1}]);assert.equal(ch.rationsDonatedToday,40);
        assert.equal((await post(body)).statusCode,200);
        assert.equal((await kv.get<{treasury:{provisions:number}}>(VILLAGE_KEY))?.treasury.provisions,40);
    });
    it('disabled stores refuse both containers without spending inventory or falling back to loose treasury',async()=>{
        await seedDonor({itemStacks:[{itemId:'village-supply-bundle',count:1},{itemId:'village-supply-crate',count:1}]});
        const before=await kv.get('save:'+PLAYER);
        process.env.DISABLE_VILLAGE_STORES='1';
        try {
            for(const itemId of ['village-supply-bundle','village-supply-crate']){
                const r=await post({itemId,count:1,requestId:'disabled-'+itemId});assert.equal(r.statusCode,409);
                assert.match(String(r.body?.error),/unavailable|reopen/i);
            }
            assert.deepEqual(await kv.get('save:'+PLAYER),before);
            assert.deepEqual((await kv.get<{treasury:unknown}>(VILLAGE_KEY))?.treasury,{ryo:0,items:[]});
        }finally{delete process.env.DISABLE_VILLAGE_STORES;}
    });
});
