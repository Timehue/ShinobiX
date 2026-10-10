import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'war-structure-telemetry-test-secret-32b';

/*
 * War-economy telemetry de-dupes on eventId: an id already in the recent list is
 * dropped as a replay. The structure-upgrade id used to be
 * `structure:<village>:<structure>:<level>`, so when Ramparts or Watchtower reset
 * at peace and were bought again in the next war, that second (real) purchase
 * reused the first one's id and its WR spend vanished from the sink totals.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

const FROST = 'Frostfang Village';
const FROST_WAR = 'shared:village-war:frostfangvillage';
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let warStructure: Handler;
let telemetry: typeof import('../_war-telemetry.js');
let background: typeof import('../_background-work.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    warStructure = (await import('./war-structure.js')).default as unknown as Handler;
    telemetry = await import('../_war-telemetry.js');
    background = await import('../_background-work.js');
});

after(async () => {
    mock.timers.reset();
    await background.drainBackgroundWork();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function buy(structure: string): Promise<ResponseOut> {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    await warStructure({
        method: 'POST',
        body: { playerName: 'frostkage', village: FROST, structure },
        headers: { 'x-player-name': 'frostkage', 'x-player-token': issuePlayerToken('frostkage') ?? '' },
        socket: { remoteAddress: '127.0.0.9' },
    } as never, res as never);
    return out;
}

test('a per-war structure bought again in a later war is logged again, not dropped as a replay', async () => {
    mock.timers.enable({ apis: ['Date'], now: T0 });
    try {
        await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
        await kv.set('save:frostkage', { _saveVersion: 1, character: { name: 'frostkage', village: FROST, level: 50, ryo: 0 } });
        await kv.set(FROST_WAR, { warResources: 1_000, structures: { ramparts: 0, watchtower: 0, barracks: 0, warAcademy: 0, supplyDepot: 0, treasuryVault: 0 }, sectors: {}, mercLeases: [], dormant: false, lastWarPassDate: '', terrainSetBy: {} });

        const first = await buy('ramparts');
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.newLevel, 1);

        // The war ends: the daily pass resets the per-war structures at peace.
        const rec = await kv.get<{ structures: Record<string, number> }>(FROST_WAR);
        await kv.set(FROST_WAR, { ...rec, structures: { ...rec!.structures, ramparts: 0 } });

        // A later war: the Kage fortifies again, from level 0 to 1.
        mock.timers.setTime(T0 + 3 * 86_400_000);
        const second = await buy('ramparts');
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));
        assert.equal(second.body?.newLevel, 1);
        await background.drainBackgroundWork();

        const events = ((await kv.get<Array<{ eventId: string; kind: string; amount: number }>>(telemetry.WAR_ECO_TXN_LIST_KEY)) ?? [])
            .filter((e) => e.kind === 'wr.spend.structure');
        assert.equal(events.length, 2, 'both purchases are recorded');
        assert.notEqual(events[0].eventId, events[1].eventId);
        const agg = await kv.get<Record<string, number>>(telemetry.warEcoAggKey(FROST));
        assert.equal(agg?.['wr.spend.structure'], Number(first.body?.cost) + Number(second.body?.cost), 'the sink counts both spends');
    } finally {
        mock.timers.reset();
    }
});
