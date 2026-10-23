import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clanPointMonthKey } from '../_clan-points.js';
import {
    CLAN_MISSION_REWARDS, CLAN_MISSION_TARGETS, clanMissionPointEligible, clanMissionProgressServer,
    clanRosterMonthKey, memberMonthCounters, withRosterEventContrib,
} from './_mission-catalog.js';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const MONTH = '2026-10';
const LAST_MONTH = '2026-09';
const read = (rel: string) => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8');

type Row = { name: string; level?: number; battleContrib?: number; missionContrib?: number; eventContrib?: number; month?: string };
const clanOf = (members: Row[], treasuryRyo = 0) => ({ name: 'Mist', members, treasury: { ryo: treasuryRyo } });
const progress = (members: Row[], key: Parameters<typeof clanMissionProgressServer>[3], territories: Record<string, unknown>[] = [], treasuryRyo = 0) =>
    clanMissionProgressServer(clanOf(members, treasuryRyo), 'Mist', territories, key, NOW);
const rows = (n: number, row: Omit<Row, 'name'>) => Array.from({ length: n }, (_, i) => ({ name: `member-${i}`, ...row }));

describe('clan mission rewards (economy rebalance 2026-10)', () => {
    it('pays no Mythic Seal anywhere: S-rank is locked and its faucet is zero (I-8)', () => {
        for (const [key, reward] of Object.entries(CLAN_MISSION_REWARDS)) {
            assert.equal(reward?.treasury?.mythicSeals, undefined, `${key} still pays a Mythic Seal`);
        }
        assert.deepEqual(CLAN_MISSION_REWARDS.raid, { clanXp: 1_350 });
    });

    it('the client mission cards quote the server clan XP, targets and rewards', () => {
        const cards = read('shinobij.client/src/constants/clan.ts');
        for (const [key, reward] of Object.entries(CLAN_MISSION_REWARDS)) {
            const card = new RegExp(`key: "${key}"[^\\n]*?target: ([\\d_]+)[^\\n]*?reward: "\\+([\\d,]+) Clan XP([^"]*)"`).exec(cards);
            assert.ok(card, `no card for ${key}`);
            assert.equal(Number(card![1].replace(/_/g, '')), CLAN_MISSION_TARGETS[key as keyof typeof CLAN_MISSION_TARGETS], `${key} target`);
            assert.equal(Number(card![2].replace(/,/g, '')), reward!.clanXp, `${key} clan XP`);
            assert.doesNotMatch(card![3], /Mythic Seal/, `${key} card still advertises a Mythic Seal`);
        }
    });
});

describe('roster counters count only this month (I-15)', () => {
    it('uses the same month key as the clan save validator and Clan Points', () => {
        assert.equal(clanRosterMonthKey(NOW), clanPointMonthKey(new Date(NOW)));
        assert.equal(clanRosterMonthKey(NOW), MONTH);
    });

    it('reads a current row, and zeroes a stale or unstamped one', () => {
        assert.deepEqual(memberMonthCounters({ battleContrib: 3, missionContrib: 2, eventContrib: 25, month: MONTH }, NOW), { battle: 3, mission: 2, event: 25 });
        assert.deepEqual(memberMonthCounters({ battleContrib: 3, missionContrib: 2, eventContrib: 25, month: LAST_MONTH }, NOW), { battle: 0, mission: 0, event: 0 });
        assert.deepEqual(memberMonthCounters({ battleContrib: 3, missionContrib: 2, eventContrib: 25 }, NOW), { battle: 0, mission: 0, event: 0 });
    });

    it('donation reads this month\'s contribution, never the standing treasury balance', () => {
        assert.equal(progress([{ name: 'idle', eventContrib: 0, month: MONTH }], 'donation', [], 1_000_000), 0, 'a parked 1,000,000 ryo pays nothing');
        assert.equal(progress([{ name: 'giver', eventContrib: 25, month: MONTH }], 'donation'), 25_000);
        assert.ok(progress([{ name: 'giver', eventContrib: 25, month: MONTH }], 'donation') >= CLAN_MISSION_TARGETS.donation);
        assert.equal(progress([{ name: 'alt', eventContrib: 25, month: LAST_MONTH }], 'donation'), 0, 'a one-time donor who went idle stops paying');
    });

    it('guard counts level-5+ members active this month, plus sector guards', () => {
        assert.equal(progress(rows(10, { level: 40, month: MONTH }), 'guard'), 0, 'ten idle members');
        assert.equal(progress(rows(10, { level: 40, missionContrib: 1, month: MONTH }), 'guard'), 10);
        assert.equal(progress(rows(10, { level: 40, battleContrib: 1, month: LAST_MONTH }), 'guard'), 0, 'active last month only');
        assert.equal(progress(rows(10, { level: 4, battleContrib: 1, month: MONTH }), 'guard'), 0, 'level is still gated');
        const sector = { ownerClan: 'Mist', guards: ['a', 'b', 'c'] };
        assert.equal(progress(rows(2, { level: 40, battleContrib: 1, month: MONTH }), 'guard', [sector]), 5);
    });

    it('every counter-fed mission ignores stale rows', () => {
        const stale = rows(5, { level: 40, battleContrib: 50, missionContrib: 60, eventContrib: 30, month: LAST_MONTH });
        for (const key of ['battle', 'mission', 'anbu', 'donation', 'training', 'raid'] as const) {
            assert.equal(progress(stale, key), 0, key);
        }
        const fresh = rows(1, { level: 40, battleContrib: 20, missionContrib: 50, eventContrib: 15, month: MONTH });
        assert.equal(progress(fresh, 'battle'), 20);
        assert.equal(progress(fresh, 'mission'), 50);
        assert.equal(progress(fresh, 'raid'), 5);
        assert.equal(progress(fresh, 'training'), 100);
    });

    it('a server event credit restarts a stale row at zero and stamps the month', () => {
        const stale = { name: 'raider', level: 100, battleContrib: 40, missionContrib: 9, eventContrib: 30, month: LAST_MONTH };
        assert.deepEqual(withRosterEventContrib(stale, 1, NOW), { name: 'raider', level: 100, battleContrib: 0, missionContrib: 0, eventContrib: 1, month: MONTH });
        const current = { name: 'raider', battleContrib: 4, missionContrib: 2, eventContrib: 7, month: MONTH };
        assert.deepEqual(withRosterEventContrib(current, 1, NOW), { ...current, eventContrib: 8 });
    });
});

describe('Clan Points eligibility on a mission claim', () => {
    const donorOnly = { name: 'donor', level: 60, eventContrib: 30, month: MONTH };
    it('a member who only donated earns no raid or anbu Clan Points (donations never earn Clan Points)', () => {
        assert.equal(clanMissionPointEligible(donorOnly, 'raid', false, NOW), false);
        assert.equal(clanMissionPointEligible(donorOnly, 'anbu', false, NOW), false);
        assert.equal(clanMissionPointEligible({ ...donorOnly, battleContrib: 1 }, 'raid', false, NOW), true);
        assert.equal(clanMissionPointEligible({ ...donorOnly, missionContrib: 1 }, 'raid', false, NOW), true);
        assert.equal(clanMissionPointEligible({ ...donorOnly, battleContrib: 1 }, 'anbu', false, NOW), true);
        assert.equal(clanMissionPointEligible(donorOnly, 'anbu', true, NOW), true, 'a sector guard still qualifies');
    });
    it('an idle L5+ member earns no guard Clan Points; an active one or a sector guard does', () => {
        assert.equal(clanMissionPointEligible({ name: 'idle', level: 60, month: MONTH }, 'guard', false, NOW), false);
        assert.equal(clanMissionPointEligible({ name: 'once', level: 60, battleContrib: 9, month: LAST_MONTH }, 'guard', false, NOW), false);
        assert.equal(clanMissionPointEligible({ name: 'busy', level: 60, missionContrib: 1, month: MONTH }, 'guard', false, NOW), true);
        assert.equal(clanMissionPointEligible({ name: 'post', level: 1, month: LAST_MONTH }, 'guard', true, NOW), true);
    });
    it('battle and mission points read this month only', () => {
        assert.equal(clanMissionPointEligible({ name: 'a', battleContrib: 5, month: LAST_MONTH }, 'battle', false, NOW), false);
        assert.equal(clanMissionPointEligible({ name: 'a', battleContrib: 5, month: MONTH }, 'battle', false, NOW), true);
        assert.equal(clanMissionPointEligible({ name: 'a', missionContrib: 5, month: MONTH }, 'mission', false, NOW), true);
    });
    it('the claim route uses the shared, month-gated predicate', () => {
        const claim = read('api/clan/mission/claim.ts');
        assert.match(claim, /clanMissionPointEligible\(member, missionKey, guardNames\.has\(name\), now\)/);
        assert.doesNotMatch(claim, /event > 0/);
    });
});

describe('client mirror of the clan mission progress', () => {
    const math = read('shinobij.client/src/lib/clan-math.ts');
    it('month-gates the roster counters like the server', () => {
        assert.match(math, /const current = m\.month === new Date\(now\)\.toISOString\(\)\.slice\(0, 7\);/);
        assert.match(math, /const monthly = data\.members\.map\(m => \(\{ member: m, \.\.\.memberMonthCounters\(m, now\) \}\)\);/);
    });
    it('reads donation from this month\'s contribution and guard from active members', () => {
        assert.match(math, /if \(key === "donation"\) return event \* 1000;/);
        assert.doesNotMatch(math, /data\.treasury\.ryo;/);
        assert.match(math, /monthly\.filter\(m => m\.member\.level >= 5 && \(m\.battle > 0 \|\| m\.mission > 0\)\)\.length/);
    });
});
