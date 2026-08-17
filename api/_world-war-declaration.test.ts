import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-war-declaration-test-secret';
delete process.env.DISABLE_VILLAGE_WAR;

let kv: typeof import('./_storage.js').kv;
let handler: typeof import('./world-state.js').default;
let issuePlayerToken: typeof import('./_auth.js').issuePlayerToken;
let reserveFunding: typeof import('./_war-declaration-funding.js').reserveWarDeclarationFunding;
let fundingFingerprint: typeof import('./_war-declaration-funding.js').warDeclarationFundingFingerprint;
let claimReservations: typeof import('./_war-village-reservation.js').claimVillageWarReservations;
let promoteReservations: typeof import('./_war-village-reservation.js').reserveClaimedVillageWarReservations;

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

function request(player: string, villages: [string, string]) {
    return {
        method: 'POST',
        body: {
            kind: 'war',
            war: {
                id: 'client-id-is-ignored',
                villages,
                hp: { [villages[0]]: 5_000, [villages[1]]: 5_000 },
                warGroundSector: 40,
                warGroundHp: 1_000,
            },
        },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(player),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
}

async function invoke(player: string, villages: [string, string]) {
    const { out, res } = response();
    await handler(request(player, villages), res);
    return out;
}

async function invokeTerritory(player: string, territory: Record<string, unknown>) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { kind: 'territory', territory },
        query: {},
        headers: {
            'x-player-token': issuePlayerToken(player),
            'x-forwarded-for': '127.0.0.1',
        },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res);
    return out;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    const world = await import('./world-state.js');
    handler = world.default as unknown as typeof handler;
    ({
        reserveWarDeclarationFunding: reserveFunding,
        warDeclarationFundingFingerprint: fundingFingerprint,
    } = await import('./_war-declaration-funding.js'));
    ({
        claimVillageWarReservations: claimReservations,
        reserveClaimedVillageWarReservations: promoteReservations,
    } = await import('./_war-village-reservation.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    // A non-Leaf owned row prevents the held-sector loader from treating the
    // world as unseeded, so Leaf authoritatively holds zero sectors/costs 0 WR.
    await kv.set('world:territory:1', { sector: 1, ownerVillage: 'Mist' });
    await kv.set('shared:village-war:leaf', { warResources: 0, structures: {} });
    await kv.set('save:leafkage', { character: { name: 'Leaf Kage', village: 'Leaf' } });
    await kv.set('village:kage:leaf', { seatedKage: 'leafkage' });
});

describe('world-state village-war declaration authority', { concurrency: false }, () => {
    it('lets only one of concurrent A-B / A-C declarations activate and records a zero-WR receipt', async () => {
        const [ab, ac] = await Promise.all([
            invoke('leafkage', ['Leaf', 'Mist']),
            invoke('leafkage', ['Leaf', 'Sand']),
        ]);
        const successes = [ab, ac].filter(result => result.statusCode === 200);
        const declines = [ab, ac].filter(result => result.statusCode !== 200);
        assert.equal(successes.length, 1);
        assert.equal(declines.length, 1);
        assert.ok([409, 503].includes(declines[0]!.statusCode));

        const warKeys = await kv.keys('world:war:*');
        const rows = warKeys.length ? await kv.mget<Record<string, any>[]>(...warKeys) : [];
        const active = rows.filter((row): row is Record<string, any> => !!row && row.declarationFunding?.status === 'active');
        assert.equal(active.length, 1);
        assert.equal(active[0].declarationFunding.source.amount, 0);
        assert.equal(active[0].declarationFunding.declarationId, `v2:${active[0].id}:g1`);
        const source = await kv.get<Record<string, any>>('shared:village-war:leaf');
        assert.equal(source?.warResources, 0);
        const receipts = Object.values(source?.warDeclarationFundingReceipts ?? {}) as Array<Record<string, unknown>>;
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].state, 'committed');
        assert.equal(receipts[0].amount, 0);
    });

    it('exact-CAS replaces an ended pair after cooldown with a unique funded generation', async () => {
        const first = await invoke('leafkage', ['Leaf', 'Mist']);
        assert.equal(first.statusCode, 200, first.body?.error);
        const firstRow = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(firstRow?.declarationGeneration, 1);
        const endedAt = Date.now() - 8 * 24 * 60 * 60 * 1_000;
        const ended = { ...firstRow, endedAt, winnerVillage: 'Leaf', updatedAt: endedAt };
        await kv.set('world:war:leaf-vs-mist', ended);

        const rematch = await invoke('leafkage', ['Leaf', 'Mist']);
        assert.equal(rematch.statusCode, 200, rematch.body?.error);
        const successor = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(successor?.declarationGeneration, 2);
        assert.equal(successor?.declarationFunding?.declarationId, 'v2:leaf-vs-mist:g2');
        assert.equal(successor?.endedAt, undefined);
        assert.equal(successor?.winnerVillage, undefined);
        assert.equal(successor?.warCrateId, 'war-crate-leaf-vs-mist-g2');
        const source = await kv.get<Record<string, any>>('shared:village-war:leaf');
        const receipts = Object.values(source?.warDeclarationFundingReceipts ?? {}) as Array<Record<string, unknown>>;
        assert.equal(receipts.length, 2, 'permanent g1 receipt cannot fund g2 for free');
        assert.deepEqual(receipts.map(receipt => receipt.declarationId).sort(), [
            'v2:leaf-vs-mist:g1',
            'v2:leaf-vs-mist:g2',
        ]);
    });

    it('help-forwards a crashed funded row after the declaring Kage is dethroned', async () => {
        await kv.set('shared:village-war:leaf', { warResources: 500, structures: {} });
        await kv.set('save:helper', { character: { name: 'Helper', village: 'Leaf' } });
        const now = Date.now() - 60_000;
        const pairId = 'leaf-vs-mist';
        const declarationId = `v2:${pairId}:g1`;
        const source = {
            kind: 'war-resources' as const,
            recordKey: 'shared:village-war:leaf',
            accountId: 'Leaf',
            amount: 200,
        };
        const war = {
            id: pairId,
            villages: ['Leaf', 'Mist'] as [string, string],
            hp: { Leaf: 5_000, Mist: 5_000 },
            warGroundSector: 40,
            warGroundHp: 1_000,
            startedAt: now,
            updatedAt: now,
            pendingUntil: now + 3_600_000,
            declaredBy: 'oldkage',
            declarationGeneration: 1,
            warCrateId: 'war-crate-leaf-vs-mist-g1',
        };
        const fingerprint = fundingFingerprint({ declarationId, pairId, source, villages: war.villages });
        const ownerId = 'crashed-owner';
        const reservationPlan = {
            pairId,
            warKey: `world:war:${pairId}`,
            villages: war.villages,
            generation: 1,
            declarationId,
            fingerprint,
            source,
            ownerId,
            now,
            leaseMs: 1,
        };
        assert.equal((await claimReservations(kv, reservationPlan)).status, 'acquired');
        const fundingPlan = {
            warKey: reservationPlan.warKey,
            declarationId,
            fingerprint,
            war,
            source,
            ownerId,
            now,
            leaseMs: 1,
        };
        assert.equal((await reserveFunding(kv, fundingPlan)).status, 'acquired');
        assert.equal((await promoteReservations(kv, reservationPlan)).status, 'reserved');
        // Process crashes before debit. Original Kage loses the seat; an ordinary
        // authenticated participant safely triggers takeover/help-forward.
        await kv.set('village:kage:leaf', { seatedKage: 'someoneelse' });

        const helped = await invoke('helper', ['Leaf', 'Mist']);
        assert.equal(helped.statusCode, 200, helped.body?.error);
        assert.equal(helped.body?.replayed, true);
        assert.equal(helped.body?.war?.declarationFunding?.status, 'active');
        assert.equal((await kv.get<Record<string, unknown>>('shared:village-war:leaf'))?.warResources, 300);
    });

    it('blocks a direct HP-zero territory owner flip while an active sector contest binds the defender', async () => {
        const now = Date.now();
        await kv.set('world:territory:40', {
            sector: 40,
            ownerVillage: 'Mist',
            hp: 0,
            updatedAt: now - 1,
        });
        await kv.set('save:sandcaptain', {
            character: { name: 'Sand Captain', village: 'Sand' },
        });
        await kv.set('shared:sector-war:40:leaf-vs-mist', {
            id: '40:leaf-vs-mist',
            sector: 40,
            attackerVillage: 'Leaf',
            defenderVillage: 'Mist',
            winCondition: 'combat',
            attackerPoints: 0,
            defenderPoints: 0,
            startedAt: now - 1_000,
            endsAt: now + 60_000,
            updatedAt: now - 1_000,
            flipped: false,
            declarationGeneration: 1,
            declarationFunding: {
                version: 1,
                status: 'active',
                declarationId: 'sector:40:leaf-vs-mist:g1',
                fingerprint: 'a'.repeat(64),
                source: {
                    kind: 'war-resources',
                    recordKey: 'shared:village-war:leaf',
                    accountId: 'Leaf',
                    amount: 200,
                },
                createdAt: now - 1_000,
                ownerId: 'sector-owner',
                leaseExpiresAt: now + 30_000,
                takeoverCount: 0,
                fundedAt: now - 900,
                activatedAt: now - 900,
            },
        });

        const capture = await invokeTerritory('sandcaptain', {
            sector: 40,
            ownerVillage: 'Sand',
            hp: 20_000,
            updatedAt: now,
        });
        assert.equal(capture.statusCode, 409);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:40'))?.ownerVillage, 'Mist');
    });
});
