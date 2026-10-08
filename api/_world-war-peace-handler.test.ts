import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import type { PvpSession } from './pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-world-peace-test-secret';

/*
 * Peace and surrender (owner ruling 2026-10-08): a no-winner peace needs BOTH
 * seated Kages to offer it, and a Kage may instead surrender, which ends the
 * war as a loss for their own village. Before this, either Kage could end the
 * war with no winner on their own through the war write lane — including the
 * losing Kage one hit before their village fell.
 */

const LEAF = 'Ashen Leaf Village';
const MIST = 'Moonshadow Village';
const WAR_KEY = 'world:war:ashenleafvillage-vs-moonshadowvillage';

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

async function post(player: string, body: Record<string, unknown>) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(player),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

function command(player: string, cmd: string) {
    return post(player, { kind: 'war-command', command: cmd, villages: [LEAF, MIST] });
}

function liveWar(overrides: Record<string, unknown> = {}) {
    const startedAt = Date.now() - 3 * 60 * 60 * 1_000;
    return {
        id: 'ashenleafvillage-vs-moonshadowvillage',
        villages: [LEAF, MIST],
        hp: { [LEAF]: 5_000, [MIST]: 5_000 },
        warGroundSector: 47,
        warGroundHp: 1_000,
        startedAt,
        pendingUntil: startedAt + 60 * 60 * 1_000,
        updatedAt: startedAt,
        declarationGeneration: 1,
        warCrateId: 'war-crate-ashenleafvillage-vs-moonshadowvillage-g1',
        contributions: {
            leafhero: { damage: 400, raids: 2, pvpKills: 3, side: LEAF, name: 'Leaf Hero' },
            misthero: { damage: 250, raids: 1, pvpKills: 2, side: MIST, name: 'Mist Hero' },
        },
        ...overrides,
    };
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    const world = await import('./world-state.js');
    handler = world.default as unknown as typeof handler;
    settle = world.settlePvpVillageWarContinuation;
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set('save:leafkage', { character: { name: 'Leaf Kage', village: LEAF } });
    await kv.set('save:mistkage', { character: { name: 'Mist Kage', village: MIST } });
    await kv.set('save:leafgenin', { character: { name: 'Leaf Genin', village: LEAF } });
    await kv.set('village:kage:ashen-leaf-village', { seatedKage: 'leafkage' });
    await kv.set('village:kage:moonshadow-village', { seatedKage: 'mistkage' });
});

describe('village-war peace and surrender', { concurrency: false }, () => {
    it('refuses a one-sided end through the war write lane, whatever timestamp it asks for', async () => {
        for (const requestedEnd of [Date.now() + 365 * 24 * 60 * 60 * 1_000, 1.5, -100, '2099-01-01']) {
            const existing = liveWar();
            await kv.set(WAR_KEY, existing);
            const out = await post('leafkage', { kind: 'war', war: { ...existing, endedAt: requestedEnd } });
            assert.equal(out.statusCode, 403, String(requestedEnd));
            const stored = await kv.get<Record<string, unknown>>(WAR_KEY);
            assert.equal(stored?.endedAt, undefined, 'the war is still running');
        }
    });

    it('needs both Kages: one offer changes nothing, the second ends it with no winner at the server clock', async () => {
        await kv.set(WAR_KEY, liveWar());
        const offer = await command('leafkage', 'propose-peace');
        assert.equal(offer.statusCode, 200, JSON.stringify(offer.body));
        assert.equal(offer.body?.war?.endedAt, undefined, 'a single offer must not end the war');
        assert.ok(Number(offer.body?.war?.peaceProposals?.[LEAF]) > 0);

        const before = Date.now();
        const accept = await command('mistkage', 'propose-peace');
        const after = Date.now();
        assert.equal(accept.statusCode, 200, JSON.stringify(accept.body));
        const ended = accept.body?.war;
        const endedAt = Number(ended?.endedAt);
        assert.ok(endedAt >= before && endedAt <= after, 'the server clock stamps the end');
        assert.equal(ended?.winnerVillage, undefined, 'an agreed peace has no winner');
        assert.equal(ended?.loserCrateId, undefined, 'no consolation without a winner');
        assert.deepEqual(ended?.mvpByVillage, { [LEAF]: 'Leaf Hero', [MIST]: 'Mist Hero' }, 'MVPs are stamped on every ending');
        assert.ok(await kv.get(`war:cooldown:ashenleafvillage-vs-moonshadowvillage`), 'the rematch cooldown starts');
    });

    it('lets a Kage withdraw an offer before the other side accepts', async () => {
        await kv.set(WAR_KEY, liveWar());
        await command('leafkage', 'propose-peace');
        const withdrawn = await command('leafkage', 'withdraw-peace');
        assert.equal(withdrawn.statusCode, 200);
        assert.equal(withdrawn.body?.war?.peaceProposals?.[LEAF], undefined);
        const mistOffer = await command('mistkage', 'propose-peace');
        assert.equal(mistOffer.body?.war?.endedAt, undefined, 'a withdrawn offer cannot be accepted');
    });

    it('surrender ends the war as a loss for the surrendering village', async () => {
        await kv.set(WAR_KEY, liveWar());
        const out = await command('mistkage', 'surrender');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const war = out.body?.war;
        assert.ok(Number(war?.endedAt) > 0);
        assert.equal(war?.winnerVillage, LEAF);
        assert.equal(war?.surrenderedBy, MIST);
        assert.equal(war?.loserCrateId, 'loser-crate-ashenleafvillage-vs-moonshadowvillage-g1');
        assert.equal(war?.warCrateId, 'war-crate-ashenleafvillage-vs-moonshadowvillage-g1');
    });

    it('only a seated Kage of a warring village may offer peace or surrender, and admins may not', async () => {
        await kv.set(WAR_KEY, liveWar());
        const villager = await command('leafgenin', 'surrender');
        assert.equal(villager.statusCode, 403);
        const { out, res } = response();
        process.env.ADMIN_PASSWORD = 'peace-admin';
        try {
            await handler({
                method: 'POST',
                body: { kind: 'war-command', command: 'surrender', villages: [LEAF, MIST], playerName: 'leafkage' },
                query: {},
                headers: { 'x-admin-password': 'peace-admin', 'x-forwarded-for': '127.0.0.1' },
                socket: { remoteAddress: '127.0.0.1' },
            } as never, res);
        } finally {
            delete process.env.ADMIN_PASSWORD;
        }
        assert.equal(out.statusCode, 403);
        assert.equal((await kv.get<Record<string, unknown>>(WAR_KEY))?.endedAt, undefined);
    });

    it('receipts a battle finishing after an agreed peace as not applicable', async () => {
        await kv.set(WAR_KEY, liveWar());
        await command('leafkage', 'propose-peace');
        const peace = await command('mistkage', 'propose-peace');
        const endedAt = Number(peace.body?.war?.endedAt);
        assert.ok(endedAt > 0);
        const session = {
            battleId: 'pvp-after-canonical-peace',
            p1: { name: 'Winner', character: { village: LEAF } },
            p2: { name: 'Loser', character: { village: MIST } },
            status: 'done',
            winner: 'p1',
            rewardAuthority: 'world',
            baseRewards: true,
            joined: { p1: true, p2: true },
            worldAttacker: { side: 'p1', name: 'winner' },
            rewardSector: 47,
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
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.settlement, 'not-applicable');
        assert.equal(result.body.warGroundRewardEligible, false);
    });
});
