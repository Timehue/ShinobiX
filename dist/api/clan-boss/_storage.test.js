"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Weekly Clan Boss — pure-math guards: per-capita pool scaling, the multi-factor
 * composite score (and that no single axis dominates), clan ranking, ISO week id,
 * boss rotation, and the assault-banking state transition.
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _storage_js_1 = require("./_storage.js");
const HOUR = 3_600_000;
function progress(over = {}) {
    return {
        clanName: 'X', weekId: '2026-W27', bossId: 'oni-warlord', weekStartedAt: 0,
        poolMax: 40000, pool: 40000, totalRounds: 0, participants: [],
        memberAttempts: {}, assaults: [], updatedAt: 0, ...over,
    };
}
(0, node_test_1.describe)('clanBossPoolMax — per-capita scaling', () => {
    (0, node_test_1.it)('scales with member count', () => {
        node_assert_1.strict.equal((0, _storage_js_1.clanBossPoolMax)(1), _storage_js_1.CB_BASE_POOL + _storage_js_1.CB_POOL_PER_MEMBER);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossPoolMax)(4), _storage_js_1.CB_BASE_POOL + _storage_js_1.CB_POOL_PER_MEMBER * 4);
        node_assert_1.strict.ok((0, _storage_js_1.clanBossPoolMax)(12) > (0, _storage_js_1.clanBossPoolMax)(4));
    });
    (0, node_test_1.it)('floors at 1 and caps at CB_MEMBER_CAP', () => {
        node_assert_1.strict.equal((0, _storage_js_1.clanBossPoolMax)(0), _storage_js_1.CB_BASE_POOL + _storage_js_1.CB_POOL_PER_MEMBER);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossPoolMax)(999), _storage_js_1.CB_BASE_POOL + _storage_js_1.CB_POOL_PER_MEMBER * _storage_js_1.CB_MEMBER_CAP);
    });
});
(0, node_test_1.describe)('clanBossScore — composite, cheese-resistant', () => {
    (0, node_test_1.it)('awards the kill bonus only when the pool is depleted', () => {
        const killed = progress({ pool: 0, killedAt: 1, participants: ['a'] });
        const alive = progress({ pool: 40000, participants: ['a'] });
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(killed) - (0, _storage_js_1.clanBossScore)(alive) >= _storage_js_1.CB_KILL_BONUS - 1);
    });
    (0, node_test_1.it)('rewards damage dealt', () => {
        const some = progress({ pool: 30000, participants: ['a'] }); // 10k dealt
        const more = progress({ pool: 10000, participants: ['a'] }); // 30k dealt
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(more) > (0, _storage_js_1.clanBossScore)(some));
        node_assert_1.strict.equal((0, _storage_js_1.clanBossDamageDealt)(more), 30000);
    });
    (0, node_test_1.it)('rewards participation breadth (kills the "3 carries" cheese)', () => {
        const few = progress({ pool: 20000, participants: ['a', 'b', 'c'] });
        const many = progress({ pool: 20000, participants: ['a', 'b', 'c', 'd', 'e', 'f'] });
        node_assert_1.strict.equal((0, _storage_js_1.clanBossScore)(many) - (0, _storage_js_1.clanBossScore)(few), 3 * _storage_js_1.CB_BREADTH_WEIGHT);
    });
    (0, node_test_1.it)('rewards speed under par ONLY when the boss was killed', () => {
        const fastKill = progress({ pool: 0, killedAt: 1, totalRounds: 60, participants: ['a'] });
        const slowKill = progress({ pool: 0, killedAt: 1, totalRounds: 118, participants: ['a'] });
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(fastKill) > (0, _storage_js_1.clanBossScore)(slowKill));
        // A non-killer gets no speed credit no matter how few rounds.
        const fastNoKill = progress({ pool: 5000, totalRounds: 10, participants: ['a'] });
        const slowNoKill = progress({ pool: 5000, totalRounds: 100, participants: ['a'] });
        node_assert_1.strict.equal((0, _storage_js_1.clanBossScore)(fastNoKill), (0, _storage_js_1.clanBossScore)(slowNoKill));
    });
    (0, node_test_1.it)('rewards clean clears; does NOT penalise wipes (they are the normal chip)', () => {
        const base = progress({ pool: 20000, participants: ['a'] });
        const clean = progress({ pool: 20000, participants: ['a'], assaults: [
                { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: false, clean: true, at: 1 },
            ] });
        const wiped = progress({ pool: 20000, participants: ['a'], assaults: [
                { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: true, clean: false, at: 1 },
            ] });
        node_assert_1.strict.equal((0, _storage_js_1.clanBossScore)(clean) - (0, _storage_js_1.clanBossScore)(base), _storage_js_1.CB_CLEAN_WEIGHT);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossScore)(wiped), (0, _storage_js_1.clanBossScore)(base), 'a wipe is not penalised');
    });
    (0, node_test_1.it)('rewards a faster wall-clock kill — time-to-slay (slayers only)', () => {
        const fast = progress({ pool: 0, killedAt: 24 * HOUR, weekStartedAt: 0, participants: ['a'] });
        const slow = progress({ pool: 0, killedAt: 110 * HOUR, weekStartedAt: 0, participants: ['a'] });
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(fast) > (0, _storage_js_1.clanBossScore)(slow), 'downing the boss sooner scores higher');
        // Non-slayers get no time credit however "early" it is.
        const fastNoKill = progress({ pool: 5000, weekStartedAt: 0, updatedAt: 1 * HOUR, participants: ['a'] });
        const slowNoKill = progress({ pool: 5000, weekStartedAt: 0, updatedAt: 100 * HOUR, participants: ['a'] });
        node_assert_1.strict.equal((0, _storage_js_1.clanBossScore)(fastNoKill), (0, _storage_js_1.clanBossScore)(slowNoKill));
    });
    (0, node_test_1.it)('never goes negative', () => {
        const allWipes = progress({ pool: 40000, participants: [], assaults: [
                { runId: '1', by: 'a', party: ['a'], damage: 0, rounds: 20, wiped: true, clean: false, at: 1 },
                { runId: '2', by: 'a', party: ['a'], damage: 0, rounds: 20, wiped: true, clean: false, at: 2 },
            ] });
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(allWipes) >= 0);
    });
    (0, node_test_1.it)('no single axis wins alone: a broad clean kill beats a fast solo kill', () => {
        const soloFast = progress({ pool: 0, killedAt: 1, totalRounds: 40, participants: ['a'], assaults: [
                { runId: '1', by: 'a', party: ['a'], damage: 40000, rounds: 40, wiped: false, clean: false, at: 1 },
            ] });
        const broadClean = progress({ pool: 0, killedAt: 1, totalRounds: 90, participants: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], assaults: [
                { runId: '1', by: 'a', party: ['a', 'b', 'c'], damage: 14000, rounds: 30, wiped: false, clean: true, at: 1 },
                { runId: '2', by: 'd', party: ['d', 'e', 'f'], damage: 14000, rounds: 30, wiped: false, clean: true, at: 2 },
                { runId: '3', by: 'g', party: ['g', 'h'], damage: 12000, rounds: 30, wiped: false, clean: true, at: 3 },
            ] });
        node_assert_1.strict.ok((0, _storage_js_1.clanBossScore)(broadClean) > (0, _storage_js_1.clanBossScore)(soloFast), 'breadth + clean play outweighs raw speed');
    });
});
(0, node_test_1.describe)('rankClanBoss', () => {
    (0, node_test_1.it)('sorts killers above non-killers, then by score', () => {
        const a = progress({ clanName: 'Alpha', pool: 0, killedAt: 1, totalRounds: 100, participants: ['x'] });
        const b = progress({ clanName: 'Bravo', pool: 5000, participants: ['x', 'y', 'z', 'w'] }); // lots of damage but no kill
        const c = progress({ clanName: 'Cadre', pool: 0, killedAt: 1, totalRounds: 60, participants: ['x', 'y'] });
        const ranked = (0, _storage_js_1.rankClanBoss)([a, b, c]);
        node_assert_1.strict.equal(ranked[0].clanName, 'Cadre'); // fastest killer
        node_assert_1.strict.equal(ranked[1].clanName, 'Alpha'); // slower killer
        node_assert_1.strict.equal(ranked[2].clanName, 'Bravo'); // non-killer last
        node_assert_1.strict.deepEqual(ranked.map(r => r.rank), [1, 2, 3]);
    });
});
(0, node_test_1.describe)('clanBossWeekId / clanBossPickId', () => {
    (0, node_test_1.it)('week id formats and is stable within a week', () => {
        const mon = Date.UTC(2026, 5, 29);
        node_assert_1.strict.match((0, _storage_js_1.clanBossWeekId)(mon), /^\d{4}-W\d{2}$/);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossWeekId)(mon), (0, _storage_js_1.clanBossWeekId)(mon + 2 * 86400000));
        node_assert_1.strict.notEqual((0, _storage_js_1.clanBossWeekId)(mon), (0, _storage_js_1.clanBossWeekId)(mon + 8 * 86400000));
    });
    (0, node_test_1.it)('boss pick is a real boss and deterministic', () => {
        const id = (0, _storage_js_1.clanBossPickId)('2026-W27');
        node_assert_1.strict.ok(_storage_js_1.CLAN_BOSSES.some(b => b.id === id));
        node_assert_1.strict.equal(id, (0, _storage_js_1.clanBossPickId)('2026-W27'));
    });
});
(0, node_test_1.describe)('applyAssault + newClanBossProgress', () => {
    const week = { weekId: '2026-W27', bossId: 'oni-warlord', spawnedAt: 1000, endsAt: 1000 + 7 * 86400000 };
    (0, node_test_1.it)('starts at full pool for the roster size', () => {
        const p = (0, _storage_js_1.newClanBossProgress)('Stormbreakers', week, 4);
        node_assert_1.strict.equal(p.pool, p.poolMax);
        node_assert_1.strict.equal(p.poolMax, (0, _storage_js_1.clanBossPoolMax)(4));
    });
    (0, node_test_1.it)('reserveAttempt spends an attempt + credits breadth; bankAssault banks damage', () => {
        let p = (0, _storage_js_1.newClanBossProgress)('X', week, 4); // pool 28000
        p = (0, _storage_js_1.reserveAttempt)(p, 'a', ['a', 'b'], 1500);
        node_assert_1.strict.equal(p.memberAttempts.a, 1);
        node_assert_1.strict.deepEqual([...p.participants].sort(), ['a', 'b']);
        p = (0, _storage_js_1.bankAssault)(p, { runId: 'r1', by: 'a', party: ['a', 'b'], damage: 10000, rounds: 18, wiped: false, clean: true, at: 2000 });
        node_assert_1.strict.equal(p.pool, p.poolMax - 10000);
        node_assert_1.strict.equal(p.totalRounds, 18);
        node_assert_1.strict.equal(p.memberAttempts.a, 1, 'bankAssault does not double-spend the attempt');
        // overkill on the final chunk is clamped so damage score can't inflate
        p = (0, _storage_js_1.reserveAttempt)(p, 'a', ['a', 'c'], 2500);
        p = (0, _storage_js_1.bankAssault)(p, { runId: 'r2', by: 'a', party: ['a', 'c'], damage: 999999, rounds: 12, wiped: false, clean: true, at: 3000 });
        node_assert_1.strict.equal(p.pool, 0);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossDamageDealt)(p), p.poolMax);
        node_assert_1.strict.ok(p.killedAt);
        node_assert_1.strict.equal(p.memberAttempts.a, 2);
        node_assert_1.strict.deepEqual([...p.participants].sort(), ['a', 'b', 'c']);
    });
    (0, node_test_1.it)('attempts-left counts down from the per-member cap', () => {
        let p = (0, _storage_js_1.newClanBossProgress)('X', week, 4);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossAttemptsLeft)(p, 'a'), _storage_js_1.CB_ASSAULTS_PER_MEMBER);
        p = (0, _storage_js_1.reserveAttempt)(p, 'a', ['a'], 2000);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossAttemptsLeft)(p, 'a'), _storage_js_1.CB_ASSAULTS_PER_MEMBER - 1);
        node_assert_1.strict.equal((0, _storage_js_1.clanBossAttemptsLeft)(null, 'a'), _storage_js_1.CB_ASSAULTS_PER_MEMBER);
    });
});
