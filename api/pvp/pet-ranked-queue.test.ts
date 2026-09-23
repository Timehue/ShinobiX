import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pet-ranked-queue-level-test-secret-32-bytes';

type Kv = typeof import('../_storage.js').kv;

let kv: Kv;
let pruneWaiting: typeof import('./pet-ranked-queue.js').pruneWaiting;
let petRankedPairable: typeof import('./pet-ranked-queue.js').petRankedPairable;
let selectPetRankedOpponent: typeof import('./pet-ranked-queue.js').selectPetRankedOpponent;
let WAITING_KEY: string;
let queueHandler: typeof import('./pet-ranked-queue.js').default;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const mod = await import('./pet-ranked-queue.js');
    ({ pruneWaiting, petRankedPairable, selectPetRankedOpponent } = mod);
    queueHandler = mod.default as unknown as typeof queueHandler;
    ({ issuePlayerToken } = await import('../_auth.js'));
    WAITING_KEY = mod.PET_RANKED_WAITING_KEY;
});

after(() => { delete process.env.SHINOBIX_QA_MEMORY_KV; delete process.env.SESSION_SECRET; });
beforeEach(async () => { await kv.del(WAITING_KEY); });

const entry = (slug: string, rating: number, joinedAt: number) => ({ slug, rating, level: 30, joinedAt, format: '2v2' as const, petIds: ['p1', 'p2', 'p3', 'p4'] });

describe('live ranked pet matchmaking', { concurrency: false }, () => {
    it('drops stale, duplicate, and future-dated waiting entries', () => {
        const now = 1_000_000;
        const kept = pruneWaiting([
            entry('ash', 1000, now - 1_000),
            entry('ash', 1000, now - 2_000),          // duplicate slug
            entry('stale', 1000, now - 10 * 60_000),  // past the waiting TTL
            entry('future', 1000, now + 120_000),     // clock-skewed
            { slug: 'legacy', rating: 1000, level: 30, joinedAt: now }, // pre-upgrade queue row
            { ...entry('levelten', 1000, now), level: 10 },
            { slug: '', rating: 1, level: 1, joinedAt: now },
        ], now);
        assert.deepEqual(kept.map(e => e.slug), ['ash']);
    });

    it('requires BOTH sides to accept the rating gap', () => {
        const now = 1_000_000;
        const fresh = entry('fresh', 1000, now);
        const near = entry('near', 1100, now);
        const farFresh = entry('far', 2000, now);
        assert.equal(petRankedPairable(fresh, near, now), true, 'within the base window');
        assert.equal(petRankedPairable(fresh, farFresh, now), false, 'far apart, both fresh');

        // A long wait widens only the waiter's own tolerance; the newcomer still
        // refuses, so nobody is dragged into a mismatch by someone else's wait.
        const patient = entry('patient', 2000, now - 60_000);
        assert.equal(petRankedPairable(patient, fresh, now), false);
    });

    it('pairs the longest-waiting eligible opponent, never itself', () => {
        const now = 1_000_000;
        const joiner = entry('joiner', 1000, now);
        const picked = selectPetRankedOpponent(joiner, [
            entry('recent', 1010, now - 1_000),
            entry('oldest', 1020, now - 30_000),
        ], now);
        assert.equal(picked?.slug, 'oldest', 'oldest-waiting first, so nobody starves');
        assert.equal(selectPetRankedOpponent(joiner, [entry('joiner', 1000, now)], now), null);
        assert.equal(selectPetRankedOpponent(joiner, [entry('mismatch', 9000, now)], now), null);
    });

    it('never resolves, seeds, or rates a fight — it only pairs', () => {
        const source = readFileSync(join(process.cwd(), 'api', 'pvp', 'pet-ranked-queue.ts'), 'utf8');
        // The retired queue's defect was launching its own unrelated duel. The
        // queue must produce ONLY the reciprocal pairing ranked-start requires.
        assert.doesNotMatch(source, /resolveRankedPetDuel\(|runPetDuel\(|runPetDuelCinematic\(/);
        assert.doesNotMatch(source, /petRankedRating\s*[:=]|creditRankedOutcome|writeSaveProjected\(/);
        assert.match(source, /petRankedQueueMatchKey/);
        // Both reciprocal records, exactly one initiator, identical createdAt.
        assert.match(source, /queueMatch\(opponent, true, pairId, now, joiner.petIds\)/);
        assert.match(source, /queueMatch\(joiner, false, pairId, now, opponent.petIds\)/);
        // Ranked eligibility and pet availability are re-checked server-side.
        assert.match(source, /rankedLevelEligible\(level\)/);
        assert.match(source, /selectRankedTeam\(character, requestedIds/);
    });

    it('blocks level 10 from the live queue and admits level 11 past the level gate', async () => {
        const name = 'petrankedfloor';
        const post = async () => {
            const out: { status: number; body?: Record<string, unknown> } = { status: 200 };
            const res = {
                setHeader: () => res,
                status: (status: number) => { out.status = status; return res; },
                json: (body: Record<string, unknown>) => { out.body = body; return res; },
                end: () => res,
            };
            await queueHandler({ method: 'POST', body: { action: 'join', name, petIds: [] }, headers: {
                'content-type': 'application/json', 'x-player-token': issuePlayerToken(name) ?? '',
            }, socket: { remoteAddress: '127.0.0.88' } } as never, res as never);
            return out;
        };
        await kv.set(`save:${name}`, { character: { name, level: 10 } });
        const blocked = await post();
        assert.equal(blocked.status, 403);
        assert.equal(blocked.body?.errorCode, 'ranked-level-locked');
        assert.match(String(blocked.body?.error), /level 11/);
        await kv.set(`save:${name}`, { character: { name, level: 11 } });
        const eligible = await post();
        assert.equal(eligible.body?.errorCode, 'no-ranked-team');
    });
});
