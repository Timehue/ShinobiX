/**
 * Pure-math guards for the Clan Raid Boss (api/clan/raid/_storage.ts).
 * Covers per-capita HP scaling, deterministic strike damage, reward shares,
 * ISO week ids, boss rotation, and the seeded roll helper.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    RAID_ATTEMPTS_PER_MEMBER, RAID_BASE_HP, RAID_HP_PER_MEMBER, RAID_MEMBER_CAP,
    RAID_MIN_PERSONAL_RYO, RAID_KILL_BONUS_MULT, RAID_RYO_POOL, RAID_BOSSES,
    raidBossHp, raidStrikeDamage, raidPersonalReward, raidWeekId, raidPickBossId,
    raidStrikeRolls, raidStatTotal, newRaid, raidLeaderboard, raidTopContributor,
    type ClanRaid,
} from './_storage.js';

describe('raidBossHp — per-capita scaling', () => {
    it('scales with member count', () => {
        assert.equal(raidBossHp(1), RAID_BASE_HP + RAID_HP_PER_MEMBER);
        assert.equal(raidBossHp(4), RAID_BASE_HP + RAID_HP_PER_MEMBER * 4);
        assert.ok(raidBossHp(10) > raidBossHp(4), 'bigger clan → more HP');
    });
    it('floors at 1 member and caps at RAID_MEMBER_CAP', () => {
        assert.equal(raidBossHp(0), RAID_BASE_HP + RAID_HP_PER_MEMBER);
        assert.equal(raidBossHp(-5), RAID_BASE_HP + RAID_HP_PER_MEMBER);
        assert.equal(raidBossHp(999), RAID_BASE_HP + RAID_HP_PER_MEMBER * RAID_MEMBER_CAP);
    });
    it('keeps per-member effort roughly constant (small clan is viable)', () => {
        // HP per available strike shouldn't explode as the clan grows.
        const small = raidBossHp(4) / (4 * RAID_ATTEMPTS_PER_MEMBER);
        const big = raidBossHp(20) / (20 * RAID_ATTEMPTS_PER_MEMBER);
        assert.ok(Math.abs(small - big) < small * 0.5, 'per-strike requirement stays comparable');
    });
});

describe('raidStrikeDamage', () => {
    it('is deterministic for the same inputs', () => {
        const a = raidStrikeDamage(30, 2000, 0.5, 0.9);
        const b = raidStrikeDamage(30, 2000, 0.5, 0.9);
        assert.deepEqual(a, b);
    });
    it('crits only when critRoll < crit chance', () => {
        const crit = raidStrikeDamage(30, 0, 0.5, 0.0);
        const normal = raidStrikeDamage(30, 0, 0.5, 0.99);
        assert.equal(crit.crit, true);
        assert.equal(normal.crit, false);
        assert.ok(crit.damage > normal.damage, 'crit hits harder at equal variance');
    });
    it('higher level and stats increase damage', () => {
        const lo = raidStrikeDamage(10, 0, 0.5, 0.9).damage;
        const hiLevel = raidStrikeDamage(60, 0, 0.5, 0.9).damage;
        const hiStats = raidStrikeDamage(10, 8000, 0.5, 0.9).damage;
        assert.ok(hiLevel > lo);
        assert.ok(hiStats > lo);
    });
    it('never deals less than 1', () => {
        assert.ok(raidStrikeDamage(1, 0, 0, 0.99).damage >= 1);
    });
    it('variance stays within ±15% of the crit-free base', () => {
        const low = raidStrikeDamage(50, 0, 0, 0.99).damage;
        const high = raidStrikeDamage(50, 0, 0.999999, 0.99).damage;
        assert.ok(high > low);
        // ratio is (1+0.15)/(1-0.15) ≈ 1.353
        assert.ok(high / low <= 1.36, 'span is roughly 0.85..1.15');
    });
});

describe('raidPersonalReward', () => {
    it('splits the pool by damage share', () => {
        const r = raidPersonalReward(500, 1000, false);
        assert.equal(r.ryo, Math.round(RAID_RYO_POOL * 0.5));
    });
    it('floors at the minimum for tiny contributors', () => {
        const r = raidPersonalReward(1, 1_000_000, false);
        assert.equal(r.ryo, RAID_MIN_PERSONAL_RYO);
    });
    it('applies the kill bonus', () => {
        const noKill = raidPersonalReward(500, 1000, false).ryo;
        const kill = raidPersonalReward(500, 1000, true).ryo;
        assert.equal(kill, Math.round(noKill * RAID_KILL_BONUS_MULT));
    });
    it('handles zero total damage without dividing by zero', () => {
        const r = raidPersonalReward(0, 0, false);
        assert.equal(r.ryo, RAID_MIN_PERSONAL_RYO);
    });
});

describe('raidWeekId', () => {
    it('formats as YYYY-Www', () => {
        assert.match(raidWeekId(Date.UTC(2026, 6, 3)), /^\d{4}-W\d{2}$/);
    });
    it('is stable within a week and changes across weeks', () => {
        const mon = Date.UTC(2026, 5, 29); // a Monday
        const wed = mon + 2 * 86400000;
        const nextWeek = mon + 8 * 86400000;
        assert.equal(raidWeekId(mon), raidWeekId(wed));
        assert.notEqual(raidWeekId(mon), raidWeekId(nextWeek));
    });
});

describe('raidPickBossId', () => {
    it('returns a real boss id and is deterministic', () => {
        const id = raidPickBossId('2026-W27');
        assert.ok(RAID_BOSSES.some(b => b.id === id));
        assert.equal(id, raidPickBossId('2026-W27'));
    });
});

describe('raidStrikeRolls', () => {
    it('is deterministic and in range', () => {
        const a = raidStrikeRolls('rill:2026-W27:0');
        const b = raidStrikeRolls('rill:2026-W27:0');
        assert.deepEqual(a, b);
        assert.ok(a.variance >= 0 && a.variance < 1);
        assert.ok(a.critRoll >= 0 && a.critRoll < 1);
    });
    it('differs across attempts', () => {
        assert.notDeepEqual(raidStrikeRolls('rill:2026-W27:0'), raidStrikeRolls('rill:2026-W27:1'));
    });
});

describe('raidStatTotal', () => {
    it('sums combat stats defensively', () => {
        assert.equal(raidStatTotal(null), 0);
        assert.equal(raidStatTotal({ stats: { strength: 100, speed: 50 } }), 150);
        assert.equal(raidStatTotal({ stats: { strength: -10 } }), 0);
    });
});

describe('newRaid + leaderboard', () => {
    it('starts at full HP with a valid boss', () => {
        const raid = newRaid('Stormbreakers', '2026-W27', 5, 1000);
        assert.equal(raid.hp, raid.hpMax);
        assert.equal(raid.hpMax, raidBossHp(5));
        assert.ok(RAID_BOSSES.some(b => b.id === raid.bossId));
    });
    it('ranks contributors by damage', () => {
        const raid: ClanRaid = {
            clanName: 'X', weekId: 'w', bossId: 'oni-warlord', hpMax: 100, hp: 0,
            memberCountAtStart: 3, startedAt: 0, updatedAt: 0,
            members: {
                a: { damage: 30, attemptsUsed: 1, claimed: false },
                b: { damage: 70, attemptsUsed: 2, claimed: false },
                c: { damage: 0, attemptsUsed: 0, claimed: false },
            },
        };
        const board = raidLeaderboard(raid);
        assert.equal(board[0].name, 'b');
        assert.equal(board[0].damage, 70);
        assert.equal(raidTopContributor(raid), 'b');
        assert.ok(!board.some(e => e.name === 'c'), 'zero-activity members excluded');
    });
});
