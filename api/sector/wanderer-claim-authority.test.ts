import assert from 'node:assert/strict';
import { before, beforeEach, after, describe, it, mock } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'wanderer-claim-authority-test-secret';

/*
 * The three sector-wanderer REWARD endpoints re-derive the roster themselves.
 *
 * They used to accept any id that merely LOOKED like `w-<sector>-<bucket>-<i>`,
 * so a client could keep a real id and forge the archetype / verb / level / name
 * that rides with it — and wanderer-service seals that claimed name into the
 * favor record the player later delivers. Each handler now enters through
 * `naturalWandererClaimOk` (api/sector/_wanderer-encounter.ts), which rejects an
 * id the current window does not roll AND any echoed field that disagrees with
 * the roll. Reward amounts, caps and cooldowns are untouched by that guard.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let roster: typeof import('../../shared/wanderer-roster.js');
let gift: Handler;
let quest: Handler;
let service: Handler;

/*
 * FIXED CLOCK, deliberately. The roster is a pure function of (sector, six-hour
 * bucket), and the handlers re-derive that bucket from their OWN clock read — so
 * picking a wanderer off the wall clock out here would make the suite a race
 * with the bucket boundary. Only Date is mocked; timers are untouched.
 */
// 18:00 UTC is a six-hour bucket start, which is also in-world midnight: this
// window rolls every wanderer type the tests below need (gift, quest, tracker,
// merchant, bandit) and has night ninjas out. The 12:00 window rolled no
// tracker or merchant.
const FIXED_NOW = Date.UTC(2026, 7, 22, 18, 0, 0);

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    roster = await import('../../shared/wanderer-roster.js');
    gift = (await import('./wanderer-gift.js')).default as unknown as Handler;
    quest = (await import('./wanderer-quest.js')).default as unknown as Handler;
    service = (await import('./wanderer-service.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of ['save:claimplayer*', 'ratelimit:*claimplayer*', 'lock:*', 'wanderer-*claimplayer*']) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('claimplayer')) onlineStore.remove(player.name);
    }
});

after(async () => {
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('claimplayer')) onlineStore.remove(player.name);
    }
    mock.timers.reset();
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

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: `127.4.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

/** A wanderer the shared roll actually puts on the road in the CURRENT (frozen)
 *  window, read from the same function the server uses. Each endpoint pays
 *  only the wanderer type it serves, so callers name the verb they need. */
function liveWanderer(verb?: string) {
    const bucket = roster.wandererDayBucketFromMs(Date.now());
    for (let sector = 1; sector <= roster.WANDERER_SECTOR_COUNT; sector++) {
        for (const w of roster.rollWanderers(sector, bucket)) {
            if (!verb || w.verb === verb) return { w, sector };
        }
    }
    throw new Error(`no ${verb ?? ''} wanderer rolled in bucket ${bucket}`);
}

/** The frozen clock sits at in-world midnight, so night ninjas are out: one
 *  that stands in a sector right now, in the reserved night slot. */
function liveNightNinja() {
    const bucket = roster.wandererDayBucketFromMs(Date.now());
    for (let sector = 1; sector <= roster.WANDERER_SECTOR_COUNT; sector++) {
        const w = roster.nightWandererAt(sector, bucket, Date.now());
        if (w) return { w, sector };
    }
    throw new Error('no night ninja on the road at the frozen clock');
}

async function seedPlayer(playerName: string, sector: number, character: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: sector,
        character: {
            name: playerName, village: 'Leaf', level: 40, ryo: 5_000,
            hp: 40, maxHp: 100, chakra: 40, maxChakra: 100, stamina: 40, maxStamina: 100,
            fateShards: 0, boneCharms: 0, inventory: [], itemStacks: [], ...character,
        },
    });
    onlineStore.upsert({ name: playerName, sector, character: { name: playerName, hp: 100, maxHp: 100 } });
}

describe('sector wanderer reward endpoints verify the claimed NPC, not just the id shape', () => {
    it('recovers Legacy and era discovery failures without repaying, and counts each player on a shared wanderer', async t => {
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        try {
            const { readEraContributions } = await import('../_era.js');
            const { w, sector } = liveWanderer('gift');
            const first = 'claimplayer-era-a', second = 'claimplayer-era-b';
            for (const player of [first, second]) {
                await seedPlayer(player, sector);
                await kv.set(`legacy:stats:${player}`, { updatedAt: Date.now() });
            }
            const body = { sector, wandererId: w.id, wandererArchetype: w.archetype, wandererVerb: w.verb, wandererLevel: w.level, wandererName: w.name };
            const originalSet = kv.set.bind(kv);
            const statsFailure = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: Parameters<typeof kv.set>[2]) =>
                key === `legacy:stats:${first}` ? null : originalSet(key, value, opts));
            assert.equal((await post(gift, first, body)).statusCode, 503);
            const paid = await kv.get<any>(`save:${first}`);
            assert.ok(paid.character.ryo > 5000);
            assert.equal((await readEraContributions()).discoveries, 0);
            statsFailure.mock.restore();
            const originalHset = kv.hset.bind(kv);
            const eraFailure = t.mock.method(kv, 'hset', async (key: string, fields: Record<string, unknown>) => {
                if (key === 'era:contrib-receipts:discoveries') throw new Error('injected-wanderer-era-write-failure');
                return originalHset(key, fields);
            });
            assert.equal((await post(gift, first, body)).statusCode, 503);
            assert.equal((await readEraContributions()).discoveries, 0);
            eraFailure.mock.restore();
            assert.equal((await post(gift, first, body)).statusCode, 200);
            assert.equal((await readEraContributions()).discoveries, 1);
            assert.equal((await post(gift, second, body)).statusCode, 200);
            assert.equal((await readEraContributions()).discoveries, 2, 'a different player owns a different settlement receipt');
            assert.equal((await post(gift, first, body)).statusCode, 200);
            assert.equal((await readEraContributions()).discoveries, 2, 'replays cannot duplicate global credit');
            assert.equal((await kv.get<any>(`save:${first}`)).character.ryo, paid.character.ryo);
            assert.equal((await kv.get<any>(`legacy:stats:${first}`)).sectorDiscoveries, 1);
        } finally {
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('wanderer-gift refuses a forged archetype/verb/level and still pays a legitimate claim', async () => {
        const player = 'claimplayergift';
        const { w, sector } = liveWanderer('gift');
        await seedPlayer(player, sector);

        const forged = await post(gift, player, {
            sector, wandererId: w.id,
            wandererArchetype: w.archetype === 'bandit' ? 'pilgrim' : 'bandit',
            wandererVerb: w.verb === 'gift' ? 'gamble' : 'gift',
            wandererLevel: w.level + 40,
        });
        assert.equal(forged.statusCode, 200);
        assert.equal(forged.body?.ok, false);
        assert.equal(forged.body?.reason, 'invalid-wanderer');
        const untouched = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
        assert.equal(untouched?.character.ryo, 5_000, 'a forged claim pays nothing');

        const honest = await post(gift, player, {
            sector, wandererId: w.id,
            wandererArchetype: w.archetype, wandererVerb: w.verb, wandererLevel: w.level, wandererName: w.name,
        });
        assert.equal(honest.statusCode, 200);
        assert.equal(honest.body?.ok, true, JSON.stringify(honest.body));
        assert.ok((honest.body?.gift as { ryo: number }).ryo > 0);
    });

    it('wanderer-quest refuses a forged claim on accept and still accepts an honest one', async () => {
        const player = 'claimplayerquest';
        const { w, sector } = liveWanderer('quest');
        await seedPlayer(player, sector);

        const forged = await post(quest, player, {
            action: 'accept', questId: 'wq-cull', sector, wandererId: w.id,
            wandererName: `${w.name} the Impostor`,
        });
        assert.equal(forged.statusCode, 200);
        assert.equal(forged.body?.ok, false);
        assert.equal(forged.body?.reason, 'invalid-wanderer');
        assert.equal(await kv.get(`wanderer-quest:${player}`), null, 'nothing was sealed');

        const honest = await post(quest, player, {
            action: 'accept', questId: 'wq-cull', sector, wandererId: w.id,
            wandererArchetype: w.archetype, wandererVerb: w.verb, wandererLevel: w.level, wandererName: w.name,
        });
        assert.equal(honest.statusCode, 200);
        assert.equal(honest.body?.ok, true, JSON.stringify(honest.body));
        assert.equal(honest.body?.id, 'wq-cull');
    });

    it('wanderer-service refuses a forged courier name and still starts an honest favor', async () => {
        const player = 'claimplayerservice';
        const { w, sector } = liveWanderer('tracker');
        await seedPlayer(player, sector);

        const forged = await post(service, player, {
            action: 'favor-start', sector, wandererId: w.id, wandererName: 'Totally Real Courier',
        });
        assert.equal(forged.statusCode, 200);
        assert.equal(forged.body?.ok, false);
        assert.equal(forged.body?.reason, 'invalid-wanderer');
        assert.equal(await kv.get(`wanderer-favor:${player}`), null, 'no favor was sealed');

        const honest = await post(service, player, {
            action: 'favor-start', sector, wandererId: w.id, wandererName: w.name,
        });
        assert.equal(honest.statusCode, 200);
        assert.equal(honest.body?.ok, true, JSON.stringify(honest.body));
        assert.equal((honest.body?.favor as { giver: string }).giver, w.name);
    });

    it('lets an older Sunscar favor finish in playable Festival Grounds', async () => {
        const player = 'claimplayerfestival';
        const favor = { id: 'favor-old-sunscar', originSector: 53, targetSector: 54, giver: 'Courier', expiresAt: Date.now() + 60_000 };
        await seedPlayer(player, 52, { activeWandererFavor: favor });
        await kv.set(`wanderer-favor:${player}`, favor);
        const out = await post(service, player, { action: 'favor-claim', sector: 52, favorId: favor.id });
        assert.equal(out.statusCode, 200);
        assert.equal(out.body?.ok, true, JSON.stringify(out.body));
        assert.equal(await kv.get(`wanderer-favor:${player}`), null);
    });

    it('a real wanderer of the WRONG type is refused even when the client sends no verb', async () => {
        // Hostile ids that really are on the road right now: a daytime bandit
        // (slot 0/1) and a night ninja (slot 2 — the frozen clock is night).
        const bandit = liveWanderer('attack');
        const ninja = liveNightNinja();
        assert.equal(ninja.w.id.endsWith(`-${roster.WANDERER_NIGHT_INDEX}`), true);
        const endpoints: Array<[string, Handler, Record<string, unknown>]> = [
            ['gift', gift, {}],
            ['quest accept', quest, { action: 'accept', questId: 'wq-cull' }],
            ['quest claim', quest, { action: 'claim' }],
            ['merchant', service, { action: 'merchant' }],
            ['medic', service, { action: 'medic' }],
            ['favor-start', service, { action: 'favor-start' }],
            ['tracker-trail-start', service, { action: 'tracker-trail-start' }],
        ];
        for (const [kind, { w, sector }] of [['bandit', bandit], ['night ninja', ninja]] as const) {
            const player = `claimplayerverb${kind === 'bandit' ? 'b' : 'n'}`;
            await seedPlayer(player, sector);
            for (const [name, handler, body] of endpoints) {
                // No wandererVerb / wandererArchetype echoed: the old guard only
                // compared fields the client chose to send, so this passed.
                const out = await post(handler, player, { ...body, sector, wandererId: w.id });
                assert.equal(out.statusCode, 200, `${kind} → ${name}`);
                assert.equal(out.body?.reason, 'invalid-wanderer', `${kind} → ${name}: ${JSON.stringify(out.body)}`);
            }
            const save = await kv.get<{ character: Record<string, unknown> }>(`save:${player}`);
            assert.equal(save?.character.ryo, 5_000, `${kind}: nothing was paid or charged`);
            assert.equal(save?.character.fateShards, 0, `${kind}: no gift shards`);
            assert.equal(await kv.get(`wanderer-quest:${player}`), null, `${kind}: no quest sealed`);
            assert.equal(await kv.get(`wanderer-favor:${player}`), null, `${kind}: no favor sealed`);
        }
    });

    it('each service pays only its own wanderer type', async () => {
        // A pilgrim (gift) id cannot buy from the merchant counter, be healed
        // as a medic, or hand out a favor; the right type still can.
        const pilgrim = liveWanderer('gift');
        const player = 'claimplayercross';
        await seedPlayer(player, pilgrim.sector);
        for (const action of ['merchant', 'medic', 'favor-start']) {
            const out = await post(service, player, { action, sector: pilgrim.sector, wandererId: pilgrim.w.id });
            assert.equal(out.body?.reason, 'invalid-wanderer', action);
        }
        const merchant = liveWanderer('merchant');
        const buyer = 'claimplayerbuyer';
        await seedPlayer(buyer, merchant.sector);
        const bought = await post(service, buyer, { action: 'merchant', sector: merchant.sector, wandererId: merchant.w.id });
        assert.equal(bought.body?.ok, true, JSON.stringify(bought.body));
    });

    it('an id the current roll does not contain is refused by every endpoint', async () => {
        const player = 'claimplayerstale';
        const { sector } = liveWanderer();
        await seedPlayer(player, sector);
        // Correct SHAPE, previous six-hour window: the old shape-only check let
        // this through, so a retired roster stayed farmable.
        const stale = `w-${sector}-${roster.wandererDayBucketFromMs(Date.now()) - 1}-0`;
        for (const [name, handler, body] of [
            ['gift', gift, { sector, wandererId: stale }],
            ['quest', quest, { action: 'accept', questId: 'wq-cull', sector, wandererId: stale }],
            ['service', service, { action: 'merchant', sector, wandererId: stale }],
        ] as Array<[string, Handler, Record<string, unknown>]>) {
            const out = await post(handler, player, body);
            assert.equal(out.body?.reason, 'invalid-wanderer', name);
        }
    });
});
