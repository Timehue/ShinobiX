import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { apexBeastForWeek, isoWeekKey } from './_apex-contract.js';
import {
    genericExploreOpponentId,
    raidVillageGuardOpponentId,
    releaseRaidAiTokenReservation,
    reserveRaidAiToken,
    resolveGenericAiFightAuthority,
    settleRaidAiToken,
} from './_generic-ai-fight-authority.js';

function memoryStore(seed: Record<string, unknown> = {}) {
    const rows = new Map(Object.entries(seed));
    return {
        rows,
        async get<T>(key: string) { return (rows.get(key) as T | undefined) ?? null; },
        async set(key: string, value: unknown) { rows.set(key, value); return 'OK'; },
        async compareSet(key: string, expected: unknown, value: unknown) {
            if (!Object.is(rows.get(key), expected)) return false;
            rows.set(key, value);
            return true;
        },
    };
}

describe('generic AI fight authority', () => {
    it('varies explore opponents while keeping their effective level at or below the player', async () => {
        const selected = Array.from({ length: 32 }, (_, index) => genericExploreOpponentId({
            playerName: 'Scout',
            level: 32,
            sector: 61,
            receiptId: `exploreproof${String(index).padStart(2, '0')}`,
        }));
        assert.ok(new Set(selected).size > 1, 'receipt seeds should spread explorers across eligible opponents');
        for (const id of selected) assert.ok(AI_PROFILE_CATALOG[id]!.level <= 32, `${id} is within the level band`);

        const lowLevel = await resolveGenericAiFightAuthority({
            store: memoryStore() as never,
            playerName: 'NewScout',
            body: { battleKind: 'explore', sector: 1, worldExploreRequestId: 'explorelowlevel01' },
            character: {
                level: 1,
                redeemedSectorExplorations: [{ id: 'explorelowlevel01', sector: 1, at: Date.now(), outcome: { kind: 'battle' } }],
            },
            tokenTtlSeconds: 1800,
        });
        assert.deepEqual(lowLevel.scaling, { level: 1 }, 'the fallback profile is scaled to the attacker, never above them');
    });

    it('chooses a village-themed raid guard at the nearest eligible level tier', () => {
        assert.equal(raidVillageGuardOpponentId('Stormveil Village', 32), 'story-ai-stormveil-village-25');
        assert.equal(raidVillageGuardOpponentId('Ashen Leaf Village', 50), 'story-ai-ashen-leaf-village-50');
        assert.equal(raidVillageGuardOpponentId('Frostfang Village', 100), 'story-ai-frostfang-village-100');
        for (const id of [
            raidVillageGuardOpponentId('Stormveil Village', 32),
            raidVillageGuardOpponentId('Ashen Leaf Village', 50),
            raidVillageGuardOpponentId('Frostfang Village', 100),
        ]) assert.ok(AI_PROFILE_CATALOG[id], `${id} exists in the published AI catalog`);
    });

    it('derives an explore opponent from the server level band and exact sector receipt', async () => {
        const store = memoryStore();
        const character = {
            level: 32,
            redeemedSectorExplorations: [{ id: 'exploreproof01', sector: 61, at: Date.now(), outcome: { kind: 'battle' } }],
        };
        const authority = await resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Scout',
            body: { battleKind: 'explore', sector: 61, worldExploreRequestId: 'exploreproof01', opponentId: 'builtin-ai-academy-sparring' },
            character,
            tokenTtlSeconds: 1800,
        });
        assert.equal(authority.opponentId, genericExploreOpponentId({ playerName: 'Scout', level: 32, sector: 61, receiptId: 'exploreproof01' }));
        assert.notEqual(authority.opponentId, 'builtin-ai-academy-sparring');
        const durableRequestId = 'exploreproof02';
        const durableStore = memoryStore({
            [`world-explore-receipt:Scout:${durableRequestId}`]: {
                version: 1,
                playerName: 'Scout',
                requestId: durableRequestId,
                sector: 61,
                reward: { sector: 61, xp: 0, ryo: 0 },
                outcome: { kind: 'battle' },
                at: Date.now(),
            },
        });
        const durableAuthority = await resolveGenericAiFightAuthority({
            store: durableStore as never,
            playerName: 'Scout',
            body: { battleKind: 'explore', sector: 61, worldExploreRequestId: durableRequestId },
            character: { level: 32, redeemedSectorExplorations: [] },
            tokenTtlSeconds: 1800,
        });
        assert.equal(
            durableAuthority.opponentId,
            genericExploreOpponentId({ playerName: 'Scout', level: 32, sector: 61, receiptId: durableRequestId }),
            'a durable battle receipt remains authoritative after the capped save projection evicts it',
        );
        await assert.rejects(() => resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Scout',
            body: { battleKind: 'explore', sector: 62, worldExploreRequestId: 'exploreproof01' },
            character,
            tokenTtlSeconds: 1800,
        }), /does not prove this sector/);

        for (const kind of ['chest', 'none']) {
            await assert.rejects(() => resolveGenericAiFightAuthority({
                store: memoryStore() as never,
                playerName: 'Scout',
                body: { battleKind: 'explore', sector: 61, worldExploreRequestId: `notbattle${kind}01` },
                character: {
                    level: 32,
                    redeemedSectorExplorations: [{ id: `notbattle${kind}01`, sector: 61, at: Date.now(), outcome: { kind } }],
                },
                tokenTtlSeconds: 1800,
            }), /does not prove this sector/);
        }
    });

    it('binds raid AI to the exact still-live raid token target', async () => {
        const key = 'raid-token:Raider:raidproof001';
        const store = memoryStore({ [key]: { playerName: 'Raider', aiId: 'builtin-ai-frost-sealer', sector: 44, authorityVersion: 2, status: 'minted' } });
        const authority = await resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', opponentId: 'builtin-ai-frost-sealer', sector: 44, raidToken: 'raidproof001' },
            character: { level: 40 },
            tokenTtlSeconds: 1800,
        });
        assert.equal(authority.opponentId, 'builtin-ai-frost-sealer');
        const forged = await resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', opponentId: 'builtin-ai-mist-sentinel', sector: 44, raidToken: 'raidproof001' },
            character: { level: 40 },
            tokenTtlSeconds: 1800,
        });
        assert.equal(forged.opponentId, 'builtin-ai-frost-sealer', 'request cannot replace the token-owned opponent');

        await reserveRaidAiToken({
            store: store as never,
            key,
            expected: authority.raidTokenRecord!,
            aiFightToken: 'aifighttoken01',
            sessionId: 'aifight-session-01',
            ttlSeconds: 1800,
        });
        await assert.rejects(() => resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', sector: 44, raidToken: 'raidproof001' },
            character: { level: 40 },
            tokenTtlSeconds: 1800,
        }), /does not match/);
        await releaseRaidAiTokenReservation({
            store: store as never,
            key,
            aiFightToken: 'aifighttoken01',
            sessionId: 'aifight-session-01',
            ttlSeconds: 1800,
        });
        const rematch = await resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', sector: 44, raidToken: 'raidproof001' },
            character: { level: 40 },
            tokenTtlSeconds: 1800,
        });
        await reserveRaidAiToken({
            store: store as never,
            key,
            expected: rematch.raidTokenRecord!,
            aiFightToken: 'aifighttoken02',
            sessionId: 'aifight-session-02',
            ttlSeconds: 1800,
        });
        await settleRaidAiToken({
            store: store as never,
            playerName: 'Raider',
            raidTokenId: 'raidproof001',
            aiFightToken: 'aifighttoken02',
            sessionId: 'aifight-session-02',
            outcome: 'loss',
            ttlSeconds: 1800,
        });
        await settleRaidAiToken({
            store: store as never,
            playerName: 'Raider',
            raidTokenId: 'raidproof001',
            aiFightToken: 'aifighttoken02',
            sessionId: 'aifight-session-02',
            outcome: 'loss',
            ttlSeconds: 1800,
        });
        assert.equal((store.rows.get(key) as { status?: string }).status, 'settled');
    });

    it('copies the mission identity from the server raid token, never the client body', async () => {
        const store = memoryStore({
            'raid-token:Raider:missionproof001': {
                playerName: 'Raider', aiId: 'server-authored-test-profile', sector: 18,
                source: 'field-mission-raid', sourceId: 'fetch-d-supply-trail',
                missionId: 'fetch-d-supply-trail', missionRunId: 'fieldrunmission001', authorityVersion: 2, status: 'minted',
            },
        });
        const authority = await resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', opponentId: 'client-choice', sector: 18, raidToken: 'missionproof001', missionId: 'forged-mission' },
            character: { level: 1, serverFieldMissionRuns: {
                'fetch-d-supply-trail': { missionId: 'fetch-d-supply-trail', runId: 'fieldrunmission001', acceptedAt: 1 },
            } },
            tokenTtlSeconds: 1800,
        });
        assert.equal(authority.raidMissionId, 'fetch-d-supply-trail');
        await assert.rejects(() => resolveGenericAiFightAuthority({
            store: store as never,
            playerName: 'Raider',
            body: { battleKind: 'raidAi', sector: 18, raidToken: 'missionproof001' },
            character: { level: 1, serverFieldMissionRuns: {
                'fetch-d-supply-trail': { missionId: 'fetch-d-supply-trail', runId: 'fieldrunreplacement01', acceptedAt: 2 },
            } },
            tokenTtlSeconds: 1800,
        }), /earlier contract run/);
        assert.equal(authority.opponentId, 'server-authored-test-profile');
    });

    it('allows only this week\'s Apex and rejects generic dedicated-mode forgery', async () => {
        const apex = apexBeastForWeek(isoWeekKey(new Date())).apexAiId;
        const allowed = await resolveGenericAiFightAuthority({
            store: memoryStore() as never,
            playerName: 'Hunter',
            body: { battleKind: 'raidAi', opponentId: apex },
            character: { level: 100, hunterRank: 5 },
            tokenTtlSeconds: 1800,
        });
        assert.equal(allowed.opponentId, apex);
        for (const battleKind of ['mission', 'defense', 'endless', 'world']) {
            await assert.rejects(() => resolveGenericAiFightAuthority({
                store: memoryStore() as never,
                playerName: 'Hunter',
                body: { battleKind, opponentId: 'builtin-ai-mist-sentinel' },
                character: { level: 100, hunterRank: 5 },
                tokenTtlSeconds: 1800,
            }), /dedicated authoritative combat route/);
        }
    });
});
