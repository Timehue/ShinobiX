import test from 'node:test';
import assert from 'node:assert/strict';
import { clanXpMemberScale, scaledClanXp } from './_mission-catalog.js';
import { clanBossEngagedXp, CB_ENGAGED_XP_FLOOR, CB_ENGAGED_XP_CAP } from '../clan-boss/_storage.js';

// Member-count scaling: a 1–5 member clan can't rush hall tiers; 10–15 = the
// "normal" balance scale (1.0×); capped at 1.0× so mega-clans don't run away.
test('clanXpMemberScale dampens small clans and caps at 1.0x', () => {
    assert.equal(clanXpMemberScale(1), 0.2);
    assert.equal(clanXpMemberScale(2), 0.2);
    assert.equal(clanXpMemberScale(3), 0.4);
    assert.equal(clanXpMemberScale(5), 0.4);
    assert.equal(clanXpMemberScale(6), 0.7);
    assert.equal(clanXpMemberScale(9), 0.7);
    assert.equal(clanXpMemberScale(10), 1);   // normal scale begins
    assert.equal(clanXpMemberScale(15), 1);
    assert.equal(clanXpMemberScale(50), 1);   // capped — no mega-clan runaway
    assert.equal(clanXpMemberScale(0), 0.2);  // defensive (clan always has ≥1)
});

test('scaledClanXp floors the member-scaled amount', () => {
    assert.equal(scaledClanXp(4100, 12), 4100); // normal clan = full mission set
    assert.equal(scaledClanXp(4100, 5), 1640);  // 0.4×
    assert.equal(scaledClanXp(4100, 1), 820);   // 0.2×
    assert.equal(scaledClanXp(450, 6), 315);    // 0.7× of a single mission
    assert.equal(scaledClanXp(0, 12), 0);
    assert.equal(scaledClanXp(100, 0), 20);
});

// Boss "engaged" XP: any clan that dealt damage (not just killers) climbs,
// damage-scaled between a floor and a cap.
test('clanBossEngagedXp rewards damagers with a floor + cap', () => {
    assert.equal(clanBossEngagedXp(0), 0);                       // no damage = no reward
    assert.equal(clanBossEngagedXp(1), CB_ENGAGED_XP_FLOOR);     // tiny damage ≈ floor
    assert.ok(clanBossEngagedXp(1000) > CB_ENGAGED_XP_FLOOR);
    assert.equal(clanBossEngagedXp(10_000_000), CB_ENGAGED_XP_CAP); // capped
});
