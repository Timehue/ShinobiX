import test from 'node:test';
import assert from 'node:assert/strict';
import { clanXpMemberScale, scaledClanXp } from './_mission-catalog.js';
import { clanBossEngagedXp, CB_ENGAGED_XP_FLOOR, CB_ENGAGED_XP_CAP } from '../clan-boss/_storage.js';

test('clanXpMemberScale gives every completed objective full value', () => {
    assert.equal(clanXpMemberScale(1), 1);
    assert.equal(clanXpMemberScale(2), 1);
    assert.equal(clanXpMemberScale(5), 1);
    assert.equal(clanXpMemberScale(10), 1);
    assert.equal(clanXpMemberScale(15), 1);
    assert.equal(clanXpMemberScale(50), 1);
    assert.equal(clanXpMemberScale(0), 1);
});

test('scaledClanXp floors the member-scaled amount', () => {
    assert.equal(scaledClanXp(4100, 12), 4100); // normal clan = full mission set
    assert.equal(scaledClanXp(4100, 5), 4100);
    assert.equal(scaledClanXp(4100, 1), 4100);
    assert.equal(scaledClanXp(450, 6), 450);
    assert.equal(scaledClanXp(0, 12), 0);
    assert.equal(scaledClanXp(100, 0), 100);
});

// Boss "engaged" XP: any clan that dealt damage (not just killers) climbs,
// damage-scaled between a floor and a cap.
test('clanBossEngagedXp rewards damagers with a floor + cap', () => {
    assert.equal(clanBossEngagedXp(0), 0);                       // no damage = no reward
    assert.equal(clanBossEngagedXp(1), CB_ENGAGED_XP_FLOOR);     // tiny damage ≈ floor
    assert.ok(clanBossEngagedXp(1000) > CB_ENGAGED_XP_FLOOR);
    assert.equal(clanBossEngagedXp(10_000_000), CB_ENGAGED_XP_CAP); // capped
});
