import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Kv = typeof import('../_storage.js').kv;
let kv: Kv;
let mod: typeof import('./_ranked-2v2.js');
let settle: typeof import('./_ranked-2v2-settlement.js');

const A1 = 'ash', A2 = 'briar', B1 = 'cinder', B2 = 'dune';
const ALL = [A1, A2, B1, B2];
const ID_A = `r2v2-${'a'.repeat(32)}`;
const ID_B = `r2v2-${'b'.repeat(32)}`;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    mod = await import('./_ranked-2v2.js');
    settle = await import('./_ranked-2v2-settlement.js');
});
after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; });

async function seed(level = 40): Promise<void> {
    for (const prefix of ['ranked-2v2:*', 'battle-lock:*', 'tower-pvp:*']) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
    for (const slug of ALL) {
        await kv.set(`save:${slug}`, {
            character: {
                name: slug, level, ranked2v2Rating: 1000,
                maxHp: 1200, maxChakra: 200, maxStamina: 200,
                specialty: 'Taijutsu', stats: { strength: 200 }, jutsu: [],
            },
        });
    }
}
beforeEach(() => seed());

const entry = (duoId: string, slugs: string[], rating: number, joinedAt: number) =>
    ({ duoId, slugs, rating, joinedAt });

describe('ranked 2v2 pairing', { concurrency: false }, () => {
    it('requires an accepted partner before the duo can queue', async () => {
        const invited = await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        assert.equal(invited.ok, true);
        if (!invited.ok) return;
        assert.equal(invited.value.status, 'forming');
        assert.equal(mod.duoIsQueueable(invited.value), false, 'an unaccepted invite is not a duo');

        const early = await mod.queueRanked2v2(A1);
        assert.equal(early.ok, false);
        if (!early.ok) assert.equal(early.code, 'duo-incomplete');

        const accepted = await mod.acceptRanked2v2Invite(A2);
        assert.equal(accepted.ok, true);
        if (!accepted.ok) return;
        assert.equal(accepted.value.status, 'ready');
        assert.equal(mod.duoIsQueueable(accepted.value), true);
    });

    it('refuses self-pairing, double-booking, and poaching a partnered shinobi', async () => {
        assert.equal((await mod.inviteRanked2v2Partner({ actor: A1, target: A1 })).ok, false);
        await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        assert.equal((await mod.inviteRanked2v2Partner({ actor: A1, target: B1 })).ok, false, 'cannot hold two duos');
        assert.equal((await mod.inviteRanked2v2Partner({ actor: B1, target: A2 })).ok, false, 'cannot poach');
    });

    it('applies the shared newcomer floor to BOTH partners', async () => {
        await seed(4);
        const low = await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        assert.equal(low.ok, false);
        if (!low.ok) assert.equal(low.code, 'ranked-level-locked');
    });

    it('lets either partner leave, freeing both to pair again', async () => {
        await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        await mod.acceptRanked2v2Invite(A2);
        await mod.leaveRanked2v2Duo(A2);
        assert.equal(await mod.duoForPlayer(A1), null, 'the abandoned partner is not stranded');
        assert.equal(await mod.duoForPlayer(A2), null);
        assert.equal((await mod.inviteRanked2v2Partner({ actor: A1, target: B1 })).ok, true);
    });
});

describe('ranked 2v2 matchmaking', { concurrency: false }, () => {
    it('requires BOTH duos to accept the rating gap', () => {
        const now = 1_000_000;
        const fresh = entry(ID_A, [A1, A2], 1000, now);
        assert.equal(mod.duosPairable(fresh, entry(ID_B, [B1, B2], 1080, now), now), true);
        assert.equal(mod.duosPairable(fresh, entry(ID_B, [B1, B2], 2000, now), now), false);
        // A long wait widens only the waiter's own tolerance.
        assert.equal(mod.duosPairable(entry(ID_B, [B1, B2], 2000, now - 120_000), fresh, now), false);
    });

    it('never matches a duo against itself or a shared account', () => {
        const now = 1_000_000;
        const a = entry(ID_A, [A1, A2], 1000, now);
        assert.equal(mod.duosPairable(a, a, now), false);
        assert.equal(mod.duosPairable(a, entry(ID_B, [A1, B2], 1000, now), now), false,
            'the same shinobi cannot appear on both sides');
    });

    it('pairs the longest-waiting eligible duo', () => {
        const now = 1_000_000;
        const picked = mod.selectOpponentDuo(entry(ID_A, [A1, A2], 1000, now), [
            entry(`r2v2-${'c'.repeat(32)}`, ['echo', 'fern'], 1010, now - 1_000),
            entry(ID_B, [B1, B2], 1020, now - 30_000),
        ], now);
        assert.equal(picked?.duoId, ID_B, 'oldest-waiting first, so nobody starves');
    });

    it('drops stale, duplicate and malformed queue rows', () => {
        const now = 1_000_000;
        const kept = mod.pruneQueue([
            entry(ID_A, [A1, A2], 1000, now - 1_000),
            entry(ID_A, [A1, A2], 1000, now - 2_000),
            entry(ID_B, [B1, B2], 1000, now - 10 * 60_000),
            entry(`r2v2-${'d'.repeat(32)}`, [A1], 1000, now),
            { duoId: 'nope', slugs: [A1, A2], rating: 1000, joinedAt: now },
        ], now);
        assert.deepEqual(kept.map(row => row.duoId), [ID_A]);
    });

    it('publishes one four-player match with each duo kept whole', async () => {
        await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        await mod.acceptRanked2v2Invite(A2);
        const queued = await mod.queueRanked2v2(A1);
        assert.ok(queued.ok && queued.value.state === 'queued', 'first duo waits');

        await mod.inviteRanked2v2Partner({ actor: B1, target: B2 });
        await mod.acceptRanked2v2Invite(B2);
        const matched = await mod.queueRanked2v2(B1);
        assert.ok(matched.ok && matched.value.state === 'matched', 'second duo completes the match');

        const match = (await mod.ranked2v2Status(A1)).match!;
        assert.equal(match.binding?.kind, 'ranked-2v2');
        const amber = match.roster.filter(m => m.teamId === 'amber').map(m => m.slug).sort();
        const violet = match.roster.filter(m => m.teamId === 'violet').map(m => m.slug).sort();
        const duoA = [A1, A2].sort();
        const duoB = [B1, B2].sort();
        // Whichever side each duo lands on, a PAIR is never split across teams.
        assert.ok(
            (JSON.stringify(amber) === JSON.stringify(duoA) && JSON.stringify(violet) === JSON.stringify(duoB))
            || (JSON.stringify(amber) === JSON.stringify(duoB) && JSON.stringify(violet) === JSON.stringify(duoA)),
            `duos must stay whole, got amber=${amber} violet=${violet}`,
        );
        for (const slug of ALL) {
            const lease = await kv.get<{ meta?: { mode?: string } }>(`battle-lock:${slug}`);
            assert.equal(lease?.meta?.mode, 'ranked-2v2', `${slug} holds a ranked lease`);
        }
    });

    it('refuses to queue a duo whose partner is already in another battle', async () => {
        await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        await mod.acceptRanked2v2Invite(A2);
        await kv.set(`battle-lock:${A2}`, {
            battleId: 'tower-elsewhere', kind: 'battleTowers', screen: 'battleTowers',
            startedAt: Date.now(), meta: { runId: 'tower-elsewhere' },
        });
        const blocked = await mod.queueRanked2v2(A1);
        assert.equal(blocked.ok, false);
        if (!blocked.ok) assert.equal(blocked.code, 'member-busy');
    });
});

describe('ranked 2v2 rating', { concurrency: false }, () => {
    async function matchedPair() {
        await mod.inviteRanked2v2Partner({ actor: A1, target: A2 });
        await mod.acceptRanked2v2Invite(A2);
        await mod.queueRanked2v2(A1);
        await mod.inviteRanked2v2Partner({ actor: B1, target: B2 });
        await mod.acceptRanked2v2Invite(B2);
        await mod.queueRanked2v2(B1);
        return (await mod.ranked2v2Status(A1)).match!;
    }

    it('moves both winners up and both losers down, exactly once', async () => {
        const base = await matchedPair();
        const amberSlugs = base.roster.filter(m => m.teamId === 'amber').map(m => m.slug);
        const done = { ...base, status: 'done' as const, winner: 'amber' as const, updatedAt: Date.now() };

        const lines = await settle.settleRanked2v2Match(done);
        assert.ok(lines && lines.length === 4, 'every fighter is rated');
        for (const line of lines!) {
            assert.equal(line.outcome, amberSlugs.includes(line.slug) ? 'win' : 'loss');
            assert.ok(line.delta >= 8, 'a rated result moves at least the Elo floor');
        }
        const winner = await kv.get<{ character?: Record<string, number> }>(`save:${amberSlugs[0]}`);
        assert.ok((winner?.character?.ranked2v2Rating ?? 0) > 1000, 'winner gained');
        assert.equal(winner?.character?.ranked2v2Wins, 1);

        const settledRating = winner?.character?.ranked2v2Rating;
        for (let attempt = 0; attempt < 3; attempt += 1) await settle.settleRanked2v2Match(done);
        const stable = await kv.get<{ character?: Record<string, number> }>(`save:${amberSlugs[0]}`);
        assert.equal(stable?.character?.ranked2v2Rating, settledRating, 'rating never moves twice for one match');
        assert.equal(stable?.character?.ranked2v2Wins, 1);
    });

    it('rates nobody for a duel that never happened', async () => {
        const base = await matchedPair();
        const cancelled = { ...base, status: 'cancelled' as const, winner: null, updatedAt: Date.now() };
        assert.deepEqual(await settle.settleRanked2v2Match(cancelled), []);
        const untouched = await kv.get<{ character?: Record<string, number> }>(`save:${A1}`);
        assert.equal(untouched?.character?.ranked2v2Rating, 1000);
        assert.equal(untouched?.character?.ranked2v2Wins ?? 0, 0);
        assert.equal(untouched?.character?.ranked2v2Losses ?? 0, 0);
    });

    it('leaves the solo 1v1 ladder untouched', async () => {
        const base = await matchedPair();
        await settle.settleRanked2v2Match({ ...base, status: 'done', winner: 'amber', updatedAt: Date.now() });
        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${A1}`);
        assert.equal(save?.character?.rankedRating, undefined, '2v2 must not touch the solo ladder');
    });

    it('ignores a match that is not ranked 2v2', async () => {
        const base = await matchedPair();
        assert.equal(await settle.settleRanked2v2Match({
            ...base,
            binding: { kind: 'public-queue' as const },
            status: 'done' as const,
            winner: 'amber' as const,
        }), null, 'the open queue can never move a ladder');
    });
});
