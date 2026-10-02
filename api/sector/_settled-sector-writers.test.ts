import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

/*
 * The sector quest and wanderer writers, and the Festival black market, commit
 * through mutatePlayerSave. Two things are pinned here.
 *
 * 1. The idle recovery a player earned is kept. These handlers used to bump the
 *    save version on a raw write, which moved the regeneration cursor to "now"
 *    and threw away every second of HP, chakra and stamina recovered since the
 *    last save. The fixture save has earned 30 seconds of it.
 *
 * 2. A save write that loses its compare-and-set commits nothing, so whatever
 *    the handler spent ahead of that write — a contract claim, a wanderer
 *    cooldown, a daily slot, a consumed seal — comes back, and the player's
 *    retry pays exactly once. A quest accept that loses never leaves the
 *    phantom "busy" seal it used to cache before its save write.
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'settled-sector-writers-admin';
delete process.env.SESSION_SECRET;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Json };

// The wanderer roster is a pure function of (sector, six-hour bucket) and the
// handlers read their own clock, so the clock is frozen on a bucket start whose
// roll includes every wanderer type below (wanderer-claim-authority.test.ts).
const FIXED_NOW = Date.UTC(2026, 7, 22, 18, 0, 0);
const IDLE_MS = 30_000;
const EARNED = 30;
const PREFIX = 'sectorwriterqa';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

let kv: typeof import('../_storage.js').kv;
let roster: typeof import('../../shared/wanderer-roster.js');
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    roster = await import('../../shared/wanderer-roster.js');
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
});

beforeEach(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
});

after(async () => {
    for (const key of await kv.keys(`*${PREFIX}*`)) await kv.del(key);
    mock.timers.reset();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function seedTired(name: string, extra: Json = {}, record: Json = {}): Promise<void> {
    const at = FIXED_NOW - IDLE_MS;
    await kv.set(`save:${name}`, {
        _saveVersion: 3,
        _saveAt: at,
        _regenAt: at,
        currentSector: 1,
        ...record,
        character: {
            name,
            level: 40,
            village: 'Frostfang Village',
            petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            pets: [],
            inventory: [],
            hp: 10, maxHp: 100, chakra: 20, maxChakra: 100, stamina: 0, maxStamina: 100,
            ryo: 200_000, fateShards: 0, boneCharms: 0,
            ...extra,
        },
    });
}

async function post(path: string, body: Json): Promise<Out> {
    const handler = (await import(path)).default as Handler;
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.93' },
        socket: { remoteAddress: '127.0.0.93' },
    } as never, res as never);
    return out;
}

async function stored(name: string): Promise<Json> {
    return (await kv.get<Json>(`save:${name}`))!;
}

async function assertRecovered(name: string, where: string): Promise<Json> {
    const record = await stored(name);
    const character = record.character as Json;
    assert.ok(Number(character.hp) >= 10 + EARNED, `${where}: hp ${character.hp} lost the idle recovery`);
    assert.ok(Number(character.chakra) >= 20 + EARNED, `${where}: chakra ${character.chakra} lost the idle recovery`);
    assert.ok(Number(character.stamina) >= EARNED, `${where}: stamina ${character.stamina} lost the idle recovery`);
    return record;
}

/** Make exactly the next compare-and-set of this save lose, as a concurrent write would. */
async function losingOnce<T>(name: string, run: () => Promise<T>): Promise<T> {
    const original = kv.compareSet;
    let armed = true;
    kv.compareSet = async (key, expected, value, options) => {
        if (armed && key === `save:${name}`) { armed = false; return false; }
        return original.call(kv, key, expected, value, options);
    };
    try {
        return await run();
    } finally {
        kv.compareSet = original;
    }
}

function liveWanderer(verb: string) {
    const bucket = roster.wandererDayBucketFromMs(Date.now());
    for (let sector = 1; sector <= roster.WANDERER_SECTOR_COUNT; sector++) {
        for (const w of roster.rollWanderers(sector, bucket)) {
            if (w.verb === verb) return { w, sector };
        }
    }
    throw new Error(`no ${verb} wanderer rolled at the frozen clock`);
}

async function contractFixture(name: string) {
    const { contractSectorsForDay, sectorContractFor, utcDayOf } = await import('../../shared/sector-contracts.js');
    const { contractProgressKey, contractClaimKey } = await import('../_sector-contracts.js');
    const day = utcDayOf(Date.now());
    const sector = contractSectorsForDay(day)[0];
    const contract = sectorContractFor(sector, day)!;
    await kv.set(contractProgressKey(name, sector, day), contract.target);
    return { sector, contract, claimKey: contractClaimKey(name, sector, day) };
}

describe('sector writers keep the idle recovery a player earned', { concurrency: false }, () => {
    it('sector contract claim', async () => {
        const name = `${PREFIX}contract`;
        await seedTired(name);
        const { sector } = await contractFixture(name);
        const out = await post('./contract.js', { playerName: name, sector });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        const record = await assertRecovered(name, 'contract');
        assert.equal(out.body?._saveVersion, record._saveVersion);
    });

    it('wanderer gift', async () => {
        const name = `${PREFIX}gift`;
        await seedTired(name);
        const { w, sector } = liveWanderer('gift');
        const out = await post('./wanderer-gift.js', { playerName: name, wandererId: w.id, sector });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'wanderer gift');
    });

    it('wanderer merchant', async () => {
        const name = `${PREFIX}merchant`;
        await seedTired(name);
        const { w, sector } = liveWanderer('merchant');
        const out = await post('./wanderer-service.js', { playerName: name, action: 'merchant', wandererId: w.id, sector });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'wanderer merchant');
    });

    it('wanderer quest accept', async () => {
        const name = `${PREFIX}questaccept`;
        await seedTired(name);
        const { w, sector } = liveWanderer('quest');
        const out = await post('./wanderer-quest.js', { playerName: name, action: 'accept', questId: 'wq-cull', wandererId: w.id, sector });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'wanderer quest accept');
    });

    it('rift accept', async () => {
        const name = `${PREFIX}rift`;
        await seedTired(name);
        const out = await post('./rift-quest.js', { playerName: name, action: 'accept', riftId: 'rift-legacy-echo' });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'rift accept');
    });

    it('questbook accept', async () => {
        const name = `${PREFIX}questbook`;
        await seedTired(name);
        const out = await post('./questbook.js', { playerName: name, action: 'accept', questId: 'qb-bell' });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'questbook accept');
    });

    it('story reckoning abandon', async () => {
        const name = `${PREFIX}reckoning`;
        await seedTired(name);
        const out = await post('./story-reckoning.js', { playerName: name, action: 'abandon' });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        await assertRecovered(name, 'story reckoning abandon');
    });

    it('black market pull', async () => {
        const name = `${PREFIX}blackmarket`;
        await seedTired(name);
        const out = await post('../festival/black-market.js', { playerName: name });
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        await assertRecovered(name, 'black market');
    });

    it('wanderer ambush claim, which also clears the paid pending outcome', async () => {
        const name = `${PREFIX}ambush`;
        const chainId = `chain-${PREFIX}`;
        const sector = 7;
        await seedTired(name, {
            worldAiPendingOutcome: { kind: 'wanderer-ambush-reward', claimId: `ambush:${chainId}:${sector}`, chainId, sourceId: 'wanderer-ambush', sector, createdAt: FIXED_NOW - 1_000 },
            worldAiChainWins: [0, 1, 2, 3].map((stage) => ({ id: `${chainId}:${stage}`, chainId, stage, kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector, at: FIXED_NOW - 2_000 })),
        });
        const out = await post('./wanderer-ambush.js', { playerName: name, action: 'claim' });
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        // Omitting the key used to leave it on the save through the deep merge,
        // so every resume probe offered this already-paid claim again.
        assert.equal(((await stored(name)).character as Json).worldAiPendingOutcome, null, 'the paid pending outcome is cleared');
        await assertRecovered(name, 'wanderer ambush');

        const replay = await post('./wanderer-ambush.js', { playerName: name, action: 'claim' });
        assert.equal(replay.body?.replayed, true, JSON.stringify(replay.body));
    });
});

describe('a write that loses its compare-and-set gives back what it spent first', { concurrency: false }, () => {
    it('contract: the claim comes back and the retry pays once', async () => {
        const name = `${PREFIX}contractlost`;
        await seedTired(name);
        const { sector, contract, claimKey } = await contractFixture(name);
        const lost = await losingOnce(name, () => post('./contract.js', { playerName: name, sector }));
        assert.equal(lost.statusCode, 503, JSON.stringify(lost.body));
        assert.equal(await kv.get(claimKey), null, 'the unpaid claim was taken back');
        assert.equal((await stored(name)).character && ((await stored(name)).character as Json).ryo, 200_000);

        const paid = await post('./contract.js', { playerName: name, sector });
        assert.equal(paid.body?.ok, true, JSON.stringify(paid.body));
        assert.equal(((await stored(name)).character as Json).ryo, 200_000 + contract.ryo);
        const again = await post('./contract.js', { playerName: name, sector });
        assert.equal(again.body?.reason, 'already-claimed');
    });

    it('wanderer gift: the cooldown and the daily slot come back', async () => {
        const name = `${PREFIX}giftlost`;
        await seedTired(name);
        const { w, sector } = liveWanderer('gift');
        const { wandererUseCooldownKey } = await import('./_wanderer-encounter.js');
        const lost = await losingOnce(name, () => post('./wanderer-gift.js', { playerName: name, wandererId: w.id, sector }));
        assert.equal(lost.statusCode, 503, JSON.stringify(lost.body));
        assert.equal(await kv.get(wandererUseCooldownKey(name, w.id)), null, 'the wanderer cooldown came back');
        const dayKey = `wanderer-gift:${name}:${new Date(FIXED_NOW).toISOString().slice(0, 10)}`;
        assert.equal(Number(await kv.get(dayKey) ?? 0), 0, 'the daily slot came back');

        const paid = await post('./wanderer-gift.js', { playerName: name, wandererId: w.id, sector });
        assert.equal(paid.body?.ok, true, JSON.stringify(paid.body));
        assert.equal(Number(await kv.get(dayKey)), 1);
    });

    it('rift: the consumed KV seal and the daily slot come back', async () => {
        const name = `${PREFIX}riftlost`;
        const at = FIXED_NOW - 60_000;
        const { WORLD_GEO_VERSION } = await import('../../shared/sector-geo.js');
        const seal = { id: 'rift-legacy-echo', targetSector: 5, baseline: 0, at, geoV: WORLD_GEO_VERSION, runToken: 'runtoken-sectorwriterqa' };
        await seedTired(name, {
            riftQuestBossReceipt: { riftId: 'rift-legacy-echo', runToken: seal.runToken, combatRunId: 'combat:sectorwriterqa', acceptedAt: at, clearedAt: at + 1_000 },
        });
        // A KV-only seal: the consumed copy is the only proof of this run.
        await kv.set(`rift-quest:${name}`, seal, { ex: 7 * 24 * 60 * 60 });
        const lost = await losingOnce(name, () => post('./rift-quest.js', { playerName: name, action: 'complete', riftId: 'rift-legacy-echo' }));
        assert.equal(lost.statusCode, 503, JSON.stringify(lost.body));
        assert.deepEqual(await kv.get(`rift-quest:${name}`), seal, 'the consumed seal came back');
        const countKey = `rift-quest-count:${name}:${new Date(FIXED_NOW).toISOString().slice(0, 10)}`;
        assert.equal(Number(await kv.get(countKey) ?? 0), 0, 'the daily slot came back');

        const paid = await post('./rift-quest.js', { playerName: name, action: 'complete', riftId: 'rift-legacy-echo' });
        assert.equal(paid.body?.ok, true, JSON.stringify(paid.body));
        assert.equal(Number(await kv.get(countKey)), 1);
    });

    it('wanderer quest accept: no phantom "busy" seal is left behind', async () => {
        const name = `${PREFIX}questlost`;
        await seedTired(name);
        const { w, sector } = liveWanderer('quest');
        const lost = await losingOnce(name, () => post('./wanderer-quest.js', { playerName: name, action: 'accept', questId: 'wq-cull', wandererId: w.id, sector }));
        assert.equal(lost.statusCode, 503, JSON.stringify(lost.body));
        assert.equal(await kv.get(`wanderer-quest:${name}`), null, 'no seal was cached ahead of the durable write');

        const accepted = await post('./wanderer-quest.js', { playerName: name, action: 'accept', questId: 'wq-cull', wandererId: w.id, sector });
        assert.equal(accepted.body?.ok, true, JSON.stringify(accepted.body));
    });
});
