import type { CreatorAi } from "../types/creator-ai";
import type { Character, HollowGateShrineRun } from "../types/character";
import {
    aiArmorFactorFromRaw,
    aiHpForLevel,
    aiRawDamageReductionForLevel,
    aiStatsForLevel,
} from "./ai-stats";
import { maxChakraForLevel, maxStaminaForLevel } from "./stats";
import { hollowGateHoundName } from "../../../shared/hollow-gate-contract";
import { hollowGateAugmentEffects } from "./hollow-gate-server";
import { hollowGateBossDisplayName, hollowGateBossScaling, hollowGateRunMaxFloor } from "./hollow-gate-variant";
import { aiJutsuLoadout, buildBasicCombatAiRules } from "./combat-ai";
import type { HollowGateCombatKind, HollowGateCombatSettleResult } from "./hollow-gate-combat-api";

export type HollowGatePveFightRef = {
    runId: string;
    nodeId: string;
    floor: number;
    kind: HollowGateCombatKind;
};

/**
 * Recover the run-bound fight pointer stored inside the generic Arena story
 * context. App uses this after a refresh so the Arena result can still settle
 * the exact Gate encounter and mark its shrine tile when the player continues.
 */
export function hollowGatePveFightFromStoryContext(value: unknown): HollowGatePveFightRef | null {
    if (!value || typeof value !== "object") return null;
    const battle = value as Record<string, unknown>;
    if (battle.kind !== "hollowGateShrine") return null;
    const runId = typeof battle.runId === "string" ? battle.runId : "";
    const nodeId = typeof battle.nodeId === "string" ? battle.nodeId : "";
    const floor = Math.floor(Number(battle.floor));
    const kind = battle.combatKind;
    const validKind = kind === "battle" || kind === "elite" || kind === "ambush" || kind === "beast" || kind === "boss";
    if (!runId || !nodeId || !Number.isFinite(floor) || floor < 1 || !validKind) return null;
    return { runId, nodeId, floor, kind };
}

export function buildHollowGatePveEncounter(params: {
    fight: HollowGatePveFightRef;
    character: Character;
    run: HollowGateShrineRun | null;
    petAssisted: boolean;
    image?: string;
}): {
    ai: CreatorAi;
    encounterName: string;
    petAssistName?: string;
    isBoss: boolean;
    isAmbush: boolean;
    canWithdraw: boolean;
} {
    const { fight, character, run } = params;
    const isBoss = fight.kind === "boss";
    const isElite = fight.kind === "elite";
    const isAmbush = fight.kind === "ambush";
    const isBeast = fight.kind === "beast";
    const bossScale = hollowGateBossScaling(fight.floor, hollowGateRunMaxFloor(run));
    const level = Math.max(1, Math.min(100, character.level + (isBoss ? bossScale.levelOffset : 0)));
    const depth = Math.max(0, fight.floor - 1);
    const aug = hollowGateAugmentEffects(run);
    const gentle = Boolean(run?.variant?.id?.startsWith("rift-")) && !isBoss ? 0.90 : 1;
    const kindHpMult = isElite ? 1.3 : isAmbush ? 1.08 : isBeast ? 1.15 : 1;
    const kindStatMult = isElite ? 1.1 : isAmbush ? 1.04 : isBeast ? 1.06 : 1;
    const totalHpShave = Math.min(0.9, aug.enemyHpShavePct);
    const statMult = (isBoss ? 1.18 : 1 + depth * 0.035) * kindStatMult * aug.enemyStatMult * gentle;
    const stats = Object.fromEntries(
        Object.entries(aiStatsForLevel(level)).map(([key, value]) => [key, Math.max(1, Math.round(Number(value) * statMult))]),
    ) as CreatorAi["stats"];
    const baseHp = aiHpForLevel(level, isBoss ? 0.18 : isElite ? 0.10 : 0.04);
    const floorHpMult = isBoss ? bossScale.hpMult : 1 + depth * 0.06;
    const hp = Math.max(1, Math.floor(baseHp * floorHpMult * kindHpMult * aug.enemyHpMult * gentle * (1 - totalHpShave)));
    const armorRawDR = aiRawDamageReductionForLevel(level, isBoss ? 0.16 : isElite ? 0.08 : 0.02);
    const encounterName = isBoss
        ? hollowGateBossDisplayName(run)
        : hollowGateHoundName(fight.floor, fight.kind);
    const loadoutId = isBoss ? "boss" : isElite ? "bruiser" : isAmbush ? "burst" : "hunter";
    const houndJutsus = aiJutsuLoadout(loadoutId);
    const ai: CreatorAi = {
        id: `hollow-hound-${fight.kind}-${fight.runId}`,
        name: encounterName,
        icon: "🐺",
        image: params.image || "/hollow-gate/hollow-hound-idle.webp",
        level,
        village: "Hollow Gate",
        hp,
        chakra: maxChakraForLevel(level),
        stamina: maxStaminaForLevel(level),
        stats,
        armorRawDR,
        armorFactor: aiArmorFactorFromRaw(armorRawDR),
        loadoutId,
        jutsuIds: houndJutsus.map((jutsu) => jutsu.id),
        rules: buildBasicCombatAiRules(houndJutsus, loadoutId),
        isBossAi: isBoss,
        masterAi: isBoss || isElite,
        hpFloorExempt: true,
    };
    return {
        ai,
        encounterName,
        isBoss,
        isAmbush,
        canWithdraw: !aug.noRetreat,
    };
}

export function formatHollowGateCombatReward(result: HollowGateCombatSettleResult): string {
    const reward = result.reward ?? {};
    return [
        reward.xp ? `+${reward.xp} XP` : "",
        reward.ryo ? `+${reward.ryo} ryo` : "",
        reward.auraDust ? `+${reward.auraDust} Aura Dust` : "",
        reward.honorSeals ? `+${reward.honorSeals} Honor Seals` : "",
        reward.boneCharms ? `+${reward.boneCharms} Bone Charms` : "",
        reward.fateShards ? `+${reward.fateShards} Fate Shards` : "",
        reward.hollowShards ? `+${reward.hollowShards} Hollow Shards` : "",
        reward.fragments ? `+${reward.fragments} Legendary Fragment` : "",
        reward.veils ? `+${reward.veils} Veil of the Hollow` : "",
        result.elementalShards ? `+${result.elementalShards} Elemental Shard` : "",
    ].filter(Boolean).join(", ");
}
