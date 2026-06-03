import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeSector,
    capTravelingUntil,
    slimPresenceCharacter,
    toPlayerRecord,
    MAX_TRAVEL_WINDOW_MS,
} from './presence-input.js';
import type { OnlinePlayer } from './types.js';

test('normalizeSector: floors, clamps to >=0, falls back on garbage', () => {
    assert.equal(normalizeSector(40), 40);
    assert.equal(normalizeSector('7'), 7);
    assert.equal(normalizeSector(3.9), 3);
    assert.equal(normalizeSector(-5), 0);
    assert.equal(normalizeSector(undefined), 40);
    assert.equal(normalizeSector('nope', 12), 12);
});

test('capTravelingUntil: undefined/0 → undefined', () => {
    assert.equal(capTravelingUntil(undefined, 1000), undefined);
    assert.equal(capTravelingUntil(0, 1000), undefined);
});
test('capTravelingUntil: past value → undefined (not traveling)', () => {
    assert.equal(capTravelingUntil(500, 1000), undefined);
});
test('capTravelingUntil: near-future value passes through', () => {
    assert.equal(capTravelingUntil(1000 + 5_000, 1000), 6_000);
});
test('capTravelingUntil: caps an exploit far-future value to now+MAX', () => {
    const now = 1_000;
    assert.equal(capTravelingUntil(now + 999_999_999, now), now + MAX_TRAVEL_WINDOW_MS);
});

test('slimPresenceCharacter: keeps only display fields, drops fat blobs', () => {
    const slim = slimPresenceCharacter({
        name: 'Naru', level: 30, village: 'Leaf', specialty: 'Ninjutsu',
        avatarImage: 'data:image/png;base64,AAAA....(huge)', inventory: [1, 2, 3],
        jutsu: [{ a: 1 }], ryo: 99999,
    });
    assert.ok(slim);
    assert.equal(slim!.name, 'Naru');
    assert.equal(slim!.level, 30);
    assert.equal(slim!.village, 'Leaf');
    assert.equal('avatarImage' in slim!, false);
    assert.equal('inventory' in slim!, false);
    assert.equal('jutsu' in slim!, false);
    assert.equal('ryo' in slim!, false);
});
test('slimPresenceCharacter: pets are slimmed to public fields', () => {
    const slim = slimPresenceCharacter({
        name: 'X', pets: [{ id: 'p1', name: 'Kit', level: 5, attack: 10, secretSauce: 'nope' }],
    });
    const pets = slim!.pets as Array<Record<string, unknown>>;
    assert.equal(pets[0].id, 'p1');
    assert.equal(pets[0].attack, 10);
    assert.equal('secretSauce' in pets[0], false);
});
test('slimPresenceCharacter: non-object → null', () => {
    assert.equal(slimPresenceCharacter(null), null);
    assert.equal(slimPresenceCharacter('hi'), null);
    assert.equal(slimPresenceCharacter(undefined), null);
});

test('toPlayerRecord: shapes a stored entry, omits avatar blob', () => {
    const p: OnlinePlayer = {
        name: 'naru', displayName: 'Naru', sector: 12,
        character: { level: 30, village: 'Leaf', specialty: 'Taijutsu', avatarImage: 'data:...' },
        lastSeenAt: 5000, connectedAt: 1000, pendingAttacker: null,
        travelingUntil: 9999, inBattle: true,
    };
    const r = toPlayerRecord(p);
    assert.equal(r.name, 'Naru');           // display-cased
    assert.equal(r.sector, 12);
    assert.equal(r.currentSector, 12);
    assert.equal(r.level, 30);
    assert.equal(r.village, 'Leaf');
    assert.equal(r.specialty, 'Taijutsu');
    assert.equal(r.lastSeenAt, 5000);
    assert.equal(r.travelingUntil, 9999);
    assert.equal(r.inBattle, true);
    assert.deepEqual(r.character, { avatarImage: '' });  // no blob leak
});
test('toPlayerRecord: null character → safe defaults', () => {
    const p: OnlinePlayer = {
        name: 'x', displayName: 'X', sector: 0, character: null,
        lastSeenAt: 1, connectedAt: 1, pendingAttacker: null,
    };
    const r = toPlayerRecord(p);
    assert.equal(r.level, 1);
    assert.equal(r.village, '');
    assert.equal(r.specialty, 'Ninjutsu');
    assert.equal(r.inBattle, false);
    assert.equal(r.travelingUntil, 0);
});
