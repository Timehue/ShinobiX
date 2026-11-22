process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-explore-test-secret-32-bytes!!';
delete process.env.DISABLE_VILLAGE_STORES;

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { ordinaryPveLevel } from '../../shared/ordinary-pve-encounter.js';
import { MAX_WILD_SECTOR, sectorRewardTier } from '../../shared/sector-geo.js';
import { COAST_SECTOR_IDS, isExplorableSector, worldRewardTier } from '../../shared/world-maps.js';
import { coastBiomeOf } from '../../shared/coast-world.js';
import { COAST_AMBUSH_NAMES } from '../coast/_patrols.js';
import { rollAncientChestLoot, relicBandForSector } from './_chest.js';
import { cleanWorldExploreAuthorityReceipt } from './_explore-authority.js';
import { rollCoastExploreOutcome, rollSectorExploreOutcome, sectorExplorePostChestRates, sectorExploreReward } from './_explore.js';

/*
 * Exploring and Ancient Chests on the Unmapped Coast (owner ruling 2026-11-19:
 * open, paying at home reward tiers 50 to 66). The coast uses the home map's
 * explore pipeline: the same daily limits, the same shared sector pool, the
 * same ambush fight and the same chest table. What it leaves out is the home
 * map's own: wild companions, dungeon mouths, gather finds, village intel and
 * sector contracts.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

/** Feed a fixed list of rolls, then keep returning the last one. */
const rolls = (...values: number[]) => { let index = 0; return () => values[Math.min(index++, values.length - 1)]; };

describe('the coast\'s reward tier', () => {
    it('runs from home tier 50 to the home map\'s top tier, and never past it', () => {
        assert.deepEqual([worldRewardTier(101), worldRewardTier(150)], [50, 66]);
        assert.equal(worldRewardTier(150), sectorRewardTier(MAX_WILD_SECTOR), 'the last coast sector pays what the richest home ground pays');
        for (const sector of COAST_SECTOR_IDS) {
            const tier = worldRewardTier(sector);
            assert.ok(tier >= 50 && tier <= 66, `sector ${sector} is tier ${tier}`);
            if (sector > 101) assert.ok(tier >= worldRewardTier(sector - 1), `sector ${sector} pays no less than the one before it`);
        }
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) assert.equal(worldRewardTier(sector), sectorRewardTier(sector), `home sector ${sector} is untouched`);
        assert.deepEqual([100, 151, 0, 99].map(isExplorableSector), [false, false, false, false]);
        assert.deepEqual([1, 74, 101, 150].map(isExplorableSector), [true, true, true, true]);
    });

    it('pays a quiet tile and a chest floor exactly what the same home tier pays', () => {
        assert.deepEqual(sectorExploreReward(101), { sector: 101, xp: 0, ryo: sectorExploreReward(50)!.ryo });
        assert.deepEqual(sectorExploreReward(150), { sector: 150, xp: 0, ryo: sectorExploreReward(66)!.ryo });
        assert.equal(sectorExploreReward(100), null);
        assert.equal(sectorExploreReward(151), null);
        // No bonus ryo (0.9), a Fate Shard (0.95), no dust (0.9): the floor alone.
        const plain = rolls(0.9, 0.95, 0.9);
        assert.deepEqual(rollAncientChestLoot(101, plain), rollAncientChestLoot(50, rolls(0.9, 0.95, 0.9)));
        assert.deepEqual(rollAncientChestLoot(150, rolls(0.9, 0.95, 0.9)), { xp: 0, ryo: 40 + 66 * 2, fateShards: 1 });
        assert.equal(rollAncientChestLoot(100, rolls(0.9)), null);
        assert.equal(rollAncientChestLoot(151, rolls(0.9)), null);
    });

    it('gives a coast chest the relics of its own kind of ground, at the home odds', () => {
        const homeBands: Record<string, number> = {};
        for (let sector = 1; sector <= MAX_WILD_SECTOR; sector++) {
            const band = relicBandForSector(sector);
            if (band.pool.length) homeBands[band.pool.join()] = band.width;
        }
        for (const sector of COAST_SECTOR_IDS) {
            const band = relicBandForSector(sector);
            assert.ok(coastBiomeOf(sector), `sector ${sector} has a biome`);
            if (band.pool.length) assert.equal(homeBands[band.pool.join()], band.width, `sector ${sector} holds a home biome's relic band, unchanged`);
        }
    });

    it('caps an ambush by the same rule as home ground of that tier', () => {
        for (const difficulty of ['weaker', 'standard', 'dangerous', 'elite'] as const) {
            for (const level of [50, 75, 100]) {
                assert.equal(ordinaryPveLevel(level, 101, difficulty, 0.5), ordinaryPveLevel(level, 50, difficulty, 0.5));
                assert.equal(ordinaryPveLevel(level, 150, difficulty, 0.5), ordinaryPveLevel(level, 66, difficulty, 0.5));
            }
        }
        assert.equal(Object.values(COAST_AMBUSH_NAMES).every(name => /^Unmoored \S/.test(name) && !/[–—]|--/.test(name)), true);
        assert.equal(new Set(Object.values(COAST_AMBUSH_NAMES)).size, 5);
    });

    it('accepts a coast receipt and still refuses a number on neither map', () => {
        const receipt = (sector: number) => cleanWorldExploreAuthorityReceipt({ version: 1, playerName: 'p', requestId: 'coast-rcpt-0001', sector, reward: {}, at: 5 });
        assert.equal(receipt(125)?.sector, 125);
        assert.equal(receipt(100), null);
        assert.equal(receipt(151), null);
        assert.equal(receipt(MAX_WILD_SECTOR)?.sector, MAX_WILD_SECTOR);
    });
});

describe('what a coast tile turns up', () => {
    it('finds chests and ambushes exactly as often as home ground, and nothing else', () => {
        const { survival } = sectorExplorePostChestRates(60, true);
        // The share the home map gives to wild companions and dungeon mouths is quiet ground here.
        assert.deepEqual(rollCoastExploreOutcome(rolls(survival + 0.001, 0), true, 60), { kind: 'none' });
        assert.deepEqual(rollCoastExploreOutcome(rolls(0.999, 0), true, 60), { kind: 'none' });
        // Inside it, the coast rolls the home table from fresh numbers.
        for (const [chest, post] of [[0.01, 0.5], [0.5, 0.01], [0.5, 0.7], [0.5, 0.999]] as const) {
            const home = rollSectorExploreOutcome(rolls(chest, post), true, 60);
            const coast = rollCoastExploreOutcome(rolls(0.2, chest, post), true, 60);
            assert.deepEqual(coast, home.kind === 'gather' ? { kind: 'none' } : home, `rolls ${chest}, ${post}`);
        }
        assert.equal(rollSectorExploreOutcome(rolls(0.5, 0.999), true, 60).kind, 'gather', 'the last case above is a gather find at home');
        // With no chest left today, it is an ambush or quiet ground.
        assert.equal(rollCoastExploreOutcome(rolls(0.2, 0.01, 0.01), false, 60).kind, 'battle');

        const seen = new Set<string>();
        for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) for (let c = 0; c < 20; c++) {
            seen.add(rollCoastExploreOutcome(rolls(a / 20, b / 20, c / 20), true, 60).kind);
        }
        assert.deepEqual([...seen].sort(), ['battle', 'chest', 'none']);
    });
});

describe('the explore, flee and chest routes on the coast', { concurrency: false }, () => {
    const PLAYER = 'coastexplorer';
    const COAST = 102;
    let kv: typeof import('../_storage.js').kv;
    let token: string;
    let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
    let explore: Handler, openChest: Handler, flee: Handler;
    let resolveAuthority: typeof import('../missions/_generic-ai-fight-authority.js').resolveGenericAiFightAuthority;
    let createToken: typeof import('../missions/_ai-fight-token.js').createAiFightTokenRecord;
    let sectorPoolKey: typeof import('./_sector-pool.js').sectorPoolKey;
    let cleanSectorPoolRow: typeof import('./_sector-pool.js').cleanSectorPoolRow;
    let ip = 0;

    before(async () => {
        ({ kv } = await import('../_storage.js'));
        ({ onlineStore } = await import('../_realtime/online-store.js'));
        ({ resolveGenericAiFightAuthority: resolveAuthority } = await import('../missions/_generic-ai-fight-authority.js'));
        ({ createAiFightTokenRecord: createToken } = await import('../missions/_ai-fight-token.js'));
        ({ sectorPoolKey, cleanSectorPoolRow } = await import('./_sector-pool.js'));
        const { PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js');
        token = (await import('../_auth.js')).issuePlayerToken(PLAYER)!;
        explore = (await import('./explore.js')).default as unknown as Handler;
        openChest = (await import('./open-chest.js')).default as unknown as Handler;
        flee = (await import('../sector/road-flee.js')).default as unknown as Handler;
        await kv.set(`save:${PLAYER}`, {
            _saveVersion: 1, _saveAt: Date.now(), currentSector: COAST,
            character: {
                name: PLAYER, village: 'Stormveil Village', level: 60, hp: 900_000, maxHp: 900_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
                ryo: 50_000, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, stats: {}, inventory: [], itemStacks: [], tileCards: [],
            },
        });
    });

    after(async () => {
        onlineStore.remove(PLAYER);
        for (const key of await kv.keys('*')) await kv.del(key);
        for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET']) delete process.env[key];
    });

    async function call(handler: Handler, body: Json) {
        const out: { status: number; body: Json } = { status: 200, body: {} };
        const res = { setHeader: () => res, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end: () => res };
        const address = `10.9.${Math.floor(++ip / 250)}.${ip % 250}`;
        await handler({
            method: 'POST', query: {}, body: { playerName: PLAYER, ...body },
            headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': address },
            socket: { remoteAddress: address },
        } as never, res as never);
        return out;
    }
    const character = async () => ((await kv.get<Json>(`save:${PLAYER}`))!.character as Json);
    const id = (n: number) => `coast-explore-${String(n).padStart(4, '0')}`;

    it('pays only to someone standing on that coast sector', async () => {
        assert.deepEqual([(await call(explore, { requestId: id(0), sector: COAST })).body.reason], ['no-presence']);
        onlineStore.upsert({ name: PLAYER, sector: 5, tile: 60, character: { name: PLAYER, level: 60 } });
        assert.equal((await call(explore, { requestId: id(0), sector: COAST })).body.reason, 'sector-mismatch', 'a player on the home map cannot explore across the water');
        // Presence only changes sector through a travel lease, so start a fresh session on the coast.
        onlineStore.remove(PLAYER);
        onlineStore.upsert({ name: PLAYER, sector: COAST, tile: 60, character: { name: PLAYER, level: 60 } });
        assert.equal((await call(explore, { requestId: id(0), sector: 151 })).status, 409, 'and a number off both maps is refused');
        assert.equal((await character()).serverExploresToday, undefined, 'nothing was spent');
    });

    it('explores tile after tile, with chests and ambushes and none of the home map\'s extras', async () => {
        const kinds: string[] = [];
        for (let n = 1; n <= 24; n++) {
            const out = await call(explore, { requestId: id(n), sector: COAST });
            assert.equal(out.status, 200, JSON.stringify(out.body));
            const outcome = out.body.outcome as Json;
            const reward = out.body.reward as Json;
            kinds.push(String(outcome.kind));
            assert.equal(reward.sector, COAST);
            assert.equal(reward.ryo, outcome.kind === 'none' ? sectorExploreReward(COAST)!.ryo : 0, 'only a quiet tile pays the explore ryo');
            if (outcome.kind === 'battle') {
                const encounter = outcome.encounter as Json;
                assert.equal(encounter.displayName, COAST_AMBUSH_NAMES[encounter.archetype as keyof typeof COAST_AMBUSH_NAMES], 'an ambush here is the Unmoored\'s');
                // An ambush is owed before the next tile, on the coast as at home.
                const blocked = await call(explore, { requestId: id(900 + n), sector: COAST });
                assert.deepEqual([blocked.status, blocked.body.reason], [409, 'pending-battle-discovery']);
                const fled = await call(flee, { kind: 'explore', fleeId: `coast-flee-${String(n).padStart(4, '0')}`, requestId: id(n), sector: COAST });
                assert.deepEqual([fled.status, fled.body.ok], [200, true], JSON.stringify(fled.body));
            }
        }
        assert.equal(kinds.every(kind => kind === 'chest' || kind === 'battle' || kind === 'none'), true, kinds.join());

        const saved = await character();
        assert.equal(saved.serverExploresToday, 24, 'every tile counts against the same daily 100 as at home');
        assert.equal(saved.serverChestsToday ?? 0, kinds.filter(kind => kind === 'chest').length, 'and every chest against the same daily chests');
        assert.equal(Array.isArray(saved.pendingGatherFinds) ? saved.pendingGatherFinds.length : 0, 0, 'no gather finds');
        assert.equal(saved.relicSurveyCount, undefined, 'the five-country survey is a home map errand');
        assert.equal(cleanSectorPoolRow(await kv.get(sectorPoolKey(COAST, Date.now()))).explores, 24, 'the sector is finite, as at home');
        assert.deepEqual(await kv.keys('village:intel:*'), [], 'no village scouts the coast');
        assert.deepEqual((await kv.keys('*')).filter(key => /contract/i.test(key)), [], 'and no sector contract ticks there');
        assert.equal(cleanWorldExploreAuthorityReceipt(await kv.get(`world-explore-receipt:${PLAYER}:${id(1)}`))?.sector, COAST, 'the durable receipt keeps its coast sector');
    });

    it('opens a coast chest once, at the coast\'s tier', async () => {
        // A sealed discovery, written as the explore route writes one.
        const saved = await kv.get<Json>(`save:${PLAYER}`);
        const before = saved!.character as Json;
        const requestId = 'coast-chest-0001';
        const discovery = { id: requestId, sector: COAST, reward: { sector: COAST, xp: 0, ryo: 0 }, at: Date.now(),
            outcome: { kind: 'chest', reservationDate: new Date().toISOString().slice(0, 10), reservationOrdinal: 1, poolReserved: true } };
        await kv.set(`save:${PLAYER}`, { ...saved, character: { ...before, redeemedSectorExplorations: [...((before.redeemedSectorExplorations as Json[] | undefined) ?? []), discovery] } });

        assert.equal((await call(openChest, { requestId: 'coast-open-00001', worldExploreRequestId: requestId, sector: 103 })).body.error, 'missing-chest-discovery', 'a chest opens where it was found');
        const opened = await call(openChest, { requestId: 'coast-open-00001', worldExploreRequestId: requestId, sector: COAST });
        assert.equal(opened.status, 200, JSON.stringify(opened.body));
        const loot = opened.body.loot as Json;
        const floor = 40 + worldRewardTier(COAST) * 2;
        assert.ok(Number(loot.ryo) >= floor && Number(loot.ryo) <= floor + 500 + 10_000, `ryo ${loot.ryo} starts from the tier ${worldRewardTier(COAST)} floor`);
        assert.equal((await character()).ryo, Number(before.ryo) + Number(loot.ryo));
        const again = await call(openChest, { requestId: 'coast-open-00002', worldExploreRequestId: requestId, sector: COAST });
        assert.deepEqual([again.body.replayed, (await character()).ryo], [true, Number(before.ryo) + Number(loot.ryo)], 'a second open pays nothing more');
        assert.deepEqual(await kv.keys('village:intel:*'), [], 'a coast chest scouts for no village');
    });

    it('seals a coast ambush as an ordinary fight, and remembers its sector on the token', async () => {
        const saved = await kv.get<Json>(`save:${PLAYER}`);
        const base = saved!.character as Json;
        const requestId = 'coast-ambush-0001';
        const receipt = { id: requestId, sector: COAST, reward: { sector: COAST, xp: 0, ryo: 0 }, at: Date.now(), outcome: { kind: 'battle' } };
        const withReceipt = { ...base, redeemedSectorExplorations: [receipt] };
        const authority = await resolveAuthority({ store: kv, playerName: PLAYER, character: withReceipt, tokenTtlSeconds: 600,
            body: { battleKind: 'explore', sector: COAST, worldExploreRequestId: requestId } });
        assert.deepEqual([authority.battleKind, authority.sector, authority.worldExploreRequestId], ['explore', COAST, requestId]);
        await assert.rejects(resolveAuthority({ store: kv, playerName: PLAYER, character: withReceipt, tokenTtlSeconds: 600,
            body: { battleKind: 'explore', sector: 151, worldExploreRequestId: requestId } }), /sealed exploration receipt is required/);
        await assert.rejects(resolveAuthority({ store: kv, playerName: PLAYER, character: withReceipt, tokenTtlSeconds: 600,
            body: { battleKind: 'explore', sector: 103, worldExploreRequestId: requestId } }), /does not prove this sector/);
        assert.equal(createToken(PLAYER, 'tok', Date.now(), { sector: COAST }).sector, COAST);
        assert.equal(createToken(PLAYER, 'tok', Date.now(), { sector: 151 }).sector, undefined);
        assert.equal(createToken(PLAYER, 'tok', Date.now(), { sector: 100 }).sector, undefined);
    });
});
