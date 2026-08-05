/**
 * Weekly Clan Boss — pure-math guards: per-capita pool scaling, the multi-factor
 * composite score (and that no single axis dominates), clan ranking, ISO week id,
 * boss rotation, and the assault-banking state transition.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    CB_BASE_POOL, CB_POOL_PER_MEMBER, CB_MEMBER_CAP, CB_KILL_BONUS, CB_ASSAULTS_PER_MEMBER,
    CB_DMG_WEIGHT, CB_BREADTH_WEIGHT, CB_CLEAN_WEIGHT, CLAN_BOSSES,
    CB_MEMBER_RYO, CB_MEMBER_TOP_SHARDS,
    clanBossPoolMax, clanBossScore, rankClanBoss, clanBossWeekId, clanBossPickId,
    clanBossDamageDealt, clanBossAttemptsLeft, clanBossMemberDamage, clanBossMemberRewards,
    newClanBossProgress, reserveAttempt, reserveAttemptForRequest, bankAssault,
    resolveClanBossDef, type ClanBossProgress, type ClanBossWeek,
} from './_storage.js';

const HOUR = 3_600_000;

function progress(over: Partial<ClanBossProgress> = {}): ClanBossProgress {
    return {
        clanName: 'X', weekId: '2026-W27', bossId: 'oni-warlord', weekStartedAt: 0,
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
    it('rewards clean clears; does NOT penalise wipes (they are the normal chip)', () => {
        const base = progress({ pool: 20000, participants: ['a'] });
        const clean = progress({ pool: 20000, participants: ['a'], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: false, clean: true, at: 1 },
        ] });
        const wiped = progress({ pool: 20000, participants: ['a'], assaults: [
            { runId: '1', by: 'a', party: ['a'], damage: 20000, rounds: 15, wiped: true, clean: false, at: 1 },
        ] });
        assert.equal(clanBossScore(clean) - clanBossScore(base), CB_CLEAN_WEIGHT);
        assert.equal(clanBossScore(wiped), clanBossScore(base), 'a wipe is not penalised');
    });
    it('rewards a faster wall-clock kill — time-to-slay (slayers only)', () => {
        const fast = progress({ pool: 0, killedAt: 24 * HOUR, weekStartedAt: 0, participants: ['a'] });
        const slow = progress({ pool: 0, killedAt: 110 * HOUR, weekStartedAt: 0, participants: ['a'] });
        assert.ok(clanBossScore(fast) > clanBossScore(slow), 'downing the boss sooner scores higher');
        // Non-slayers get no time credit however "early" it is.
        const fastNoKill = progress({ pool: 5000, weekStartedAt: 0, updatedAt: 1 * HOUR, participants: ['a'] });
        const slowNoKill = progress({ pool: 5000, weekStartedAt: 0, updatedAt: 100 * HOUR, participants: ['a'] });
        assert.equal(clanBossScore(fastNoKill), clanBossScore(slowNoKill));
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
    it('resolves the stored weekly boss before falling back to the deterministic pick', () => {
        const stored = CLAN_BOSSES.find(b => b.id !== clanBossPickId('2026-W27'))!;
        assert.equal(resolveClanBossDef({ weekId: '2026-W27', bossId: stored.id, spawnedAt: 1, endsAt: 2 })?.id, stored.id);
        assert.equal(resolveClanBossDef({ weekId: '2026-W27', bossId: 'missing-boss', spawnedAt: 1, endsAt: 2 })?.id, clanBossPickId('2026-W27'));
        assert.equal(resolveClanBossDef(null), null);
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
    it('banks a run id once even when the side-record settled write is retried', () => {
        const initial = newClanBossProgress('X', week, 2);
        const assault = { runId: 'same-run', by: 'a', party: ['a'], damage: 5000, rounds: 8, wiped: false, clean: false, at: 2000 };
        const first = bankAssault(initial, assault);
        const replay = bankAssault(first, { ...assault, damage: 999999, rounds: 99, at: 9000 });
        assert.equal(replay, first);
        assert.equal(replay.pool, initial.pool - 5000);
        assert.equal(replay.totalRounds, 8);
        assert.equal(replay.assaults.length, 1);
    });
    it('reserves one attempt for repeated start requests and rejects request-id reuse with another party', () => {
        const initial = newClanBossProgress('X', week, 3);
        const receipt = {
            requestId: 'request-12345678', host: 'a', runId: 'cboss-run-1', party: ['a', 'b'],
            fingerprint: 'party-a-b', seed: 123, bossHp: 24000, at: 2000,
        };
        const first = reserveAttemptForRequest(initial, receipt);
        assert.equal(first.ok, true);
        if (!first.ok) return;
        assert.equal(first.replayed, false);
        assert.equal(first.progress.memberAttempts.a, 1);

        const replay = reserveAttemptForRequest(first.progress, { ...receipt, runId: 'cboss-run-2', seed: 999 });
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.replayed, true);
        assert.equal(replay.receipt.runId, 'cboss-run-1');
        assert.equal(replay.progress.memberAttempts.a, 1);

        const conflict = reserveAttemptForRequest(first.progress, { ...receipt, fingerprint: 'party-a-c' });
        assert.deepEqual(conflict, { ok: false, conflict: true });
    });
});

// ── Personal rewards ─────────────────────────────────────────────────────────
// Every other clan-boss reward goes to the clan treasury, so a member had no
// individual reason to spend five wipe-by-design assaults a week. These pay the
// player: flat ryo for taking part, Fate Shards for the clan's top damage dealers.

function assault(over: Partial<ClanBossProgress['assaults'][number]> = {}) {
    return {
        runId: 'r1', by: 'a', party: ['a'], damage: 1000, rounds: 10,
        wiped: true, clean: false, at: 0, ...over,
    };
}

describe('clanBossMemberDamage — co-op damage attribution', () => {
    it('splits an assault evenly across the party that fought it', () => {
        // Splitting, not full credit each: joining someone else's big assault must not
        // out-score leading your own.
        const byMember = clanBossMemberDamage(progress({
            assaults: [assault({ party: ['a', 'b', 'c'], damage: 900 })],
        }));
        assert.equal(byMember.get('a'), 300);
        assert.equal(byMember.get('b'), 300);
        assert.equal(byMember.get('c'), 300);
    });

    it('accumulates across assaults', () => {
        const byMember = clanBossMemberDamage(progress({
            assaults: [
                assault({ party: ['a'], damage: 500 }),
                assault({ party: ['a', 'b'], damage: 400 }),
            ],
        }));
        assert.equal(byMember.get('a'), 700);
        assert.equal(byMember.get('b'), 200);
    });

    it('ignores empty parties and non-positive damage', () => {
        const byMember = clanBossMemberDamage(progress({
            assaults: [
                assault({ party: [], damage: 900 }),
                assault({ party: ['a'], damage: 0 }),
                assault({ party: ['b'], damage: -5 }),
            ],
        }));
        assert.equal(byMember.size, 0);
    });
});

describe('clanBossMemberRewards — participation ryo + top-5 shards', () => {
    it('uses server contribution thresholds for modern operation receipts', () => {
        const result = clanBossMemberRewards(progress({
            participants: ['tank', 'healer', 'idle'],
            assaults: [assault({
                party: ['tank', 'healer', 'idle'],
                damage: 800,
                contributions: {
                    tank: { actions: 8, damage: 100, healing: 0, shielding: 3000, cleanses: 0, objective: 1, score: 610, active: true, survived: true, threshold: 'elite' },
                    healer: { actions: 6, damage: 0, healing: 2500, shielding: 0, cleanses: 2, objective: 0, score: 260, active: true, survived: true, threshold: 'veteran' },
                    idle: { actions: 0, damage: 0, healing: 0, shielding: 0, cleanses: 0, objective: 0, score: 50, active: false, survived: true, threshold: 'none' },
                },
            })],
        }));
        assert.deepEqual(result.map(({ slug, ryo, fateShards, threshold }) => ({ slug, ryo, fateShards, threshold })), [
            { slug: 'tank', ryo: CB_MEMBER_RYO, fateShards: 3, threshold: 'elite' },
            { slug: 'healer', ryo: CB_MEMBER_RYO, fateShards: 2, threshold: 'veteran' },
            { slug: 'idle', ryo: 0, fateShards: 0, threshold: 'none' },
        ]);
    });

    it('pays every participant ryo and ranks shards by personal damage', () => {
        const rewards = clanBossMemberRewards(progress({
            participants: ['a', 'b', 'c'],
            assaults: [
                assault({ party: ['a'], damage: 900 }),
                assault({ party: ['b'], damage: 500 }),
                assault({ party: ['c'], damage: 100 }),
            ],
        }));
        assert.deepEqual(rewards.map((r) => r.slug), ['a', 'b', 'c']);
        assert.deepEqual(rewards.map((r) => r.ryo), [CB_MEMBER_RYO, CB_MEMBER_RYO, CB_MEMBER_RYO]);
        assert.deepEqual(rewards.map((r) => r.fateShards), [5, 4, 3]);
    });

    it('pays ryo but no shards to a member whose party dealt nothing', () => {
        // Reserving an attempt and wiping for 0 still counts as showing up.
        const rewards = clanBossMemberRewards(progress({ participants: ['a'], assaults: [] }));
        assert.equal(rewards.length, 1);
        assert.equal(rewards[0].ryo, CB_MEMBER_RYO);
        assert.equal(rewards[0].fateShards, 0);
    });

    it('awards shards to at most the top five', () => {
        const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const rewards = clanBossMemberRewards(progress({
            participants: seven,
            assaults: seven.map((slug, i) => assault({ party: [slug], damage: (seven.length - i) * 100 })),
        }));
        assert.deepEqual(rewards.map((r) => r.fateShards), [...CB_MEMBER_TOP_SHARDS, 0, 0]);
        // Not gated on the kill — chipping is the intended contribution.
        assert.ok(rewards.every((r) => r.ryo === CB_MEMBER_RYO));
    });

    it('breaks ties deterministically so a settlement retry pays the same', () => {
        const shape = progress({
            participants: ['b', 'a'],
            assaults: [assault({ party: ['a'], damage: 500 }), assault({ party: ['b'], damage: 500 })],
        });
        const first = clanBossMemberRewards(shape).map((r) => `${r.slug}:${r.fateShards}`);
        const again = clanBossMemberRewards(shape).map((r) => `${r.slug}:${r.fateShards}`);
        assert.deepEqual(first, again);
        assert.deepEqual(first, ['a:5', 'b:4']);
    });
});
