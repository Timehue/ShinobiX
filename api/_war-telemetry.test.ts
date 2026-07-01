import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyEventToAgg,
    summarizeVillageAgg,
    duplicateEventIds,
    recordWarEcoEvent,
    readWarEcoSnapshot,
    warEcoAggKey,
    villageSlug,
    WAR_ECO_TXN_LIST_KEY,
    type WarEcoAgg,
    type WarEcoEvent,
} from './_war-telemetry.js';

// In-memory kv matching the Pick<kv,'get'|'set'> surface the sink uses.
function memKv() {
    const m = new Map<string, unknown>();
    return {
        store: m,
        get: async <T>(k: string): Promise<T | null> => (m.has(k) ? (m.get(k) as T) : null),
        set: async (k: string, v: unknown): Promise<void> => { m.set(k, v); },
    };
}

test('villageSlug + warEcoAggKey normalize the display name', () => {
    assert.equal(villageSlug('Stormveil Village'), 'stormveil-village');
    assert.equal(warEcoAggKey('Ashen Leaf Village'), 'war:eco:agg:ashen-leaf-village');
});

test('applyEventToAgg folds amounts additively per kind, ignoring non-positive', () => {
    let agg: WarEcoAgg = {};
    agg = applyEventToAgg(agg, 'wr.earn', 100);
    agg = applyEventToAgg(agg, 'wr.earn', 50);
    agg = applyEventToAgg(agg, 'wr.spend.declare', 250);
    assert.equal(agg['wr.earn'], 150);
    assert.equal(agg['wr.spend.declare'], 250);
    // Zero / negative / NaN are no-ops (the kind carries the sign, not the amount).
    assert.deepEqual(applyEventToAgg(agg, 'wr.earn', 0), agg);
    assert.deepEqual(applyEventToAgg(agg, 'wr.earn', -10), agg);
    assert.deepEqual(applyEventToAgg(agg, 'wr.earn', Number.NaN), agg);
});

test('summarizeVillageAgg derives WR + seal faucet/sink/net + tax split', () => {
    const agg: WarEcoAgg = {
        'wr.earn': 1000,
        'wr.spend.declare': 250,
        'wr.spend.maintenance': 120,
        'wr.spend.merc': 60,
        'seals.earn': 800,
        'seals.spend.structure': 300,
        'tax.collect': 500,
        'tax.burn': 250,
        'tax.treasury': 250,
        'dormancy.enter': 1,
        'sector.capture': 3,
    };
    const v = summarizeVillageAgg(agg);
    assert.equal(v.wrIn, 1000);
    assert.equal(v.wrOut, 250 + 120 + 60); // declare + maintenance + merc
    assert.equal(v.wrNet, 1000 - 430);
    assert.equal(v.sealsIn, 800);
    assert.equal(v.sealsOut, 300);        // structure upgrades
    assert.equal(v.sealsNet, 500);
    assert.equal(v.taxCollected, 500);
    assert.equal(v.taxBurned, 250);
    assert.equal(v.taxTreasury, 250);
    assert.equal(v.maintenancePaid, 120);
    assert.equal(v.dormancyEnters, 1);
    assert.equal(v.sectorsCaptured, 3);
});

test('duplicateEventIds flags a replayed eventId', () => {
    const evs = [
        { eventId: 'declare:5:20260630' },
        { eventId: 'declare:6:20260630' },
        { eventId: 'declare:5:20260630' },
    ] as WarEcoEvent[];
    assert.deepEqual(duplicateEventIds(evs), ['declare:5:20260630']);
    assert.deepEqual(duplicateEventIds([{ eventId: 'a' }] as WarEcoEvent[]), []);
});

test('recordWarEcoEvent writes the per-village aggregate + capped list', async () => {
    const kv = memKv();
    await recordWarEcoEvent({ eventId: 'd1', village: 'Stormveil Village', kind: 'wr.spend.declare', amount: 250 }, { kv });
    await recordWarEcoEvent({ eventId: 'e1', village: 'Stormveil Village', kind: 'wr.earn', amount: 80, meta: 'sector:31' }, { kv });

    const agg = (await kv.get(warEcoAggKey('Stormveil Village'))) as WarEcoAgg;
    assert.equal(agg['wr.spend.declare'], 250);
    assert.equal(agg['wr.earn'], 80);

    const list = (await kv.get(WAR_ECO_TXN_LIST_KEY)) as WarEcoEvent[];
    assert.equal(list.length, 2);
    assert.equal(list[0].eventId, 'e1');   // newest-first
    assert.equal(list[0].meta, 'sector:31');
    assert.equal(list[1].eventId, 'd1');
});

test('recordWarEcoEvent is a best-effort no-op on bad input (never throws)', async () => {
    const kv = memKv();
    await recordWarEcoEvent({ eventId: 'x', village: 'Stormveil Village', kind: 'not-a-kind', amount: 50 }, { kv });
    await recordWarEcoEvent({ eventId: 'x', village: 'Stormveil Village', kind: 'wr.earn', amount: 0 }, { kv });
    await recordWarEcoEvent({ eventId: 'x', village: '', kind: 'wr.earn', amount: 50 }, { kv });
    assert.equal(kv.store.size, 0); // nothing written for any invalid event
});

test('readWarEcoSnapshot returns per-village views + recent + dup flags', async () => {
    const kv = memKv();
    await recordWarEcoEvent({ eventId: 'a', village: 'Frostfang Village', kind: 'wr.earn', amount: 200 }, { kv });
    await recordWarEcoEvent({ eventId: 'b', village: 'Frostfang Village', kind: 'wr.spend.merc', amount: 75 }, { kv });
    // A village with no events is omitted from the snapshot.
    const snap = await readWarEcoSnapshot(['Frostfang Village', 'Moonshadow Village'], 50, { kv });
    assert.ok(snap.villages['Frostfang Village']);
    assert.equal(snap.villages['Frostfang Village'].wrIn, 200);
    assert.equal(snap.villages['Frostfang Village'].wrOut, 75);
    assert.equal(snap.villages['Frostfang Village'].wrNet, 125);
    assert.equal(snap.villages['Moonshadow Village'], undefined);
    assert.equal(snap.recent.length, 2);
    assert.deepEqual(snap.duplicateEventIds, []);
});
