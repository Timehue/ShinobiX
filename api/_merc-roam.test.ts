import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickMercTarget, MERC_TARGET_COOLDOWN_MS, mercNpcId, parseMercNpcId, synthRoamingMercs, ROAMING_MERC_RENDER_CAP, type RoamTarget, type HostileBand } from './_merc-roam.js';

test('pickMercTarget snipes the LOWEST-HP enemy but has NO min-health gate', () => {
    const cands: RoamTarget[] = [
        { name: 'full', village: 'D Village', hp: 100, maxHp: 100 }, // full HP — still attackable now
        { name: 'hurt', village: 'D Village', hp: 30, maxHp: 100 },  // lowest fraction — the mark
        { name: 'mid', village: 'D Village', hp: 60, maxHp: 100 },
        { name: 'ally', village: 'A Village', hp: 5, maxHp: 100 },   // wrong village — ignored
        { name: 'dead', village: 'D Village', hp: 0, maxHp: 100 },   // already down — ignored
    ];
    assert.equal(pickMercTarget(cands, 'D Village')?.name, 'hurt');
    assert.equal(MERC_TARGET_COOLDOWN_MS, 15 * 60 * 1000);
});

test('pickMercTarget attacks a FULL-HP enemy when it is the only one present', () => {
    assert.equal(pickMercTarget([{ name: 'solo', village: 'D Village', hp: 100, maxHp: 100 }], 'D Village')?.name, 'solo');
});

test('pickMercTarget returns null when no living enemy-village player is present', () => {
    assert.equal(pickMercTarget([{ name: 'ally', village: 'A Village', hp: 10, maxHp: 100 }], 'D Village'), null);
    assert.equal(pickMercTarget([], 'D Village'), null);
});

test('pickMercTarget breaks ties by name (deterministic)', () => {
    const cands: RoamTarget[] = [
        { name: 'zed', village: 'D Village', hp: 10, maxHp: 100 },
        { name: 'amy', village: 'D Village', hp: 10, maxHp: 100 },
    ];
    assert.equal(pickMercTarget(cands, 'D Village')?.name, 'amy');
});

test('mercNpcId / parseMercNpcId round-trip the band (village slug + tier)', () => {
    const id = mercNpcId('Stormveil Village', 'oni', 2);
    assert.equal(id, 'merc-stormveilvillage-oni-2');
    assert.deepEqual(parseMercNpcId(id), { villageSlug: 'stormveilvillage', tierId: 'oni' });
});

test('parseMercNpcId rejects ids that are not roaming mercs', () => {
    assert.equal(parseMercNpcId('w-12-345-0'), null); // a wanderer id
    assert.equal(parseMercNpcId('merc-foo'), null);   // missing parts
    assert.equal(parseMercNpcId(''), null);
});

test('synthRoamingMercs emits one NPC per remaining merc, with stable per-band ids', () => {
    const bands: HostileBand[] = [
        { village: 'A Village', tierId: 'ronin', level: 75, count: 3, context: 'sector' },
        { village: 'B Village', tierId: 'oni', level: 95, count: 2, context: 'village' },
    ];
    const mercs = synthRoamingMercs(bands);
    assert.equal(mercs.length, 5);
    assert.equal(mercs[0].id, 'merc-avillage-ronin-0');
    assert.equal(mercs[0].context, 'sector');
    assert.equal(mercs[3].village, 'B Village');
    assert.equal(mercs[3].context, 'village');
});

test('synthRoamingMercs caps how many render in one sector', () => {
    const bands: HostileBand[] = [{ village: 'A Village', tierId: 'warlord', level: 100, count: 50, context: 'sector' }];
    assert.equal(synthRoamingMercs(bands).length, ROAMING_MERC_RENDER_CAP);
});
