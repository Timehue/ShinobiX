import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { PvpSession } from './pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-world-peace-test-secret';

let kv: typeof import('./_storage.js').kv;
let handler: typeof import('./world-state.js').default;
let settle: typeof import('./world-state.js').settlePvpVillageWarContinuation;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;

function response() {
    const out: { statusCode: number; body?: Record<string, any> } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Record<string, any>) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(war: Record<string, unknown>) {
    return {
        method: 'POST',
        body: { kind: 'war', war },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken('peacekage'),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    const world = await import('./world-state.js');
    handler = world.default as unknown as typeof handler;
    settle = world.settlePvpVillageWarContinuation;
    await kv.set('save:peacekage', { character: { name: 'Peace Kage', village: 'Leaf' } });
    await kv.set('village:kage:leaf', { seatedKage: 'peacekage' });
});

describe('legacy Kage peace chronology', () => {
    it('ignores future, fractional, negative, and string request timestamps', async () => {
        for (const requestedEnd of [Date.now() + 365 * 24 * 60 * 60 * 1_000, 1.5, -100, '2099-01-01']) {
            const startedAt = Date.now() - 3 * 60 * 60 * 1_000;
            const existing = {
                id: 'leaf-vs-mist',
                villages: ['Leaf', 'Mist'],
                hp: { Leaf: 5_000, Mist: 5_000 },
                warGroundSector: 40,
                warGroundHp: 1_000,
                startedAt,
                pendingUntil: startedAt + 60 * 60 * 1_000,
                updatedAt: startedAt,
            };
            await kv.set('world:war:leaf-vs-mist', existing);
            const before = Date.now();
            const { out, res } = response();
            await handler(request({ ...existing, endedAt: requestedEnd }), res);
            const after = Date.now();
            assert.equal(out.statusCode, 200, String(requestedEnd));
            const endedAt = Number(out.body?.war?.endedAt);
            assert.ok(Number.isSafeInteger(endedAt));
            assert.ok(endedAt >= before && endedAt <= after);
            assert.ok(endedAt <= existing.pendingUntil + 14 * 24 * 60 * 60 * 1_000);
            assert.notEqual(endedAt, requestedEnd);
        }
    });

    it('receipts a battle finishing after canonical peace as not applicable', async () => {
        const startedAt = Date.now() - 3 * 60 * 60 * 1_000;
        const active = {
            id: 'leaf-vs-mist',
            villages: ['Leaf', 'Mist'],
            hp: { Leaf: 5_000, Mist: 5_000 },
            warGroundSector: 40,
            warGroundHp: 1_000,
            startedAt,
            pendingUntil: startedAt + 60 * 60 * 1_000,
            updatedAt: startedAt,
        };
        await kv.set('world:war:leaf-vs-mist', active);
        const peace = response();
        await handler(request({ ...active, endedAt: Date.now() + 999_999_999 }), peace.res);
        assert.equal(peace.out.statusCode, 200);
        const endedAt = Number(peace.out.body?.war?.endedAt);
        const session = {
            battleId: 'pvp-after-canonical-peace',
            p1: { name: 'Winner', character: { village: 'Leaf' } },
            p2: { name: 'Loser', character: { village: 'Mist' } },
            status: 'done',
            winner: 'p1',
            rewardAuthority: 'world',
            baseRewards: true,
            joined: { p1: true, p2: true },
            worldAttacker: { side: 'p1', name: 'winner' },
            rewardSector: 40,
            round: 1,
            activePlayer: 'p1',
            ap: { p1: 1, p2: 1 },
            actionsThisTurn: 0,
            cooldowns: { p1: {}, p2: {} },
            log: [],
            createdAt: endedAt - 100,
            endedAt: endedAt + 1,
        } as unknown as PvpSession;
        const result = await settle(session.battleId, 'winner', session);
        assert.equal(result.status, 200);
        assert.equal(result.body.settlement, 'not-applicable');
        assert.equal(result.body.warGroundRewardEligible, false);
    });
});
