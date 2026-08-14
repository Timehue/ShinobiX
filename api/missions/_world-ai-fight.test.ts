import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyWorldAiFightSettlement,
    applyWorldChainHeal,
    buildWorldAiFightSpec,
    cleanWorldAiFightRequest,
    reserveWorldAiChainStage,
    settleWorldAiChainStage,
    WORLD_AI_ACTIVE_TTL_SECONDS,
    WORLD_AI_FIGHT_TTL_SECONDS,
} from './_world-ai-fight.js';
import { SOLO_PVE_SESSION_TTL_SECONDS } from '../solo-pve/_session.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';
import { serverHuntTrailSector } from './_hunt-trail.js';
import {
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS,
    COMBAT_STRIP_CHAR_FIELDS,
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS,
} from '../save/_state-ownership.js';

function huntSave(overrides: Record<string, unknown> = {}) {
    return {
        currentSector: 25,
        acceptedMissionIds: ['hunt-wild-boar'],
        missionProgress: { 'hunt-wild-boar': 2 },
        character: {
            name: 'Hunter', level: 20, hp: 500, maxHp: 600, hunterRank: 1,
            serverHuntTrails: {
                'hunt-wild-boar': {
                    missionId: 'hunt-wild-boar', runId: 'run1', progress: 2,
                    quality: 3, acceptedAt: 1,
                },
            },
            ...overrides,
        },
    };
}

class MemoryStore {
    readonly data = new Map<string, unknown>();
    async get<T>(key: string): Promise<T | null> { return (this.data.get(key) as T | undefined) ?? null; }
    async set(key: string, value: unknown): Promise<'OK'> { this.data.set(key, structuredClone(value)); return 'OK'; }
    async del(...keys: string[]): Promise<number> {
        let count = 0;
        for (const key of keys) if (this.data.delete(key)) count += 1;
        return count;
    }
}

describe('World AI fight authority', () => {
    it('rejects unrelated chain/decision fields and off-map sectors', () => {
        assert.equal(cleanWorldAiFightRequest({ kind: 'questbook-boss', sourceId: 'qb-bell', sector: 1, stage: 1, chainId: 'abcdefgh' }), null);
        assert.equal(cleanWorldAiFightRequest({ kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 1, stage: 0, chainId: 'abcdefgh' }), null);
        assert.equal(cleanWorldAiFightRequest({ kind: 'hunt-pack', sourceId: 'hunt-wild-boar', sector: 25, stage: 0 }), null);
        for (const sector of [60, 61, 66]) {
            assert.ok(cleanWorldAiFightRequest({ kind: 'wanderer', sourceId: 'w-1-1-0', sector }), `sector ${sector} should be a normal World sector`);
        }
        for (const sector of [67, 99]) {
            assert.equal(cleanWorldAiFightRequest({ kind: 'wanderer', sourceId: 'w-1-1-0', sector }), null, `sector ${sector} must not be a normal World encounter sector`);
        }
    });

    it('keeps world token/pointer lifetime coherent with the active solo-PvE session', () => {
        assert.ok(WORLD_AI_FIGHT_TTL_SECONDS >= SOLO_PVE_SESSION_TTL_SECONDS);
        assert.equal(WORLD_AI_ACTIVE_TTL_SECONDS, WORLD_AI_FIGHT_TTL_SECONDS);
    });

    it('binds an encoded natural wanderer to its visible sector', async () => {
        const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
        await assert.rejects(
            buildWorldAiFightSpec({
                playerName: 'Hunter',
                request: { kind: 'wanderer', sourceId: `w-1-${bucket}-0`, sector: 2 },
                save: { currentSector: 2, character: { level: 20, starterCardsClaimed: true, pets: [{}] } },
            }),
            /world-wanderer-not-attackable/,
        );
    });

    it('keeps authored hunt signs on sectors 1..60 while general world descriptors allow expansion sectors', () => {
        for (const progress of [0, 1, 2]) {
            const sector = serverHuntTrailSector({ id: 'hunt-wild-boar', targetSector: 25, exploreCount: 3 }, progress, 'Hunter');
            assert.ok(sector >= 1 && sector <= 60);
        }
    });

    it('derives hunt opening from the server trail and ignores any local opponent payload', async () => {
        const spec = await buildWorldAiFightSpec({
            playerName: 'Hunter',
            request: { kind: 'hunt-target', sourceId: 'hunt-wild-boar', sector: 25 },
            save: huntSave(),
        });
        assert.equal(spec.context.huntQuality, 3);
        assert.equal(spec.context.huntOpening, 'cornered');
        assert.equal(spec.context.missionId, 'hunt-wild-boar');
        assert.equal(spec.profile.id, 'hunt-ai-wild-boar');
    });

    it('derives a nonzero Quest Book boss stage from the durable seal when request omits stage', async () => {
        const spec = await buildWorldAiFightSpec({
            playerName: 'Hunter',
            request: { kind: 'questbook-boss', sourceId: 'qb-bell', sector: 25 },
            save: {
                currentSector: 25,
                activeQuestbookSeal: { id: 'qb-bell', stage: 3, baseline: 12, at: 1234, choices: { curse: 'cleanse' } },
                character: { name: 'Hunter', level: 30 },
            },
        });
        assert.equal(spec.context.stage, 3);
        assert.equal(spec.context.displayName, 'The Bell-Wraith');
        assert.equal(spec.context.sealVersion, 'qb-bell:3:12:1234');
    });

    it('blocks a target while its sealed pack decision is unsettled', async () => {
        const save = huntSave({
            serverHuntTrails: {
                'hunt-wild-boar': {
                    missionId: 'hunt-wild-boar', runId: 'run1', progress: 2, quality: 0,
                    acceptedAt: 1, decisionId: 'hunt_run1_1_push', packPending: true, packSettled: false,
                },
            },
        });
        await assert.rejects(
            buildWorldAiFightSpec({ playerName: 'Hunter', request: { kind: 'hunt-target', sourceId: 'hunt-wild-boar', sector: 25 }, save }),
            /world-hunt-pack-unsettled/,
        );
    });

    it('starts an early hunt-pack only for its exact decision and sector, then settles loss once', async () => {
        const decisionId = 'hunt_run1_0_push';
        const initial = huntSave({
            serverHuntTrails: {
                'hunt-wild-boar': {
                    missionId: 'hunt-wild-boar', runId: 'run1', progress: 1, quality: 1,
                    acceptedAt: 1, decisionId, packPending: true, packSettled: false,
                    lastDecision: {
                        id: decisionId, sector: 20, stage: 0, choiceId: 'push', ambush: true,
                        progress: 1, quality: 1, nextSector: 21,
                    },
                },
            },
        });
        const earlySave = { ...initial, currentSector: 20 };
        const request = { kind: 'hunt-pack' as const, sourceId: 'hunt-wild-boar', sector: 20, stage: 0, decisionId };
        const spec = await buildWorldAiFightSpec({ playerName: 'Hunter', request, save: earlySave, generatedChainId: 'packchain1' });
        assert.equal(spec.context.chainId, 'packchain1');
        assert.equal(spec.context.missionId, 'hunt-wild-boar');

        await assert.rejects(
            buildWorldAiFightSpec({ playerName: 'Hunter', request: { ...request, sector: 21 }, save: { ...earlySave, currentSector: 21 } }),
            /world-hunt-pack-wrong-sector/,
        );
        await assert.rejects(
            buildWorldAiFightSpec({ playerName: 'Hunter', request: { ...request, decisionId: 'hunt_run1_0_forged' }, save: earlySave }),
            /world-hunt-pack-not-pending/,
        );

        const lost = applyWorldAiFightSettlement(earlySave.character, spec.context, 'loss', 'loss-proof');
        const lostTrail = (lost.serverHuntTrails as Record<string, Record<string, unknown>>)['hunt-wild-boar']!;
        assert.equal(lostTrail.packPending, false);
        assert.equal(lostTrail.packSettled, true);
        assert.equal(lostTrail.quality, 0);
        const replay = applyWorldAiFightSettlement(lost, spec.context, 'loss', 'loss-proof');
        assert.deepEqual(replay, lost, 'replayed loss cannot apply the quality penalty twice');
        await assert.rejects(
            buildWorldAiFightSpec({ playerName: 'Hunter', request, save: { ...earlySave, character: lost } }),
            /world-hunt-pack-not-pending/,
        );
    });

    it('settles the final pack win once and leaves the hunt trail ready to continue', () => {
        const decisionId = 'hunt_run1_0_push';
        const character = huntSave({
            serverHuntTrails: {
                'hunt-wild-boar': {
                    missionId: 'hunt-wild-boar', runId: 'run1', progress: 1, quality: 1,
                    acceptedAt: 1, decisionId, packPending: true, packSettled: false,
                },
            },
        }).character;
        const context: WorldAiFightContext = {
            kind: 'hunt-pack', sourceId: 'hunt-wild-boar', missionId: 'hunt-wild-boar',
            huntRunId: 'run1', decisionId, sector: 20, stage: 2, chainId: 'packchain1', displayName: 'Boar Packmate', finalStage: true,
        };
        const won = applyWorldAiFightSettlement(character, context, 'win', 'win-proof');
        const trail = (won.serverHuntTrails as Record<string, Record<string, unknown>>)['hunt-wild-boar']!;
        assert.equal(trail.packPending, false);
        assert.equal(trail.packSettled, true);
        assert.equal(trail.quality, 2);
        assert.deepEqual(applyWorldAiFightSettlement(won, context, 'win', 'win-proof'), won);
    });

    it('allows a hunt rematch after loss but rejects another target after the sealed win', async () => {
        const context: WorldAiFightContext = {
            kind: 'hunt-target', sourceId: 'hunt-wild-boar', missionId: 'hunt-wild-boar',
            huntRunId: 'run1', sector: 25, stage: 0, displayName: 'Wild Boar', finalStage: true,
        };
        const initial = huntSave();
        const lost = applyWorldAiFightSettlement(initial.character, context, 'loss', 'loss-proof');
        await assert.doesNotReject(buildWorldAiFightSpec({ playerName: 'Hunter', request: { kind: 'hunt-target', sourceId: 'hunt-wild-boar', sector: 25 }, save: { ...initial, character: lost } }));
        const won = applyWorldAiFightSettlement(lost, context, 'win', 'win-proof');
        const trail = (won.serverHuntTrails as Record<string, Record<string, unknown>>)['hunt-wild-boar']!;
        assert.equal(trail.targetProofId, 'huntkill_win-proof');
        await assert.rejects(
            buildWorldAiFightSpec({ playerName: 'Hunter', request: { kind: 'hunt-target', sourceId: 'hunt-wild-boar', sector: 25 }, save: { ...initial, character: won } }),
            /world-hunt-target-already-defeated/,
        );
    });

    it('keeps every world authority field in all sanitizer-owned groups', () => {
        for (const field of ['worldAiChainWins', 'worldAiChainHeals', 'worldAiContextWins', 'serverHuntTrails']) {
            assert.ok(ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS.includes(field));
            assert.ok(STRICT_SERVER_LEDGER_CHARACTER_FIELDS.includes(field));
            assert.ok(COMBAT_STRIP_CHAR_FIELDS.includes(field));
        }
    });

    it('heals a chained wave once and only for a proof bound to kind/source/sector', () => {
        const request = { kind: 'wanderer-ambush' as const, sourceId: 'wanderer-ambush', sector: 10, stage: 1, chainId: 'chain1234' };
        const character = {
            hp: 100, maxHp: 300,
            worldAiChainWins: [{ id: 'chain1234:0', chainId: 'chain1234', stage: 0, kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 10 }],
        };
        const once = applyWorldChainHeal(character, request);
        const twice = applyWorldChainHeal(once, request);
        assert.equal(once.hp, 200);
        assert.equal(twice.hp, 200);
        assert.throws(() => applyWorldChainHeal(character, { ...request, sourceId: 'forged-source' }), /world-chain-proof-missing/);
    });

    it('enforces a single-flight chain cursor and idempotent settlement', async () => {
        const store = new MemoryStore();
        const stage0: WorldAiFightContext = {
            kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 10,
            stage: 0, chainId: 'chain1234', displayName: 'Road Bandit', nextStage: 1,
        };
        await reserveWorldAiChainStage('Hunter', stage0, store);
        await assert.rejects(reserveWorldAiChainStage('Hunter', { ...stage0, chainId: 'newchain9' }, store), /world-chain-already-active/);
        await settleWorldAiChainStage('Hunter', stage0, 'win', 'proof0', store);
        await settleWorldAiChainStage('Hunter', stage0, 'win', 'proof0', store);
        const stage1 = { ...stage0, stage: 1, nextStage: 2 };
        await reserveWorldAiChainStage('Hunter', stage1, store);
        await assert.rejects(reserveWorldAiChainStage('Hunter', stage1, store), /world-chain-cursor-mismatch/);
        await settleWorldAiChainStage('Hunter', stage1, 'loss', 'proof1', store);
        await assert.rejects(reserveWorldAiChainStage('Hunter', { ...stage1, stage: 2 }, store), /world-chain-cursor-mismatch/);
    });
});
