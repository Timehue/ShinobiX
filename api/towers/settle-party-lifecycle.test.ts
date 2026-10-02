import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';
import { getFloor } from './_floor-catalog.js';
import { sealTowerCatalogFloor } from './_session-floor.js';
import type { TowerActor, TowerSession } from './_tower-session.js';
import type { TowerClearComparison } from '../../shared/tower-progression.js';
import { ERA_CHAPTERS } from '../../shared/era-chapters.js';
import { getSpireFloor } from './_spire-catalog.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-settle-lifecycle-admin';
delete process.env.SESSION_SECRET;

type Handler = (req: never, res: never) => Promise<unknown>;
type ResponseOut = { statusCode: number; body?: Record<string, unknown> };

let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let writeSession: typeof import('./_tower-store.js').writeSession;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ writeSession } = await import('./_tower-store.js'));
    handler = (await import('./settle.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const prefix of ['tower:*', 'tower-record-comparison:*', 'tower-party:*', 'tower-party-player:*', 'battle-lock:*', 'save:*']) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
});

function actor(slug: string, index: number): TowerActor {
    return {
        id: `sq-${index}`, side: 'squad', name: slug, ownerSlug: slug, ai: false,
        hp: 1000, maxHp: 1000, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], cooldowns: {},
        pos: index, character: {},
    };
}

function completedSession(runId: string, partyId: string): TowerSession {
    const session = {
        towerId: 'celestial', runId, floor: 1, seed: 1, partySize: 2,
        map: { width: 8, height: 8, blockedTiles: [], hazardTiles: [], objectiveTiles: [] },
        actors: [actor('host', 0), actor('alice', 1)],
        turnQueue: [], activeIndex: 0, round: 3, activeAp: 0, actionsThisTurn: 0,
        groundEffects: [], objectiveState: { kind: 'defeat-all', completed: true, failed: false },
        phaseState: { pendingPhases: [], triggeredPhases: [] },
        status: 'done', winner: 'squad', recentMoveTokens: [], rewardSettlementState: 'pending',
        log: [], createdAt: Date.now(), lastActionAt: Date.now(), towerPartyId: partyId,
    } as TowerSession & { towerPartyId: string };
    sealTowerCatalogFloor(session, getFloor(1)!, 'story');
    return session;
}

function save(slug: string) {
    return {
        _saveVersion: 1,
        character: {
            name: slug, level: 30, xp: 0, ryo: 0, fateShards: 0, boneCharms: 0,
            maxHp: 1000, maxChakra: 100, maxStamina: 100, stats: {}, unspentStats: 0,
        },
    };
}

function fakeRes() {
    const out: ResponseOut = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function settle(runId: string): Promise<ResponseOut> {
    const { res, out } = fakeRes();
    const req = {
        method: 'POST',
        body: { runId, playerName: 'host' },
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never;
    await handler(req, res);
    return out;
}

describe('Tower party settlement lifecycle', { concurrency: false }, () => {
    it('recovers final IV/V Spire proof through the actual endpoint before sealing the title', async () => {
        const previousFlag = process.env.ENABLE_LEGACY;
        const originalCompareSet = kv.compareSet;
        const oldWorld = await kv.get('game:era-state');
        process.env.ENABLE_LEGACY = '1';
        try {
            await kv.set('game:era-state', { overrides: { 'mythic-legacies': { status: 'unlocked' } } });
            for (const index of [3, 4]) {
                const chapter = ERA_CHAPTERS[index]!;
                const stages = chapter.routes[0]!.stages!;
                const tier = index === 3 ? 16 : 20;
                const runId = `tower-era-final-${index}`;
                const journeys = Object.fromEntries(ERA_CHAPTERS.slice(0, index + 1).map((entry, eraIndex) => {
                    const stages = entry.routes[0]!.stages!;
                    const stageIndex = eraIndex === index ? stages.length - 1 : stages.length;
                    return [entry.eraId, { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex, stageStartedAt: 2000, stageCounts: {},
                        completedStages: stages.slice(0, stageIndex).map(stage => ({ id: stage.id, at: 2000 })), proofReceipts: [], ...(eraIndex < index ? { completedAt: 2000 } : {}) }];
                }));
                const host = save('host');
                await kv.set('save:host', { ...host, character: { ...host.character, level: 100, legacy: { legacyId: 'first-steps', stage: 5 }, eraJourneys: journeys } });
                for (const slug of ['alice', 'boris', 'clara']) await kv.set(`save:${slug}`, save(slug));
                const session = completedSession(runId, '');
                session.towerId = 'endless-spire'; session.floor = tier; session.ascensionTier = tier; session.partySize = 4;
                session.actors = ['host', 'alice', 'boris', 'clara'].map(actor);
                session.towerTactics = { version: 2, disruptedPylons: [10], chargeBaits: 0, avoidedStrikes: 1, squadKnockouts: [] };
                sealTowerCatalogFloor(session, getSpireFloor(tier)!, 'spire');
                await writeSession(session);
                // Saves commit through mutatePlayerSave's compare-and-set.
                let failed = false;
                kv.compareSet = (async (key: string, expected: unknown, value: any, options?: any) => {
                    if (!failed && key === 'save:host' && value?.character?.eraJourneys?.[chapter.eraId]?.stageIndex === stages.length) {
                        failed = true; throw new Error('Injected final Spire campaign save failure');
                    }
                    return originalCompareSet.call(kv, key, expected, value, options);
                }) as typeof kv.compareSet;
                assert.equal((await settle(runId)).statusCode, 500);
                const partial = await kv.get<any>('save:host');
                assert.equal(partial.character.eraJourneys[chapter.eraId].stageIndex, stages.length - 1);
                assert.notEqual(await kv.get('battle-lock:host'), null);
                const stable = await settle(runId);
                assert.equal(stable.statusCode, 200); assert.equal(stable.body?.settled, true);
                const committed = await kv.get<any>('save:host');
                assert.equal(committed.character.fateShards, partial.character.fateShards, 'recovery does not duplicate Spire rewards');
                assert.equal(committed.character.eraJourneys[chapter.eraId].stageIndex, stages.length);
                assert.deepEqual(committed.character.eraJourneys[chapter.eraId].proofReceipts, [`tower:${runId}`]);
                assert.equal(await kv.get('battle-lock:host'), null);
                assert.equal((await kv.get<any>('save:alice')).character.eraJourneys, undefined);
                const journeyHandler = (await import('../eras/journey.js')).default as unknown as Handler;
                const sealed = fakeRes();
                await journeyHandler({ method: 'POST', body: { playerName: 'host', eraId: chapter.eraId, action: 'complete' },
                    headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never, sealed.res);
                assert.equal(sealed.out.statusCode, 200);
                assert.ok((sealed.out.body?.character as any).serverTitles.includes(chapter.rewardTitle));
                const finalSave = await kv.get('save:host');
                assert.equal((await settle(runId)).statusCode, 200);
                assert.deepEqual(await kv.get('save:host'), finalSave);
                kv.compareSet = originalCompareSet;
            }
        } finally {
            kv.compareSet = originalCompareSet;
            if (oldWorld) await kv.set('game:era-state', oldWorld); else await kv.del('game:era-state');
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY; else process.env.ENABLE_LEGACY = previousFlag;
        }
    });
    it('retries a failed campaign examination write before releasing the run, then enables the next era', async () => {
        const previousFlag = process.env.ENABLE_LEGACY;
        process.env.ENABLE_LEGACY = '1';
        const originalCompareSet = kv.compareSet;
        try {
            const runId = 'tower-era-exam-retry';
            const journey = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: 2,
                stageStartedAt: 2000, stageCounts: {}, completedStages: [{ id: 'field-record', at: 1500 }, { id: 'trusted-orders', at: 2000 }],
                proofReceipts: Array.from({ length: 60 }, (_, n) => `mission:${n}`) };
            const host = save('host');
            await kv.set('save:host', { ...host, character: { ...host.character, eraJourneys: { 'shinobi-awakening': journey } } });
            await kv.set('save:alice', save('alice'));
            const session = completedSession(runId, '');
            session.floor = 5;
            session.towerTactics = { version: 1, disruptedPylons: [10], chargeBaits: 0, avoidedStrikes: 0, squadKnockouts: [] };
            sealTowerCatalogFloor(session, getFloor(5)!, 'story');
            await writeSession(session);
            // Saves commit through mutatePlayerSave's compare-and-set.
            let failed = false;
            kv.compareSet = (async (key: string, expected: unknown, value: any, options?: any) => {
                if (!failed && key === 'save:host' && value?.character?.eraJourneys?.['shinobi-awakening']?.stageIndex === 3) {
                    failed = true;
                    throw new Error('Injected campaign save failure');
                }
                return originalCompareSet.call(kv, key, expected, value, options);
            }) as typeof kv.compareSet;
            assert.equal((await settle(runId)).statusCode, 500);
            const partial = await kv.get<any>('save:host');
            assert.equal(partial.character.eraJourneys['shinobi-awakening'].stageIndex, 2);
            assert.notEqual(await kv.get('battle-lock:host'), null, 'failed evidence retains recovery');
            const stable = await settle(runId);
            assert.equal(stable.statusCode, 200);
            assert.equal(stable.body?.settled, true);
            const committed = await kv.get<any>('save:host');
            assert.equal(committed.character.ryo, partial.character.ryo, 'retry cannot pay the clear twice');
            assert.equal(committed.character.eraJourneys['shinobi-awakening'].stageIndex, 3);
            assert.equal(committed.character.eraJourneys['shinobi-awakening'].proofReceipts.length, 61);
            assert.equal((stable.body?.character as any)?.name, 'host');
            assert.equal((await kv.get<any>('save:alice')).character.eraJourneys, undefined, 'a squadmate does not inherit the caller campaign');
            assert.equal(await kv.get('battle-lock:host'), null);

            const journeyHandler = (await import('../eras/journey.js')).default as unknown as Handler;
            const { res, out } = fakeRes();
            await journeyHandler({ method: 'POST', body: { playerName: 'host', eraId: 'shinobi-awakening', action: 'complete' },
                headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! }, socket: { remoteAddress: '127.0.0.1' } } as never, res);
            assert.equal(out.statusCode, 200);
            assert.ok((out.body?.character as any)?.serverTitles.includes('Keeper of the First Roster'));
            const view = fakeRes();
            await journeyHandler({ method: 'GET', query: { playerName: 'host' }, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
                socket: { remoteAddress: '127.0.0.1' } } as never, view.res);
            assert.equal(view.out.statusCode, 200);
            const chapters = view.out.body?.chapters as any[];
            assert.equal(chapters.find(chapter => chapter.eraId === 'hollow-gate-opens').available, true);
            assert.equal(chapters.find(chapter => chapter.eraId === 'village-dominion').available, false);
            const sealed = await kv.get<any>('save:host');
            await settle(runId);
            assert.deepEqual(await kv.get('save:host'), sealed, 'settlement replay preserves the sealed campaign and reward');
        } finally {
            kv.compareSet = originalCompareSet;
            if (previousFlag === undefined) delete process.env.ENABLE_LEGACY;
            else process.env.ENABLE_LEGACY = previousFlag;
        }
    });

    it('keeps discovery/indexes through a partial member failure, then closes only after stable retry', async () => {
        const partyId = `tparty-${'d'.repeat(32)}`;
        const runId = 'tower-settle-retry';
        const now = Date.now();
        await kv.set('save:host', save('host'));
        await kv.set(`tower-party:${partyId}`, {
            id: partyId, inviteCode: 'ABCDEFGH', hostSlug: 'host', binding: { mode: 'story', floor: 1 },
            status: 'active',
            members: [
                { slug: 'host', displayName: 'Host', joinedAt: now, ready: true },
                { slug: 'alice', displayName: 'Alice', joinedAt: now, ready: true },
            ],
            invitedSlugs: [], version: 5, createdAt: now, updatedAt: now,
            expiresAt: now + 2 * 60 * 60 * 1_000,
            launch: { requestId: 'settle-request-0001', runId, seed: 1, state: 'active', preparedAt: now },
            receipts: [],
        }, { ex: 2 * 60 * 60 });
        await kv.set('tower-party-player:host', partyId, { ex: 2 * 60 * 60 });
        await kv.set('tower-party-player:alice', partyId, { ex: 2 * 60 * 60 });
        await writeSession(completedSession(runId, partyId));

        const partial = await settle(runId);
        assert.equal(partial.statusCode, 200);
        assert.equal(partial.body?.settled, false);
        assert.equal(partial.body?.personalBest, undefined);
        assert.equal((await kv.get<{ status: string }>(`tower-party:${partyId}`))?.status, 'active');
        assert.equal(await kv.get('tower-party-player:host'), partyId);
        assert.equal(await kv.get('tower-party-player:alice'), partyId);
        assert.notEqual(await kv.get('battle-lock:host'), null);

        const alice = save('alice');
        await kv.set('save:alice', { ...alice, character: { ...alice.character, battleTowerRecords: {
            honors: {}, bests: { 'story:1:2:standard': { mode: 'story', floor: 1, partySize: 2, bestScore: 100, fastestRounds: 10, noKnockout: false } },
        } } });
        const stable = await settle(runId);
        assert.equal(stable.statusCode, 200);
        assert.equal(stable.body?.settled, true);
        const comparison = stable.body?.personalBest as TowerClearComparison;
        assert.equal(comparison.runId, runId);
        assert.equal(comparison.previous, undefined, 'caller receives their own baseline, not another squad member\'s');
        assert.equal((await kv.get<TowerClearComparison>(`tower-record-comparison:${runId}:alice`))?.previous?.bestScore, 100);
        assert.deepEqual((await settle(runId)).body?.personalBest, comparison, 'endpoint replay keeps the original comparison');
        assert.equal((await kv.get<{ status: string }>(`tower-party:${partyId}`))?.status, 'closed');
        assert.equal(await kv.get('tower-party-player:host'), null);
        assert.equal(await kv.get('tower-party-player:alice'), null);
        assert.equal(await kv.get('battle-lock:host'), null);
        assert.equal(await kv.get('battle-lock:alice'), null);
    });
});
