import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    APEX_MIN_HUNTER_RANK,
    APEX_MIN_LEVEL,
    APEX_REWARD,
    APEX_ROSTER,
    apexClaimableWeeks,
    apexClaimedThisWeek,
    apexKillReceiptKey,
    canTakeApex,
    isApexBeastForWeek,
    isoWeekKey,
    previousWeekKey,
} from './_apex-contract.js';

// process.cwd() (repo root), matching _pet-expedition-lease.test.ts — import.meta
// is unavailable in this project's CommonJS build target.
const clientSource = readFileSync(
    join(process.cwd(), 'shinobij.client', 'src', 'lib', 'apex-contract.ts'),
    'utf8',
);

describe('apex catalog parity with the client mirror', () => {
    // The client copy drives the UI and BUILDS the fight; this copy decides what
    // is PAID. Drift means a player fights one beast and claims another's purse.
    it('rosters match exactly, in order', () => {
        const block = clientSource.split('APEX_ROSTER')[1]?.split('];')[0] ?? '';
        const rows = [...block.matchAll(
            /baseAiId: "([^"]+)", apexAiId: "([^"]+)"[^}]*?level: (\d+), statBonus: (\d+), hp: ([\d_]+)/g,
        )];
        assert.equal(rows.length, APEX_ROSTER.length, 'client roster length differs');
        rows.forEach(([, baseAiId, apexAiId, level, statBonus, hp], i) => {
            const server = APEX_ROSTER[i];
            assert.equal(baseAiId, server.baseAiId, `row ${i} baseAiId`);
            assert.equal(apexAiId, server.apexAiId, `row ${i} apexAiId`);
            assert.equal(Number(level), server.level, `row ${i} level`);
            assert.equal(Number(statBonus), server.statBonus, `row ${i} statBonus`);
            assert.equal(Number(hp.replace(/_/g, '')), server.hp, `row ${i} hp`);
        });
    });

    it('gates match', () => {
        assert.match(clientSource, new RegExp(`APEX_MIN_HUNTER_RANK = ${APEX_MIN_HUNTER_RANK}\\b`));
        assert.match(clientSource, new RegExp(`APEX_MIN_LEVEL = ${APEX_MIN_LEVEL}\\b`));
    });

    it('purse matches', () => {
        assert.match(clientSource, new RegExp(`APEX_RYO = ${APEX_REWARD.ryo.toLocaleString('en-US').replace(',', '_')}\\b`));
        assert.match(clientSource, new RegExp(`APEX_FATE_SHARDS = ${APEX_REWARD.fateShards}\\b`));
    });

    it('HP stays at or under the approved 12,500 ceiling', () => {
        for (const beast of APEX_ROSTER) {
            assert.ok(beast.hp <= 12_500, `${beast.apexAiId} at ${beast.hp} exceeds the ceiling`);
        }
    });
});

describe('apex week keys', () => {
    it('matches known ISO-8601 weeks', () => {
        assert.equal(isoWeekKey(new Date(Date.UTC(2026, 6, 21))), '2026-W30');
        assert.equal(isoWeekKey(new Date(Date.UTC(2026, 0, 1))), '2026-W01');
        // The week-year roll a naive getUTCFullYear() gets wrong.
        assert.equal(isoWeekKey(new Date(Date.UTC(2025, 11, 29))), '2026-W01');
    });

    it('previousWeekKey steps back exactly one week, across a year boundary', () => {
        assert.equal(previousWeekKey(new Date(Date.UTC(2026, 6, 21))), '2026-W29');
        assert.equal(previousWeekKey(new Date(Date.UTC(2026, 0, 1))), '2025-W52');
    });
});

describe('apex claim window', () => {
    it('accepts this week and the one before, newest first', () => {
        const weeks = apexClaimableWeeks(new Date(Date.UTC(2026, 6, 21)));
        assert.deepEqual([...weeks], ['2026-W30', '2026-W29']);
    });

    it('lets a Sunday-night kill settle on Monday morning', () => {
        // Kill: Sun 2026-07-26 23:55 UTC → receipt keyed 2026-W30.
        const killWeek = isoWeekKey(new Date(Date.UTC(2026, 6, 26, 23, 55)));
        // Claim: Mon 2026-07-27 00:01 UTC → now in W31.
        const claimAt = new Date(Date.UTC(2026, 6, 27, 0, 1));
        assert.equal(isoWeekKey(claimAt), '2026-W31', 'guard: the week really did roll');
        assert.notEqual(killWeek, isoWeekKey(claimAt));
        assert.ok(
            apexClaimableWeeks(claimAt).includes(killWeek),
            'the kill week fell outside the claim window — purse lost with no recourse',
        );
    });

    it('does not reach back two weeks', () => {
        const weeks = apexClaimableWeeks(new Date(Date.UTC(2026, 6, 21)));
        assert.ok(!weeks.includes('2026-W28'), 'claim window is too wide');
    });
});

describe('apex eligibility', () => {
    it('requires max hunter rank AND the level floor', () => {
        assert.equal(canTakeApex({ hunterRank: 5, level: 70 }), true);
        assert.equal(canTakeApex({ hunterRank: 4, level: 100 }), false);
        assert.equal(canTakeApex({ hunterRank: 5, level: 69 }), false);
        assert.equal(canTakeApex(null), false);
    });

    it('only accepts the beast actually on offer that week', () => {
        const week = '2026-W30';
        const offered = APEX_ROSTER[(2026 * 53 + 30) % APEX_ROSTER.length].apexAiId;
        assert.equal(isApexBeastForWeek(offered, week), true);
        const other = APEX_ROSTER.find((b) => b.apexAiId !== offered)!.apexAiId;
        assert.equal(isApexBeastForWeek(other, week), false, 'an off-rotation beast paid the purse');
        assert.equal(isApexBeastForWeek('hunt-ai-worldstorm-dragon', week), false, 'a NORMAL hunt beast paid the apex purse');
        assert.equal(isApexBeastForWeek('', week), false);
    });

    it('tracks the weekly claim per week key', () => {
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: '2026-W30' }, '2026-W30'), true);
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: '2026-W29' }, '2026-W30'), false);
        // Settling last week must not mark this week claimed.
        assert.equal(apexClaimedThisWeek({ apexWeekClaimed: '2026-W29' }, '2026-W29'), true);
        assert.equal(apexClaimedThisWeek({}, '2026-W30'), false);
    });

    it('scopes the receipt key per player and week', () => {
        assert.notEqual(apexKillReceiptKey('rin', '2026-W30'), apexKillReceiptKey('rin', '2026-W31'));
        assert.notEqual(apexKillReceiptKey('rin', '2026-W30'), apexKillReceiptKey('kite', '2026-W30'));
    });
});
