import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-sector-holder-rules-test-secret-32-bytes';
process.env.ADMIN_PASSWORD = 'war-sector-holder-rules-admin';
delete process.env.DISABLE_VILLAGE_WAR;

/*
 * Owner ruling 2026-10-08: the CURRENT HOLDER of a sector sets its rules.
 *
 * Before it, only a sector's HOME village could set its win-condition and
 * terrain, even after losing it, while a war on it read the holder's record,
 * which kept no entry for a captured sector: the old owner's settings were
 * shown and editable but changed nothing, and every captured sector was fought
 * as Combat on neutral ground. Terrain was also read live at every bind, so a
 * defender could change it mid-war.
 */

const LEAF = 'Ashen Leaf Village';      // home 9-16
const FROST = 'Frostfang Village';      // home 26-33
const MOON = 'Moonshadow Village';      // home 17-24
const CAPTURED = 27;                    // Frostfang home, held by Ashen Leaf
const LOST = 16;                        // Ashen Leaf home, held by Frostfang

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let winCondition: Handler;
let terrain: Handler;
let warMap: Handler;
let sectorWar: Handler;

function unwrap(mod: { default: unknown }): Handler {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as Handler;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    winCondition = unwrap(await import('./war-win-condition.js'));
    terrain = unwrap(await import('./war-terrain.js'));
    warMap = unwrap(await import('./war-map.js'));
    sectorWar = unwrap(await import('./sector-war.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    const now = Date.now();
    // Every war sector held by its home village, except the two that changed hands.
    const homes: Array<[string, number[]]> = [
        [LEAF, [9, 10, 11, 12, 13, 14, 15, 16]],
        [FROST, [26, 27, 28, 29, 30, 31, 32, 33]],
        [MOON, [17, 18, 19, 20, 21, 22, 23, 24]],
        ['Stormveil Village', [1, 2, 3, 4, 5, 6, 7, 8]],
    ];
    for (const [village, sectors] of homes) {
        for (const sector of sectors) {
            const ownerVillage = sector === CAPTURED ? LEAF : sector === LOST ? FROST : village;
            await kv.set(`world:territory:${sector}`, { sector, ownerVillage, hp: 20_000, updatedAt: now });
        }
    }
    await kv.set('save:leafkage', { character: { name: 'leafkage', village: LEAF } });
    await kv.set('village:kage:ashen-leaf-village', { seatedKage: 'leafkage' });
    await kv.set('save:frostkage', { character: { name: 'frostkage', village: FROST } });
    await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
    await kv.set('shared:village-war:moonshadowvillage', { warResources: 1_000, structures: {}, sectors: {} });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

async function call(handler: Handler, player: string | null, body: Record<string, unknown>, method = 'POST'): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Record<string, any>) { out.body = payload; return res; },
        end: () => res,
    };
    const headers: Record<string, string> = player
        ? { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' }
        : { 'x-admin-password': process.env.ADMIN_PASSWORD! };
    await handler({ method, body, query: {}, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

async function record(village: string): Promise<Record<string, any>> {
    return (await kv.get<Record<string, any>>(`shared:village-war:${village.toLowerCase().replace(/[^a-z0-9]/g, '')}`)) ?? {};
}

describe('the current holder sets a sector\'s rules', { concurrency: false }, () => {
    it('the holder sets a captured sector\'s win-condition and terrain', async () => {
        const wc = await call(winCondition, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, winCondition: 'card' });
        assert.equal(wc.statusCode, 200, JSON.stringify(wc.body));
        const tr = await call(terrain, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, terrain: 'volcano' });
        assert.equal(tr.statusCode, 200, JSON.stringify(tr.body));
        assert.deepEqual((await record(LEAF)).sectors?.[String(CAPTURED)], { winCondition: 'card', terrain: 'volcano' });
    });

    it('a village that lost a sector can no longer set it', async () => {
        const fromOldOwner = await call(winCondition, 'frostkage', { playerName: 'frostkage', village: FROST, sector: CAPTURED, winCondition: 'pet' });
        assert.equal(fromOldOwner.statusCode, 400, JSON.stringify(fromOldOwner.body));
        const lostHome = await call(terrain, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: LOST, terrain: 'shadow' });
        assert.equal(lostHome.statusCode, 400, JSON.stringify(lostHome.body));
    });

    it('the War Map lists each sector under its holder, with the holder\'s rules', async () => {
        await call(winCondition, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, winCondition: 'card' });
        const map = await call(warMap, 'leafkage', {}, 'GET');
        assert.equal(map.statusCode, 200, JSON.stringify(map.body));
        const view = (village: string) => (map.body?.villages as Array<Record<string, any>>).find((v) => v.village === village)!;
        const leafSectors = view(LEAF).sectors.map((s: Record<string, unknown>) => s.sector);
        assert.ok(leafSectors.includes(CAPTURED), 'the captured sector is listed under its holder');
        assert.ok(!leafSectors.includes(LOST), 'the lost one is not');
        assert.equal(view(LEAF).sectors.find((s: Record<string, unknown>) => s.sector === CAPTURED).winCondition, 'card');
        assert.ok(!view(FROST).sectors.some((s: Record<string, unknown>) => s.sector === CAPTURED));
        assert.deepEqual(view(LEAF).homeSectors, [9, 10, 11, 12, 13, 14, 15, 16], 'the home table is still reported');
    });

    it('a war on a captured sector is fought on the holder\'s rules, sealed when it is declared', async () => {
        await call(winCondition, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, winCondition: 'card' });
        await call(terrain, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, terrain: 'volcano' });

        const declared = await call(sectorWar, null, { action: 'declare', playerName: 'opsadmin', village: MOON, sector: CAPTURED });
        assert.equal(declared.statusCode, 200, JSON.stringify(declared.body));
        assert.equal(declared.body?.contest?.winCondition, 'card', 'the holder\'s win-condition, not Combat');
        const contestKey = `shared:sector-war:${CAPTURED}:moonshadowvillage-vs-ashenleafvillage`;
        assert.equal((await kv.get<Record<string, unknown>>(contestKey))?.terrain, 'volcano', 'the holder\'s terrain is sealed into the war');

        // A change mid-war moves nothing for this war.
        const changed = await call(terrain, 'leafkage', { playerName: 'leafkage', village: LEAF, sector: CAPTURED, terrain: 'shadow' });
        assert.equal(changed.statusCode, 200, JSON.stringify(changed.body));
        assert.equal((await kv.get<Record<string, unknown>>(contestKey))?.terrain, 'volcano');
    });
});
