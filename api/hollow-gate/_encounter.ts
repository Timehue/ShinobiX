import { aiHpForLevel, aiRawDamageReductionForLevel, aiStatsForLevel } from '../_ai-level-curves.js';
import { maxChakraForLevel, maxStaminaForLevel } from '../_xp-engine.js';
import type { AdminCombatContent } from '../_admin-content.js';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../solo-pve/_ai-encounter.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { hollowGateHoundName } from '../../shared/hollow-gate-contract.js';
import { AUGMENT_CATALOG, type HollowGateRunToken } from './_run-token.js';
import type { HollowGateCombatBinding, HollowGateCombatKind } from './_combat-session.js';

const LOADOUTS: Record<'burst' | 'bruiser' | 'hunter' | 'boss', string[]> = {
    burst: ['starter-tai-water-2', 'starter-nin-lightning-2', 'starter-buki-fire-2', 'starter-tai-fire-2', 'starter-tai-earth-1', 'starter-universal-flicker'],
    bruiser: ['starter-tai-earth-2', 'starter-tai-fire-2', 'starter-tai-wind-2', 'starter-tai-lightning-2', 'starter-tai-earth-1', 'starter-tai-water-3', 'starter-universal-flicker'],
    hunter: ['starter-buki-wind-2', 'starter-nin-lightning-2', 'starter-tai-fire-2', 'starter-nin-earth-2', 'starter-buki-water-1', 'starter-universal-flicker'],
    boss: ['starter-gen-lightning-2', 'starter-nin-fire-2', 'starter-buki-water-2', 'starter-tai-lightning-2', 'starter-nin-earth-1', 'starter-gen-fire-1', 'starter-universal-flicker'],
};

function augmentEffects(run: HollowGateRunToken) {
    const augment = run.chosenAugmentId ? AUGMENT_CATALOG[run.chosenAugmentId] : undefined;
    const value = Math.max(0, Number(augment?.combat?.value ?? 0));
    switch (augment?.id) {
        case 'greedy-pact': return { enemyHpMult: 1 + value, enemyStatMult: 1 + value, enemyHpShavePct: 0, noRetreat: false };
        case 'keen-edge': return { enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: Math.min(0.9, value / (1 + value)), noRetreat: false };
        case 'warded-step': return { enemyHpMult: 1, enemyStatMult: Math.max(0.5, 1 - value), enemyHpShavePct: 0, noRetreat: false };
        case 'chain-reaction': return { enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: value > 0 ? 0.15 : 0, noRetreat: false };
        case 'berserkers-gamble': return { enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: Math.min(0.9, value), noRetreat: true };
        default: return { enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: 0, noRetreat: false };
    }
}

function bossScaling(floor: number, maxFloor: number): { levelOffset: number; hpMult: number } {
    const progress = maxFloor <= 1 ? 1 : Math.min(1, Math.max(0, (floor - 1) / (maxFloor - 1)));
    return { levelOffset: Math.round(-5 + 20 * progress), hpMult: 1 + 0.4 * progress };
}

export function buildHollowGateProfile(params: {
    binding: HollowGateCombatBinding;
    run: HollowGateRunToken;
    playerLevel: number;
}): SoloPveAiProfile {
    const { binding, run } = params;
    const kind: HollowGateCombatKind = binding.kind;
    const boss = kind === 'boss', elite = kind === 'elite', ambush = kind === 'ambush', beast = kind === 'beast';
    const scale = bossScaling(binding.floor, run.floorDepth);
    const level = Math.max(1, Math.min(100, Math.floor(params.playerLevel) + (boss ? scale.levelOffset : 0)));
    const depth = Math.max(0, binding.floor - 1);
    const augment = augmentEffects(run);
    const gentle = String(run.variantId ?? '').startsWith('rift-') && !boss ? 0.9 : 1;
    const kindHpMult = elite ? 1.3 : ambush ? 1.08 : beast ? 1.15 : 1;
    const kindStatMult = elite ? 1.1 : ambush ? 1.04 : beast ? 1.06 : 1;
    const statMult = (boss ? 1.18 : 1 + depth * 0.035) * kindStatMult * augment.enemyStatMult * gentle;
    const stats = Object.fromEntries(Object.entries(aiStatsForLevel(level)).map(([key, value]) => [key, Math.max(1, Math.round(value * statMult))]));
    const baseHp = aiHpForLevel(level, boss ? 0.18 : elite ? 0.1 : 0.04);
    const hp = Math.max(1, Math.floor(baseHp * (boss ? scale.hpMult : 1 + depth * 0.06) * kindHpMult * augment.enemyHpMult * gentle * (1 - augment.enemyHpShavePct)));
    const loadoutId = boss ? 'boss' : elite ? 'bruiser' : ambush ? 'burst' : 'hunter';
    return {
        id: binding.enemyProfileId,
        name: boss ? (run.bossName || hollowGateHoundName(binding.floor, kind)) : hollowGateHoundName(binding.floor, kind),
        visual: 'hollow-hound',
        level,
        hp,
        chakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level),
        stats,
        armorRawDR: aiRawDamageReductionForLevel(level, boss ? 0.16 : elite ? 0.08 : 0.02),
        loadoutId,
        jutsuIds: LOADOUTS[loadoutId],
        isBossAi: boss,
        masterAi: boss || elite,
        hpFloorExempt: true,
    };
}

export function buildHollowGateSoloPveEncounter(params: {
    binding: HollowGateCombatBinding;
    run: HollowGateRunToken;
    save: Record<string, unknown>;
    now: number;
    admin: AdminCombatContent | null;
}): SoloPveSession {
    const character = params.save.character as Record<string, unknown>;
    const augment = augmentEffects(params.run);
    return buildSoloPveAiEncounter({
        sessionId: params.binding.runId,
        playerName: params.binding.playerName,
        save: params.save,
        profile: buildHollowGateProfile({ binding: params.binding, run: params.run, playerLevel: Math.max(1, Math.floor(Number(character.level) || 1)) }),
        now: params.now,
        admin: params.admin,
        difficultyMode: 'AI_FIGHT',
        encounter: {
            kind: 'hollow-gate',
            id: `${params.run.seed}:${params.binding.floor}:${params.binding.nodeId}:${params.binding.kind}`,
            sourceId: params.binding.enemyProfileId,
            bindingId: params.binding.runId,
            metadata: {
                floor: params.binding.floor,
                nodeId: params.binding.nodeId,
                combatKind: params.binding.kind,
                augmentId: params.run.chosenAugmentId ?? 'none',
                noRetreat: augment.noRetreat,
            },
        },
        environment: { biome: 'shadow' },
    });
}
