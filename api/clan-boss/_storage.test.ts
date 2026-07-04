/**
 * Weekly Clan Boss — pure-math guards: per-capita pool scaling, the multi-factor
 * composite score (and that no single axis dominates), clan ranking, ISO week id,
 * boss rotation, and the assault-banking state transition.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    CB_BASE_POOL, CB_POOL_PER_MEMBER, CB_MEMBER_CAP, CB_KILL_BONUS, CB_ASSAULTS_PER_MEMBER,
    CB_DMG_WEIGHT, CB_BREADTH_WEIGHT, CB_CLEAN_WEIGHT, CB_WIPE_PENALTY, CLAN_BOSSES,
    clanBossPoolMax, clanBossScore, rankClanBoss, clanBossWeekId, clanBossPickId,
    clanBossDamageDealt, clanBossAttemptsLeft, newClanBossProgress, reserveAttempt, bankAssault,
    type ClanBossProgress, type ClanBossWeek,
} from './_storage.js';

function progress(over: Partial<ClanBossProgress> = {}): ClanBossProgress {
    return {
        clanName: 'X', weekId: '2026-W27', bossId: 'oni-warlord',
        poolMax: 40000, pool: 40000, totalRounds: 0, participants: [],
        memberAttempts: {}, assaults: [], updatedAt: 0, ...over,
    };
}

describe('clanBossPoolMax — per-capita scaling', () => {
    it('scales with member count', () => {
        assert.equal(clanBossPoolMax(1), CB_BASE_POOL + CB_POOL_PER_MEMBER);
        assert.equal(clanBossPoolMax(4), CB_BASE_POOL + CB_POOL_PER_MEMBER * 4);
        assert.ok(clanBossPoolMax(12) > clanBossPoolMax(4));
    });
    it('floors at 1 and caps at CB_MEMBER_CAP', () => {
        assert.equal(clanBossPoolMax(0), CB_BASE_POOL + CB_POOL_PER_MEMBER);
        assert.equal(clanBossPoolMax(999), CB_BASE_POOL + CB_POOL_PER_MEMBER * CB_MEMBER_CAP);
    });
});

describe('clanBossScore — composite, cheese-resistant', () => {
    it('awards the kill bonus only when the pool is depleted', () => {
        const killed = progress({ pool: 0, killedAt: 1, participants: ['a'] });
        const alive = progress({ pool: 40000, participants: ['a'] });
        assert.ok(clanBossScore(killed) - clanBossScore(alive) >= CB_KILL_BONUS - 1);
    });
    it('rewards damage dealt', () => {
        const some = progress({ pool: 30000, participants: ['a'] });   // 10k dealt
        const more = progress({ pool: 10000, participants: ['a'] });   // 30k dealt
        assert.ok(clanBossScore(more) > clanBossScore(some));
        assert.equal(clanBossDamageDealt(more), 30000);
    });
    it('rewards participation breadth (kills the "3 carries" cheese)', () => {
        const few = progress({ pool: 20000, participants: ['a', 'b', 'c'] });
        const many = progress({ pool: 20000, participants: ['a', 'b', 'c', 'd', 'e', 'f'] });
        assert.equal(clanBossScore(many) - clanBossScore(few), 3 * CB_BREADTH_WEIGHT);
    });
    it('rewards speed under par ONLY when the boss was killed', () => {
        const fastKill = progress({ pool: 0, killedAt: 1, totalRounds: 60, participants: ['a'] });
        const slowKill = progress({ pool: 0, killedAt: 1, totalRounds: 118, participants: ['a'] });
        assert.ok(clanBossScore(fastKill) > clanBossScore(slowKill));
        // A non-killer gets no speed credit no matter how few rounds.
        const fastNoKill = progress({ pool: 5000, totalRounds: 10, participants: ['a'] });
        const slowNoKill = progress({ pool: 5000, totalRounds: 100, participants: ['a'] });
        assert.equal(clanBossScore(fastNoKill), clanBossScore(slowNoKill));
    });
    it('rewards clean assaults and penalises wipes', () => {
        const base = progress({ pool: 20000, participants: ['a'] });
        const clean = progress({ pool: 20000, participants: ['a'], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: false, clean: true, at: 1 },
        ] });
        const wiped = progress({ pool: 20000, participants: ['a'], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: true, clean: false, at: 1 },
        ] });
        assert.equal(clanBossScore(clean) - clanBossScore(base), CB_CLEAN_WEIGHT);
        assert.equal(clanBossScore(base) - clanBossScore(wiped), CB_WIPE_PENALTY);
    });
    it('never goes negative', () => {
        const allWipes = progress({ pool: 40000, participants: [], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 0, rounds: 20, wiped: true, clean: false, at: 1 },
            { runId: '2', by: 'a', party: ['a'], damage: 0, rounds: 20, wiped: true, clean: false, at: 2 },
        ] });
        assert.ok(clanBossScore(allWipes) >= 0);
    });
    it('no single axis wins alone: a broad clean kill beats a fast solo kill', () => {
        const soloFast = progress({ pool: 0, killedAt: 1, totalRounds: 40, participants: ['a'], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 40000, rounds: 40, wiped: false, clean: false, at: 1 },
        ] });
        const broadClean = progress({ pool: 0, killedAt: 1, totalRounds: 90, participants: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], assaults: [
            { runId: '1', by: 'a', party: ['a', 'b', 'c'], damage: 14000, rounds: 30, wiped: false, clean: true, at: 1 },
            { runId: '2', by: 'd', party: ['d', 'e', 'f'], damage: 14000, rounds: 30, wiped: false, clean: true, at: 2 },
            { runId: '3', by: 'g', party: ['g', 'h'], damage: 12000, rounds: 30, wiped: false, clean: true, at: 3 },
        ] });
        assert.ok(clanBossScore(broadClean) > clanBossScore(soloFast), 'breadth + clean play outweighs raw speed');
    });
});

describe('rankClanBoss', () => {
    it('sorts killers above non-killers, then by score', () => {
        const a = progress({ clanName: 'Alpha', pool: 0, killedAt: 1, totalRounds: 100, participants: ['x'] });
        const b = progress({ clanName: 'Bravo', pool: 5000, participants: ['x', 'y', 'z', 'w'] }); // lots of damage but no kill
        const c = progress({ clanName: 'Cadre', pool: 0, killedAt: 1, totalRounds: 60, participants: ['x', 'y'] });
        const ranked = rankClanBoss([a, b, c]);
        assert.equal(ranked[0].clanName, 'Cadre');   // fastest killer
        assert.equal(ranked[1].clanName, 'Alpha');   // slower killer
        assert.equal(ranked[2].clanName, 'Bravo');   // non-killer last
        assert.deepEqual(ranked.map(r => r.rank), [1, 2, 3]);
    });
});

describe('clanBossWeekId / clanBossPickId', () => {
    it('week id formats and is stable within a week', () => {
        const mon = Date.UTC(2026, 5, 29);
        assert.match(clanBossWeekId(mon), /^\d{4}-W\d{2}$/);
        assert.equal(clanBossWeekId(mon), clanBossWeekId(mon + 2 * 86400000));
        assert.notEqual(clanBossWeekId(mon), clanBossWeekId(mon + 8 * 86400000));
    });
    it('boss pick is a real boss and deterministic', () => {
        const id = clanBossPickId('2026-W27');
        assert.ok(CLAN_BOSSES.some(b => b.id === id));
        assert.equal(id, clanBossPickId('2026-W27'));
    });
});

describe('applyAssault + newClanBossProgress', () => {
    const week: ClanBossWeek = { weekId: '2026-W27', bossId: 'oni-warlord', spawnedAt: 1000, endsAt: 1000 + 7 * 86400000 };

    it('starts at full pool for the roster size', () => {
        const p = newClanBossProgress('Stormbreakers', week, 4);
        assert.equal(p.pool, p.poolMax);
        assert.equal(p.poolMax, clanBossPoolMax(4));
    });
    it('reserveAttempt spends an attempt + credits breadth; bankAssault banks damage', () => {
        let p = newClanBossProgress('X', week, 4); // pool 28000
        p = reserveAttempt(p, 'a', ['a', 'b'], 1500);
        assert.equal(p.memberAttempts.a, 1);
        assert.deepEqual([...p.participants].sort(), ['a', 'b']);
        p = bankAssault(p, { runId: 'r1', by: 'a', party: ['a', 'b'], damage: 10000, rounds: 18, wiped: false, clean: true, at: 2000 });
        assert.equal(p.pool, p.poolMax - 10000);
        assert.equal(p.totalRounds, 18);
        assert.equal(p.memberAttempts.a, 1, 'bankAssault does not double-spend the attempt');
        // overkill on the final chunk is clamped so damage score can't inflate
        p = reserveAttempt(p, 'a', ['a', 'c'], 2500);
        p = bankAssault(p, { runId: 'r2', by: 'a', party: ['a', 'c'], damage: 999999, rounds: 12, wiped: false, clean: true, at: 3000 });
        assert.equal(p.pool, 0);
        assert.equal(clanBossDamageDealt(p), p.poolMax);
        assert.ok(p.killedAt);
        assert.equal(p.memberAttempts.a, 2);
        assert.deepEqual([...p.participants].sort(), ['a', 'b', 'c']);
    });
    it('attempts-left counts down from the per-member cap', () => {
        let p = newClanBossProgress('X', week, 4);
        assert.equal(clanBossAttemptsLeft(p, 'a'), CB_ASSAULTS_PER_MEMBER);
        p = reserveAttempt(p, 'a', ['a'], 2000);
        assert.equal(clanBossAttemptsLeft(p, 'a'), CB_ASSAULTS_PER_MEMBER - 1);
        assert.equal(clanBossAttemptsLeft(null, 'a'), CB_ASSAULTS_PER_MEMBER);
    });
});
