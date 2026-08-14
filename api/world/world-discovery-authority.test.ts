import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-discovery-authority-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let petStart: Handler;
let petBefriend: Handler;
let petDecline: Handler;
let dungeonRun: Handler;
let explore: Handler;
let openChest: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    petStart = (await import('../pet/encounter-start.js')).default as unknown as Handler;
    petBefriend = (await import('../pet/befriend.js')).default as unknown as Handler;
    petDecline = (await import('../pet/encounter-decline.js')).default as unknown as Handler;
    dungeonRun = (await import('../dungeon/run.js')).default as unknown as Handler;
    explore = (await import('./explore.js')).default as unknown as Handler;
    openChest = (await import('./open-chest.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:discovery*',
        'pet-encounter*:discovery*',
        'pet-encounter-request:discovery*',
        'pet-encounter-declined:discovery*',
        'world-explore-receipt:discovery*',
        'missions:progress:discovery*',
        'ratelimit:*discovery*',
        'lock:*discovery*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('discovery')) onlineStore.remove(player.name);
    }
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

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: `127.2.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

async function seed(playerName: string, character: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 0,
        character: {
            name: playerName,
            level: 50,
            hp: 100,
            maxHp: 100,
            stamina: 100,
            maxStamina: 100,
            ryo: 0,
            inventory: [],
            itemStacks: [],
            ...character,
        },
    });
}

describe('durable World discovery handoff', () => {
    it('reconstructs unresolved hit and miss authority after the old 20-minute window', async () => {
        const mintedAt = Date.now() - 21 * 60 * 1_000;
        const day = new Date(mintedAt).toISOString().slice(0, 10);

        const hitPlayer = 'discoveryoldpethit';
        const hitRequestId = 'oldpethitrequest1';
        const token = 'oldpethittoken000001';
        const pet = { id: 'old-hit-pet', name: 'Recovered Pet', level: 1, stats: { hp: 10 } };
        await seed(hitPlayer);
        await kv.set(`pet-encounter-request:${hitPlayer}:${hitRequestId}`, {
            version: 1, playerName: hitPlayer, requestId: hitRequestId, day, sector: 66, mintedAt, token, pet,
        }, { ex: 32 * 24 * 60 * 60 });
        const hit = await post(petStart, hitPlayer, { sector: 66, requestId: hitRequestId });
        assert.equal(hit.statusCode, 200);
        assert.equal(hit.body?.token, token);
        assert.ok(await kv.get(`pet-encounter-active:${hitPlayer}`));
        assert.ok(await kv.get(`pet-encounter:${hitPlayer}:${token}`));
        const declined = await post(petDecline, hitPlayer, { token });
        assert.equal(declined.statusCode, 200);

        const missPlayer = 'discoveryoldpetmiss';
        const missRequestId = 'oldpetmissreq001';
        await seed(missPlayer);
        await kv.set(`pet-encounter-request:${missPlayer}:${missRequestId}`, {
            version: 1, playerName: missPlayer, requestId: missRequestId, day, sector: 65, mintedAt,
        }, { ex: 32 * 24 * 60 * 60 });
        const miss = await post(petStart, missPlayer, { sector: 65, requestId: missRequestId });
        assert.equal(miss.statusCode, 200);
        assert.equal(miss.body?.pet, null);
        assert.equal((await kv.get<Record<string, unknown>>(`pet-encounter-active:${missPlayer}`))?.requestId, missRequestId);
        const settled = await post(explore, missPlayer, { sector: 65, requestId: missRequestId, resolveOutcome: true });
        assert.equal(settled.statusCode, 200);
    });

    it('replays and consumes the exact cross-device pet miss without live presence', async () => {
        const player = 'discoverypetmiss';
        const requestId = 'petmissrequest01';
        const mintedAt = Date.now();
        await seed(player);
        await kv.set(`pet-encounter-active:${player}`, {
            playerName: player,
            requestId,
            outcome: 'miss',
            sector: 66,
            mintedAt,
        });
        await kv.set(`pet-encounter-request:${player}:${requestId}`, {
            version: 1,
            playerName: player,
            requestId,
            day: new Date(mintedAt).toISOString().slice(0, 10),
            sector: 66,
            mintedAt,
        });

        const rebound = await post(petStart, player, { sector: 1, requestId: 'newdevicepetreq1' });
        assert.equal(rebound.statusCode, 200);
        assert.equal(rebound.body?.requestId, requestId);
        assert.equal(rebound.body?.sector, 66);
        assert.equal(rebound.body?.pet, null);

        const mismatch = await post(explore, player, { sector: 1, requestId: 'wrongexploreid1', resolveOutcome: true });
        assert.equal(mismatch.statusCode, 409);
        assert.equal(mismatch.body?.error, 'pending-pet-discovery');
        assert.equal(mismatch.body?.requestId, requestId);
        assert.equal(mismatch.body?.sector, 66);

        const settled = await post(explore, player, { sector: 66, requestId, resolveOutcome: true });
        assert.equal(settled.statusCode, 200);
        assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
        const receipt = await kv.get<Record<string, unknown>>(`pet-encounter-request:${player}:${requestId}`);
        assert.equal(receipt?.resolution, 'explored-miss');

        const oldRequest = await post(petStart, player, { sector: 66, requestId });
        assert.equal(oldRequest.statusCode, 200);
        assert.equal(oldRequest.body?.resolved, true);
        assert.equal(oldRequest.body?.resolution, 'explored-miss');
        assert.equal(oldRequest.body?.token, undefined);
    });

    it('gives an older pet result precedence over a stray dungeon miss and terminalizes decline', async () => {
        const player = 'discoverypetprecedence';
        const petRequestId = 'petprecedence01';
        const dungeonRequestId = 'dungeonstray001';
        const token = 'petprecedencetoken001';
        const mintedAt = Date.now();
        const pet = { id: 'wild-pet-test', name: 'Wild Test', level: 1, stats: { hp: 10 } };
        await seed(player, {
            serverFreeDungeonProbeDate: new Date().toISOString().slice(0, 10),
            serverFreeDungeonProbesToday: 1,
            serverFreeDungeonProbeReceipts: [{
                requestId: dungeonRequestId,
                day: new Date().toISOString().slice(0, 10),
                sector: 61,
                found: false,
                token: '',
                at: mintedAt,
            }],
        });
        await kv.set(`pet-encounter-active:${player}`, {
            playerName: player,
            requestId: petRequestId,
            outcome: 'hit',
            token,
            pet,
            sector: 62,
            mintedAt,
        });
        await kv.set(`pet-encounter:${player}:${token}`, {
            playerName: player, requestId: petRequestId, token, pet, sector: 62, mintedAt,
        });
        await kv.set(`pet-encounter-request:${player}:${petRequestId}`, {
            version: 1,
            playerName: player,
            requestId: petRequestId,
            day: new Date().toISOString().slice(0, 10),
            sector: 62,
            mintedAt,
            token,
            pet,
        });

        const probe = await post(dungeonRun, player, { action: 'probe-free', sector: 1, requestId: 'newdeviceprobe01' });
        assert.equal(probe.statusCode, 200);
        assert.equal(probe.body?.found, false);
        assert.equal(probe.body?.requestId, petRequestId);
        assert.equal(probe.body?.sector, 62);
        const afterProbe = await kv.get<Record<string, unknown>>(`save:${player}`);
        const dungeonReceipts = (afterProbe?.character as Record<string, unknown>).serverFreeDungeonProbeReceipts as Array<Record<string, unknown>>;
        assert.equal(typeof dungeonReceipts[0]?.resolvedAt, 'number', 'stray miss is superseded atomically');

        const bound = await post(explore, player, {
            sector: 62,
            requestId: petRequestId,
            externalOutcomeProof: { kind: 'pet', token },
        });
        assert.equal(bound.statusCode, 200);
        assert.ok(await kv.get(`pet-encounter-active:${player}`), 'pet choice remains pending after exploration');

        const declined = await post(petDecline, player, { token });
        assert.equal(declined.statusCode, 200);
        assert.equal(await kv.get(`pet-encounter-active:${player}`), null);
        const terminalReplay = await post(petStart, player, { sector: 62, requestId: petRequestId });
        assert.equal(terminalReplay.body?.resolved, true);
        assert.equal(terminalReplay.body?.resolution, 'declined');
        assert.equal(terminalReplay.body?.token, undefined);
    });

    it('opens an exact durable chest after projection eviction and never pays it twice', async () => {
        const player = 'discoverychestmove';
        const discoveryId = 'chestdiscovery01';
        const discoveredAt = Date.now();
        await seed(player, {
            serverChestDate: new Date().toISOString().slice(0, 10),
            serverChestsToday: 1,
            redeemedSectorExplorations: Array.from({ length: 150 }, (_, index) => ({
                id: `newerexplore${String(index).padStart(3, '0')}`,
                sector: 1,
                reward: { sector: 1, ryo: 0, xp: 0 },
                outcome: { kind: 'none' },
                at: discoveredAt + index + 1,
            })),
        });
        await kv.set(`world-explore-receipt:${player}:${discoveryId}`, {
            version: 1,
            playerName: player,
            requestId: discoveryId,
            sector: 60,
            reward: { sector: 60, ryo: 0, xp: 0 },
            outcome: {
                kind: 'chest',
                reservationDate: new Date().toISOString().slice(0, 10),
                reservationOrdinal: 1,
            },
            at: discoveredAt,
        });
        const first = await post(openChest, player, { sector: 60, requestId: 'chestopenop0001', worldExploreRequestId: discoveryId });
        assert.equal(first.statusCode, 200);
        assert.equal(first.body?.replayed, false);
        const afterFirst = await kv.get<Record<string, unknown>>(`save:${player}`);
        const firstCharacter = afterFirst?.character as Record<string, unknown>;
        await kv.set(`save:${player}`, {
            ...afterFirst,
            character: {
                ...firstCharacter,
                redeemedAncientChests: Array.from({ length: 150 }, (_, index) => ({
                    id: `newerchest${String(index).padStart(3, '0')}`,
                    loot: { ryo: 0 },
                    at: discoveredAt + index + 1,
                })),
            },
        });
        const replay = await post(openChest, player, { sector: 60, requestId: 'chestopenop0002', worldExploreRequestId: discoveryId });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.replayed, true);
        assert.deepEqual(replay.body?.loot, first.body?.loot);
        assert.deepEqual((replay.body?.character as Record<string, unknown>).ryo, firstCharacter.ryo);
    });

    it('befriends a bound pet after the capped exploration projection is evicted', async () => {
        const player = 'discoverypetcompact';
        const requestId = 'petcompactreq01';
        const exploreReceiptId = 'petcompactexplore01';
        const token = 'petcompacttoken00001';
        const at = Date.now();
        const pet = { id: `standard-0-${at}`, rarity: 'standard' };
        await seed(player, {
            pets: [],
            redeemedSectorExplorations: Array.from({ length: 150 }, (_, index) => ({
                id: `compactexplore${String(index).padStart(3, '0')}`,
                sector: 1,
                reward: { sector: 1, ryo: 0, xp: 0 },
                at: at + index + 1,
            })),
        });
        await kv.set(`world-explore-receipt:${player}:${exploreReceiptId}`, {
            version: 1,
            playerName: player,
            requestId: exploreReceiptId,
            sector: 60,
            reward: { sector: 60, ryo: 0, xp: 0 },
            outcome: { kind: 'external', source: 'pet' },
            at,
        });
        await kv.set(`pet-encounter:${player}:${token}`, {
            playerName: player,
            requestId,
            token,
            pet,
            sector: 60,
            exploreReceiptId,
            mintedAt: at,
        });
        await kv.set(`pet-encounter-active:${player}`, {
            playerName: player,
            requestId,
            outcome: 'hit',
            token,
            pet,
            sector: 60,
            mintedAt: at,
        });
        await kv.set(`pet-encounter-request:${player}:${requestId}`, {
            version: 1,
            playerName: player,
            requestId,
            day: new Date(at).toISOString().slice(0, 10),
            sector: 60,
            mintedAt: at,
            token,
            pet,
        });

        const first = await post(petBefriend, player, { token });
        assert.equal(first.statusCode, 200);
        assert.equal(first.body?.replayed, false);
        assert.equal(((first.body?.character as Record<string, unknown>).pets as unknown[]).length, 1);
        const replay = await post(petBefriend, player, { token });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.replayed, true);
        assert.equal(((replay.body?.character as Record<string, unknown>).pets as unknown[]).length, 1);
    });

    it('replays a durable explore into the authoritative matching field run across devices', async () => {
        const player = 'discoveryfieldreplay';
        const requestId = 'fieldexplorereplay01';
        const missionId = 'fetch-d-supply-trail';
        const runId = 'fieldrunreplay000001';
        const at = Date.now() - 1_000;
        await seed(player, {
            ryo: 777,
            redeemedSectorExplorations: Array.from({ length: 150 }, (_, index) => ({
                id: `fieldnewer${String(index).padStart(3, '0')}`,
                sector: 1,
                reward: { sector: 1, ryo: 0, xp: 0 },
                at: at + index + 1,
            })),
            serverFieldMissionRuns: {
                [missionId]: { missionId, runId, acceptedAt: at - 1_000 },
            },
        });
        const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
        await kv.set(`save:${player}`, { ...saved, acceptedMissionIds: [missionId] });
        await kv.set(`world-explore-receipt:${player}:${requestId}`, {
            version: 1,
            playerName: player,
            requestId,
            sector: 18,
            reward: { sector: 18, ryo: 25, xp: 0 },
            outcome: { kind: 'none' },
            at,
        });

        const replay = await post(explore, player, { sector: 18, requestId, resolveOutcome: true });
        assert.equal(replay.statusCode, 200);
        assert.equal(replay.body?.replayed, true);
        assert.equal((replay.body?.character as Record<string, unknown>).ryo, 777, 'durable replay never reapplies tile reward');
        const progress = replay.body?.fieldProgress as Array<Record<string, unknown>>;
        assert.deepEqual(progress.map((entry) => [entry.missionId, entry.runId, entry.exploreCount]), [[missionId, runId, 1]]);
        const receipt = await kv.get<Record<string, unknown>>(`missions:progress:${player}:${missionId}`);
        assert.equal(receipt?.runId, runId);
        assert.equal(receipt?.exploreCount, 1);

        const second = await post(explore, player, { sector: 18, requestId, resolveOutcome: true });
        assert.equal(second.statusCode, 200);
        assert.equal(((second.body?.fieldProgress as Array<Record<string, unknown>>)[0]).replayed, true);
        assert.equal((second.body?.character as Record<string, unknown>).ryo, 777);
    });
});
