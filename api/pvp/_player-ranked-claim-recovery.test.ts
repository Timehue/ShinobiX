import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'player-ranked-claim-recovery-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    handler = (await import('./claim-rewards.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

test('ranked settlement retry copy stays phase-neutral', () => {
    const source = readFileSync(join(process.cwd(), 'api/pvp/claim-rewards.ts'), 'utf8');
    assert.match(source, /The ranked result is still being confirmed\. Retry this claim\./);
    assert.doesNotMatch(source, /item usage is still settling/i);
});

test('claim helps an over-age unjoined-opponent V2 terminal through the full saga', async () => {
    const { ensurePetRankedSeasonGate, activatePlayerRankedAdmission, getPlayerRankedAdmission } = await import('../pet/_ranked-preparation.js');
    const { getPlayerRankedJournal } = await import('./_player-ranked-journal.js');
    const { mintPlayerRankedMatchTokenWithStore } = await import('../_ranked-match-token.js');
    const now = Date.now();
    const matchId = 'player-ranked-e2345678-1234-4123-8123-1234567890ab';
    const battleId = 'pvp-e2345678-1234-4123-8123-1234567890ab';
    await kv.set('ranked:season:current', { id: 1, startedAt: now, endsAt: now + 100_000 });
    await ensurePetRankedSeasonGate(kv, 1, now);
    for (const name of ['claimfleealice', 'claimfleebob']) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            character: {
                name,
                level: 25,
                profession: 'ninja',
                rankedRating: 1000,
                rankedWins: 0,
                rankedLosses: 0,
                serverSettlementReceipts: [],
            },
        });
    }
    const token = await mintPlayerRankedMatchTokenWithStore(kv, {
        a: 'claimfleealice', b: 'claimfleebob', aLevel: 25, bLevel: 25,
        aRating: 1000, bRating: 1000, now: now + 1, matchId,
    });
    await activatePlayerRankedAdmission(kv, token.matchId, battleId, now + 2);
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: 'claimfleealice' },
        p2: { name: 'claimfleebob' },
        status: 'done',
        winner: 'p2',
        fleedBy: 'p1',
        ranked: false,
        rankedKind: 'player',
        playerRankedAuthorityVersion: 2,
        rankedMatchId: matchId,
        rankedSeasonId: 1,
        rankedSeasonEpoch: 1,
        p1Rating: 1000,
        p2Rating: 1000,
        rewardAuthority: 'ranked',
        joined: { p1: true, p2: false },
        baseRewards: false,
        realFighters: { p1: true, p2: true },
        itemCharges: { p1: {}, p2: {} },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 3 * 60 * 60 * 1_000,
        // Terminal rows are published through persistedSession, which stamps
        // endedAt whenever status becomes 'done'. This fixture writes the row
        // straight to kv and so has to supply it; without one the claim rejects
        // the battle's terminal time before the recovery saga under test runs.
        endedAt: now - 3 * 60 * 60 * 1_000 + 30_000,
    });

    const out: { code: number; body?: Record<string, any> } = { code: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.code = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { battleId, playerName: 'claimfleealice', outcome: 'loss' },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken('claimfleealice'),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    assert.equal(out.code, 200, JSON.stringify(out.body));
    assert.equal(await getPlayerRankedAdmission(kv, matchId), null);
    assert.equal((await kv.get<Record<string, any>>('save:claimfleealice'))?.character.rankedRating, 1000);
    assert.equal((await kv.get<Record<string, any>>('save:claimfleebob'))?.character.rankedRating, 1000);
    const journal = await getPlayerRankedJournal(kv, matchId);
    assert.equal(journal?.state, 'completed');
    assert.equal(journal?.terminal.rankedEligible, false);
    const successor = await mintPlayerRankedMatchTokenWithStore(kv, {
        a: 'claimfleealice', b: 'claimfleebob', aLevel: 25, bLevel: 25,
        aRating: 1000, bRating: 1000, now: now + 10,
        matchId: 'player-ranked-f2345678-1234-4123-8123-1234567890ab',
    });
    assert.equal(successor.matchId, 'player-ranked-f2345678-1234-4123-8123-1234567890ab');
});
