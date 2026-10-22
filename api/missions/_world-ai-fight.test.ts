import { before, describe, it } from 'node:test';
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
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { STANDARD_PVE_AI_POLICY } from '../solo-pve/_ai-turn-policy.js';
import type { WorldAiFightContext } from '../../shared/world-ai-fight.js';
import { serverHuntTrailSector } from './_hunt-trail.js';
import { kv } from '../_storage.js';
import { ordinaryWandererEncounter, rollWanderers, WANDERER_BUCKET_MS, WANDERER_RIFT_INDEX } from '../../shared/wanderer-roster.js';
import { rollTradeWanderer } from '../../shared/wanderer-extra-slots.js';
import { roadNemesisPresentAt } from '../../shared/road-nemesis.js';
import { RIFT_QUESTS } from '../sector/_rift-quest.js';
import { HUNT_MISSION_IDS, huntMissionById } from './_mission-catalog.js';
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
    it('routes every built-in hunt through formations while preserving its exact target identity', async () => {
        assert.ok(HUNT_MISSION_IDS.size >= 10);
        for (const id of HUNT_MISSION_IDS) {
            const mission = huntMissionById(id)!;
            const ready = { currentSector: mission.targetSector, acceptedMissionIds: [id], character: {
                name: 'Hunter', level: 100, hunterRank: 5,
                serverHuntTrails: { [id]: { missionId: id, runId: `accepted-${id}`, progress: mission.exploreCount - 1, quality: 0, acceptedAt: 1 } },
            } };
            const target = await buildWorldAiFightSpec({ playerName: 'Hunter', save: ready,
                request: { kind: 'hunt-target', sourceId: id, sector: mission.targetSector } });
            assert.equal(target.profile.id, mission.aiProfileId);
            assert.ok(target.context.huntFormation, id);
            assert.equal(target.context.finalStage, true);
            assert.equal(target.context.huntRunId, `accepted-${id}`);
        }
    });

    it('does not revive old hunt chains after abandoning or reaccepting the contract', () => {
        const character = huntSave().character;
        const old: WorldAiFightContext = { kind: 'hunt-pack', sourceId: 'hunt-wild-boar', missionId: 'hunt-wild-boar',
            huntRunId: 'abandoned-run', decisionId: 'old-decision', chainId: 'old-chain', stage: 0, nextStage: 1, displayName: 'Boar', sector: 25 };
        assert.deepEqual(applyWorldAiFightSettlement(character, old, 'win', 'late-win'), character);
        assert.deepEqual(applyWorldAiFightSettlement({ ...character, serverHuntTrails: {} }, old, 'win', 'late-win'), { ...character, serverHuntTrails: {} });
    });

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
        assert.deepEqual(cleanWorldAiFightRequest({ kind: 'world-crisis', sourceId: 'fourfold-breach-v1:stormveil', sector: 0 }), {
            kind: 'world-crisis', sourceId: 'fourfold-breach-v1:stormveil', sector: 0,
        });
        assert.equal(cleanWorldAiFightRequest({ kind: 'world-crisis', sourceId: 'fourfold-breach-v1:stormveil', sector: 1 }), null);
        assert.equal(cleanWorldAiFightRequest({ kind: 'wanderer', sourceId: 'w-1-1-0', sector: 0 }), null);
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
        assert.ok(spec.context.huntFormation);
        assert.equal(spec.context.finalStage, true);
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
        assert.ok(spec.context.huntFormation);
        assert.equal(spec.context.finalStage, true);
        const legacyRequest = { ...request, stage: 1, chainId: 'old-pack-chain' };
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Hunter', request: legacyRequest, save: earlySave }), /world-chain-proof-missing/);
        const legacy = await buildWorldAiFightSpec({ playerName: 'Hunter', request: legacyRequest,
            save: { ...earlySave, character: { ...earlySave.character, worldAiChainWins: [{ chainId: 'old-pack-chain', stage: 0, kind: 'hunt-pack', sourceId: request.sourceId, sector: 20 }] } } });
        assert.equal(legacy.context.huntFormation, undefined);
        assert.equal(legacy.context.nextStage, 2);

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

    it('a night ninja never moves the bandit streak, but losing to one marks you for Kagero', () => {
        const night: WorldAiFightContext = { kind: 'wanderer', sourceId: 'w-12-5000-2', sector: 12, stage: 0, displayName: 'Nightjar Reiko', finalStage: true };
        const bandit: WorldAiFightContext = { ...night, sourceId: 'w-12-5000-0', displayName: 'Kano Two-Blades' };
        const start = { level: 20, robberStreak: 3 };
        const nightWin = applyWorldAiFightSettlement(start, night, 'win', 'night-win');
        const nightLoss = applyWorldAiFightSettlement(start, night, 'loss', 'night-loss');
        assert.equal(nightWin.robberStreak, 3);
        assert.equal(nightWin.wandererNemesis ?? null, null);
        assert.equal(nightLoss.robberStreak, 3);
        assert.deepEqual(nightLoss.wandererNemesis, { name: 'Kagero', level: 21, tier: 1 });
        // Bandits keep the streak rules, and the rival they leave is always Kagero.
        assert.equal(applyWorldAiFightSettlement(start, bandit, 'win', 'bandit-win').robberStreak, 4);
        const banditLoss = applyWorldAiFightSettlement(start, bandit, 'loss', 'bandit-loss');
        assert.equal(banditLoss.robberStreak, 0);
        assert.equal((banditLoss.wandererNemesis as { name?: string })?.name, 'Kagero');
    });

    it('the angler/miner and rift-creature slots move neither the streak nor the rival', () => {
        const start = { level: 20, robberStreak: 3 };
        for (const sourceId of ['w-38-5000-3', 'w-38-5000-4']) {
            const context: WorldAiFightContext = { kind: 'wanderer', sourceId, sector: 38, stage: 0, displayName: 'Opponent', finalStage: true };
            for (const outcome of ['win', 'loss'] as const) {
                const after = applyWorldAiFightSettlement(start, context, outcome, `${sourceId}-${outcome}`);
                assert.equal(after.robberStreak, 3, `${sourceId} ${outcome}`);
                assert.equal(after.wandererNemesis ?? null, null, `${sourceId} ${outcome}`);
            }
        }
    });

    it('beating Kagero clears him, and losing to him raises his tier under his own name', () => {
        const context: WorldAiFightContext = { kind: 'wanderer', sourceId: 'nemesis', sector: 12, stage: 0, displayName: 'Kagero', finalStage: true };
        const marked = { level: 20, robberStreak: 3, wandererNemesis: { name: 'Genta Red-Sash', level: 21, tier: 2 } };
        const won = applyWorldAiFightSettlement(marked, context, 'win', 'k-win');
        const lost = applyWorldAiFightSettlement(marked, context, 'loss', 'k-loss');
        assert.equal(won.wandererNemesis, null);
        assert.deepEqual(lost.wandererNemesis, { name: 'Kagero', level: 21, tier: 3 });
        // He is not a bandit: his fights leave the gang's robber streak alone.
        assert.equal(won.robberStreak, 3);
        assert.equal(lost.robberStreak, 3);
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

describe('World AI fight authority for the road cast', () => {
    before(() => {
        process.env.NODE_ENV = 'test';
        process.env.SHINOBIX_QA_MEMORY_KV = '1';
    });

    /** The first (sector, window) from bucket 5000 whose slot `index` holds `verb`. */
    function find(verb: string, roll: (sector: number, bucket: number) => Array<{ id: string; verb: string }>) {
        for (let bucket = 5000; bucket < 5400; bucket++) {
            for (let sector = 1; sector <= 66; sector++) {
                const hit = roll(sector, bucket).find((w) => w.verb === verb);
                if (hit) return { sector, bucket, id: hit.id, now: bucket * WANDERER_BUCKET_MS + 60_000 };
            }
        }
        throw new Error(`no ${verb} in 400 windows`);
    }
    const save = (sector: number, character: Record<string, unknown>) => ({ currentSector: sector, character: { name: 'Roadwalker', level: 30, village: 'Leaf', ...character } });

    it('seals the same ordinary NPC that was previewed, keeps its regional level, and rejects stale identities', async () => {
        const road = find('attack', rollWanderers);
        const npc = rollWanderers(road.sector, road.bucket).find((entry) => entry.id === road.id)!;
        const preview = ordinaryWandererEncounter(npc, 100, road.sector)!;
        const request = { kind: 'wanderer' as const, sourceId: road.id, sector: road.sector, encounterId: preview.id };
        const spec = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: save(road.sector, { level: 100 }), now: road.now });
        assert.equal(spec.profile.level, preview.level);
        assert.equal(spec.profile.name, preview.displayName);
        assert.equal(spec.profile.pveDifficulty, preview.difficulty);
        assert.equal(spec.context.encounter?.id, preview.id);
        assert.equal(spec.context.encounter?.portraitKey, preview.portraitKey);
        assert.equal(spec.context.encounter?.baseRyo, 150, 'the purse follows the L100 save, not the regional NPC level');
        assert.ok(Number(spec.profile.level) < 100, 'ordinary road NPC does not become player + 1');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { ...request, encounterId: 'ordinary-deadbeef' },
            save: save(road.sector, { level: 100 }), now: road.now }), /preview-stale/);
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request,
            save: save(road.sector, { level: 100 }), now: road.now + WANDERER_BUCKET_MS }), /not-attackable/);
    });

    it('retains the sealed role template when a high-level natural NPC receives its unique world identity', async () => {
        let fixture: { sector: number; now: number; id: string } | undefined;
        for (let bucket = 5000; bucket < 5050 && !fixture; bucket++) {
            for (let sector = 61; sector <= 66 && !fixture; sector++) {
                const npc = rollWanderers(sector, bucket).find((entry) => entry.archetype === 'bandit'
                    && ordinaryWandererEncounter(entry, 100, sector)?.difficulty === 'standard');
                if (npc) fixture = { sector, now: bucket * WANDERER_BUCKET_MS + 60_000, id: npc.id };
            }
        }
        assert.ok(fixture, 'a deterministic high-level ordinary bandit exists');
        const stored = save(fixture.sector, { level: 100, hp: 10_000, maxHp: 10_000, stats: {}, equipment: {} });
        const spec = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { kind: 'wanderer', sourceId: fixture.id, sector: fixture.sector },
            save: stored, now: fixture.now });
        assert.match(spec.profile.id, /^world-wanderer-/);
        assert.equal(spec.profile.pveTemplateId, spec.context.encounter?.profileId);
        const session = buildSoloPveAiEncounter({ playerName: 'Roadwalker', sessionId: 'natural-kit-regression', save: stored,
            profile: spec.profile, now: fixture.now, admin: null, aiTurnPolicy: STANDARD_PVE_AI_POLICY,
            encounter: { kind: 'world-ai', id: fixture.id } });
        const kit = session.enemy.character.jutsu as Array<{ ap?: number; effectPower?: number }>;
        assert.equal(kit.filter((move) => move.ap === 60 && Number(move.effectPower) > 1).length, 6,
            'a high-level ordinary world instance receives its six damaging catalog techniques');
    });

    it("refuses your own village's patrol and names a rival village's patrol for its holder", async () => {
        const patrol = find('patrol', rollWanderers);
        const request = { kind: 'patrol' as const, sourceId: patrol.id, sector: patrol.sector };
        await kv.set(`world:territory:${patrol.sector}`, { ownerVillage: 'Leaf' });
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: save(patrol.sector, {}), now: patrol.now }), /world-patrol-own-village/);
        await kv.set(`world:territory:${patrol.sector}`, { ownerVillage: 'Mist' });
        const rival = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: save(patrol.sector, {}), now: patrol.now });
        assert.equal(rival.context.displayName, 'Mist Patrol');
        await kv.del(`world:territory:${patrol.sector}`);
        const neutral = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: save(patrol.sector, {}), now: patrol.now });
        assert.doesNotMatch(neutral.context.displayName, /^Mist|^Leaf/u);
    });

    it('fights Kagero only in a sector his presence gate opens, under his earned title', async () => {
        const now = 5000 * WANDERER_BUCKET_MS + 60_000;
        let here = 0, away = 0;
        for (let sector = 1; sector <= 66 && (!here || !away); sector++) {
            if (roadNemesisPresentAt('Roadwalker', sector, now)) here ||= sector;
            else away ||= sector;
        }
        assert.ok(here && away);
        const rival = { wandererNemesis: { name: 'Kano Two-Blades', level: 31, tier: 3 } };
        const spec = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { kind: 'wanderer', sourceId: 'nemesis', sector: here }, save: save(here, rival), now });
        assert.equal(spec.context.displayName, 'Kagero the Road-Taker');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { kind: 'wanderer', sourceId: 'nemesis', sector: away }, save: save(away, rival), now }), /world-nemesis-not-here/);
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { kind: 'wanderer', sourceId: 'nemesis', sector: here }, save: save(here, {}), now }), /world-nemesis-missing/);
    });

    it('contests a rival miner, and fights a rift creature only for the seal holder', async () => {
        const miner = find('contest', (sector, bucket) => [rollTradeWanderer(sector, bucket)].filter((w) => w !== null));
        const spec = await buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { kind: 'wanderer', sourceId: miner.id, sector: miner.sector }, save: save(miner.sector, {}), now: miner.now });
        assert.equal(spec.context.sourceId, miner.id);
        const now = 5000 * WANDERER_BUCKET_MS + 60_000;
        const riftId = Object.keys(RIFT_QUESTS)[0]!;
        // The SEALED quest lives on the save record; activeRiftQuest is a display
        // mirror the client's own save writes can set.
        const sealed = (sector: number) => ({ ...save(sector, {}), activeRiftQuestSeal: { id: riftId, targetSector: 12, baseline: 0, at: 1, geoV: 99 } });
        const mirrorOnly = (sector: number) => save(sector, { activeRiftQuest: { id: riftId, targetSector: sector, stage: 'travel', baseline: 0, bossName: 'X' } });
        const request = { kind: 'wanderer' as const, sourceId: `w-12-5000-${WANDERER_RIFT_INDEX}`, sector: 12 };
        assert.ok((await buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: sealed(12), now })).context.displayName);
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: save(12, {}), now }), /world-wanderer-not-attackable/);
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request, save: mirrorOnly(12), now }), /world-wanderer-not-attackable/,
            'a forged display mirror cannot summon a rift creature');
        await assert.rejects(buildWorldAiFightSpec({ playerName: 'Roadwalker', request: { ...request, sector: 13, sourceId: `w-13-5000-${WANDERER_RIFT_INDEX}` }, save: sealed(13), now }), /world-wanderer-not-attackable/);
    });
});
