import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { before, beforeEach, describe, it } from 'node:test';
import type { HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
delete process.env.DISCORD_ANNOUNCE_WEBHOOK_URL;

type Handler = (req: never, res: never) => Promise<unknown>;
type Response = { status: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let rollEvent: typeof import('./event.js').rollEvent;
let eventHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    const event = await import('./event.js');
    rollEvent = event.rollEvent;
    eventHandler = event.default as unknown as Handler;
});

const ROLLS = 2_000;
const currencies = (roll: ReturnType<typeof rollEvent>) => roll.credit.currencies ?? {};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

describe('Hollow Gate event roll tables (2026-10 rebalance)', () => {
    it('a chest pays 0-3 Aura Stones and 1-4 Bone Charms, and its ryo follows the sealed scale (#16, #17, #1)', () => {
        const stones: number[] = [];
        const charms: number[] = [];
        for (let i = 0; i < ROLLS; i += 1) {
            const roll = currencies(rollEvent('chest', 3, undefined, 0.5));
            stones.push(Number(roll.auraStones));
            charms.push(Number(roll.boneCharms));
            assert.ok(Number(roll.ryo) >= 55 && Number(roll.ryo) <= 154, `half-scale chest ryo ${roll.ryo}`);
            assert.equal(roll.hollowShards, 3, 'a floor-3 chest pays 3 Hollow Shards');
        }
        assert.ok(stones.every((n) => Number.isInteger(n) && n >= 0 && n <= 3), 'Aura Stones stay in 0-3');
        assert.ok(charms.every((n) => Number.isInteger(n) && n >= 1 && n <= 4), 'Bone Charms stay in 1-4');
        assert.ok(new Set(stones).size === 4 && new Set(charms).size === 4, 'every value of both ranges is reachable');
        assert.ok(Math.abs(mean(stones) - 1.5) < 0.15, `Aura Stone mean ${mean(stones)}`);
        assert.ok(Math.abs(mean(charms) - 2.5) < 0.15, `Bone Charm mean ${mean(charms)}`);
        for (let i = 0; i < 200; i += 1) {
            const ryo = Number(currencies(rollEvent('chest', 1, undefined)).ryo);
            assert.ok(ryo >= 110 && ryo <= 309, `unscaled chest ryo ${ryo}`);
        }
    });

    it('a hidden relic pays 9-20 honor to a Vanguard, exactly 2 Bone Charms, and a Fate Shard half the time (#11, #16, #28)', () => {
        const fate: number[] = [];
        for (let i = 0; i < ROLLS; i += 1) {
            const roll = rollEvent('hidden-relic', 2, 'vanguard');
            const paid = currencies(roll);
            assert.ok(Number(paid.honorSeals) >= 9 && Number(paid.honorSeals) <= 20, `Vanguard honor ${paid.honorSeals}`);
            assert.equal(paid.boneCharms, 2);
            assert.ok(paid.fateShards === 0 || paid.fateShards === 1, `relic FS ${paid.fateShards}`);
            assert.deepEqual(roll.credit.items, { 'veil-of-the-hollow': 1 });
            assert.equal(roll.keyDelta, 1);
            fate.push(Number(paid.fateShards));
        }
        assert.ok(Math.abs(mean(fate) - 0.5) < 0.05, `relic Fate Shard mean ${mean(fate)}`);
        for (let i = 0; i < 200; i += 1) assert.equal(currencies(rollEvent('hidden-relic', 2, 'healer')).honorSeals, 0);
    });

    it('a shard vein pays the 0.6x shard curve', () => {
        assert.deepEqual([1, 2, 3, 4, 5].map((floor) => currencies(rollEvent('shard-vein', floor, undefined)).hollowShards), [3, 4, 5, 7, 8]);
    });
});

// ─── HG-16 / I-18: one shrine floor pays at most one torch, tablet and relic ──

async function call(name: string, body: Record<string, unknown>): Promise<Response> {
    const result: Response = { status: 200 };
    const res = {
        setHeader: () => res,
        status: (status: number) => { result.status = status; return res; },
        json: (response: Record<string, unknown>) => { result.body = response; return res; },
        end: () => res,
    };
    await eventHandler({ method: 'POST', headers: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name)! },
        socket: { remoteAddress: '127.0.0.1' }, body: { ...body, playerName: name },
    } as never, res as never);
    return result;
}

describe('hidden chamber bound per floor', () => {
    beforeEach(async () => {
        const keys = await kv.keys('*');
        if (keys.length) await kv.del(...keys);
    });

    it('lets one shrine node pay a tablet and a relic once each, and refuses a second relic on the floor', async () => {
        const { validateHollowGateFloorManifest } = await import('./_floor-manifest.js');
        const name = 'hgchamber';
        const token = 'chamber-token';
        const runKey = `hg-run:${name}:${token}`;
        const tiles = Array.from({ length: 165 }, () => ({ kind: 'empty', terrain: 'room_floor' }));
        let index = 20;
        for (const [kind, count] of [
            ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
            ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
        ] as const) for (let n = 0; n < count; n += 1) tiles[index++].kind = kind;
        tiles[136].kind = 'exit';
        tiles[148].kind = 'descend';
        const floor = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: 15, height: 11, playerX: 1, playerY: 1, tiles });
        assert.equal(floor.ok, true);
        if (!floor.ok) return;
        const shrine = 32; // the sealed shrine node (x 2, y 2)
        assert.equal(floor.manifest.nodes[String(shrine)], 'shrine');
        // A second shrine node the validator would never allow: the per-floor
        // event bound must hold even then.
        const manifest = { ...floor.manifest, nodes: { ...floor.manifest.nodes, '40': 'shrine' } };
        const run: HollowGateRunToken = {
            playerName: name, mintedAt: Date.now() - 240_000, floorDepth: 5, currentFloor: 1,
            seed: 'chamber', entryCurrencies: {}, entryItems: {}, entryLevel: 30,
            offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
            rewardLedger: { currencies: {}, items: {}, sourceIds: [] },
            position: { x: shrine % 15, y: Math.floor(shrine / 15) }, floorManifests: { '1': manifest },
            keys: 0, torch: 4, threat: 0, wardSteps: 0,
        };
        await kv.set(runKey, run);
        await kv.set(`save:${name}`, { _saveVersion: 1, character: {
            name, level: 30, hp: 500, maxHp: 500, profession: 'vanguard', inventory: [], itemStacks: [],
            hollowGateRun: { runToken: token, currentFloor: 1 },
        } });

        const node = `floor:1:tile:${shrine}`;
        const tablet = await call(name, { token, action: 'hidden-tablet', nodeId: node });
        assert.equal(tablet.status, 200, String(tablet.body?.error));
        const relic = await call(name, { token, action: 'hidden-relic', nodeId: node });
        assert.equal(relic.status, 200, String(relic.body?.error));
        const paid = (relic.body?.reward as { currencies?: Record<string, number> }).currencies ?? {};
        // Keen Edge's 1.2x applies after the table: 2 Bone Charms → 2, 9-20 honor → 10-24.
        assert.equal(paid.boneCharms, 2);
        assert.ok(paid.honorSeals >= 10 && paid.honorSeals <= 24, `relic honor ${paid.honorSeals}`);

        await kv.set(runKey, { ...(await kv.get<HollowGateRunToken>(runKey))!, position: { x: 40 % 15, y: Math.floor(40 / 15) } });
        const secondRelic = await call(name, { token, action: 'hidden-relic', nodeId: 'floor:1:tile:40' });
        assert.equal(secondRelic.status, 429);
        assert.equal(secondRelic.body?.error, 'That event type is exhausted on this floor.');
        const replay = await call(name, { token, action: 'hidden-relic', nodeId: node });
        assert.equal(replay.status, 200);
        assert.equal(replay.body?.alreadyReported, true, 'the first relic replays; it never pays twice');
    });
});
