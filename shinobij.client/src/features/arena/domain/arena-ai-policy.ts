import { aiPrimaryJutsuType } from "../../../lib/ai-stats";
import { isControlJutsu, isPressureJutsu, isSelfSupportJutsu } from "../../../lib/jutsu";
import {
    pveEasyBandAllowsLethal,
    pveEasyBandHoldsBurst,
    pveIsBurstJutsuAp,
} from "../../../lib/pve-difficulty";
import { statusMatchesName } from "../../../lib/tags";
import type { Jutsu } from "../../../types/combat";
import type { JutsuElement } from "../../../types/core";
import type { AiRule } from "../../../types/creator-ai";
import type { ArenaCombatStatus } from "../types";

export type ArenaAiRuleSnapshot = {
    distanceToPlayer: number;
    turn: number;
    enemyHp: number;
    enemyMaxHp: number;
    playerHp: number;
    playerMaxHp: number;
    playerShield: number;
    playerAp: number;
    activePlayerStatuses: readonly ArenaCombatStatus[];
    activeEnemyStatuses: readonly ArenaCombatStatus[];
};

export type ArenaAiPolicySnapshot = {
    allJutsus: Jutsu[];
    enemyAiJutsus: Jutsu[];
    opponentLevel: number;
    usesSmartScorer: boolean;
    enemyChakra: number;
    enemyStamina: number;
    enemyJutsuCooldowns: Readonly<Record<string, number>>;
    availableAp: number;
    distanceToPlayer: number;
    turn: number;
    isStandardPve: boolean;
    enemyHp: number;
    enemyMaxHp: number;
    playerHp: number;
    playerMaxHp: number;
    playerShield: number;
    playerAp: number;
    playerArmorFactor: number;
    playerStatuses: readonly ArenaCombatStatus[];
    enemyStatuses: readonly ArenaCombatStatus[];
    combatResourcesV2: boolean;
    estimateDamage: (jutsu: Jutsu) => number;
};

type ArenaAiPoolSnapshot = Pick<
    ArenaAiPolicySnapshot,
    "allJutsus" | "enemyAiJutsus" | "opponentLevel" | "enemyChakra" | "enemyStamina"
>;

export function matchesArenaAiRule(rule: AiRule, snapshot: ArenaAiRuleSnapshot): boolean {
    if (rule.condition === "always") return true;
    if (rule.condition === "specific_round") return snapshot.turn === rule.value;
    if (rule.condition === "distance_lower_than") return snapshot.distanceToPlayer < rule.value;
    if (rule.condition === "distance_higher_than") return snapshot.distanceToPlayer > rule.value;
    if (rule.condition === "hp_lower_than") return (snapshot.enemyHp / snapshot.enemyMaxHp) * 100 < rule.value;
    if (rule.condition === "player_hp_lower_than") return (snapshot.playerHp / Math.max(1, snapshot.playerMaxHp)) * 100 < rule.value;
    if (rule.condition === "player_has_shield") return snapshot.playerShield > 0;
    if (rule.condition === "player_has_buff") {
        return snapshot.activePlayerStatuses.filter((status) => status.kind === "positive").length >= Math.max(1, rule.value);
    }
    if (rule.condition === "player_low_ap") return snapshot.playerAp < (rule.value || 50);
    if (rule.condition === "self_has_debuff") {
        return snapshot.activeEnemyStatuses.filter((status) => status.kind === "negative").length >= Math.max(1, rule.value);
    }
    return false;
}

export function arenaActivePlayerDotDamage(
    playerStatuses: readonly ArenaCombatStatus[],
    playerMaxHp: number,
    combatResourcesV2: boolean,
): number {
    let dot = 0;
    for (const status of playerStatuses) {
        if (status.name === "Wound") dot += status.amount || 0;
        if (status.name === "Drain") dot += status.amount ?? 50;
        if (status.name === "Poison" && !combatResourcesV2) {
            dot += status.amount ?? Math.floor(playerMaxHp * (status.percent ?? 6) / 100);
        }
    }
    return dot;
}

export function buildArenaSmartJutsuPool(snapshot: ArenaAiPoolSnapshot): Jutsu[] {
    const level = snapshot.opponentLevel ?? 1;
    const apCap = level >= 80 ? 100 : level >= 50 ? 80 : 60;
    const primaryType = aiPrimaryJutsuType(snapshot.enemyAiJutsus);
    const primaryElements = new Set<JutsuElement>();
    for (const jutsu of snapshot.enemyAiJutsus) {
        if (jutsu.element && jutsu.element !== "None") primaryElements.add(jutsu.element);
    }

    const fromPool = snapshot.allJutsus.filter((jutsu) => {
        if (jutsu.bloodlineRank) return false;
        if (jutsu.ap > apCap) return false;
        if (jutsu.chakraCost > snapshot.enemyChakra) return false;
        if (jutsu.staminaCost > snapshot.enemyStamina) return false;
        if (primaryType && jutsu.type !== "Any" && jutsu.type !== primaryType && jutsu.tags.length === 0) return false;
        if (
            primaryElements.size > 0
            && jutsu.element
            && jutsu.element !== "None"
            && !primaryElements.has(jutsu.element)
        ) return false;
        return true;
    });

    const merged = new Map<string, Jutsu>();
    for (const jutsu of fromPool) merged.set(jutsu.id, jutsu);
    for (const jutsu of snapshot.enemyAiJutsus) merged.set(jutsu.id, jutsu);
    return Array.from(merged.values());
}

function applyEasyBurstHold(jutsus: Jutsu[], snapshot: ArenaAiPolicySnapshot): Jutsu[] {
    const holdsBurst = snapshot.isStandardPve
        && pveEasyBandHoldsBurst(snapshot.opponentLevel, snapshot.turn);
    return holdsBurst ? jutsus.filter((jutsu) => !pveIsBurstJutsuAp(jutsu.ap)) : jutsus;
}

function smartArenaAiJutsuPick(snapshot: ArenaAiPolicySnapshot): Jutsu | undefined {
    const expanded = buildArenaSmartJutsuPool(snapshot);
    const usable = applyEasyBurstHold(
        expanded
            .filter((jutsu) => jutsu.ap <= snapshot.availableAp)
            .filter((jutsu) => (snapshot.enemyJutsuCooldowns[jutsu.id] ?? 0) <= 0)
            .filter((jutsu) => jutsu.target === "SELF" || jutsu.range <= 0 || snapshot.distanceToPlayer <= jutsu.range),
        snapshot,
    );

    const allowLethal = !snapshot.isStandardPve
        || pveEasyBandAllowsLethal(
            snapshot.opponentLevel,
            snapshot.playerHp / Math.max(1, snapshot.playerMaxHp),
        );
    const dotThisTurn = arenaActivePlayerDotDamage(
        snapshot.playerStatuses,
        snapshot.playerMaxHp,
        snapshot.combatResourcesV2,
    );
    const requiredKo = Math.max(0, snapshot.playerHp + snapshot.playerShield - dotThisTurn);
    let bestLethal: { jutsu: Jutsu; ap: number } | null = null;
    for (const jutsu of usable) {
        const damage = snapshot.estimateDamage(jutsu);
        if (damage >= requiredKo && damage > 0) {
            if (!bestLethal || jutsu.ap < bestLethal.ap) bestLethal = { jutsu, ap: jutsu.ap };
        }
    }
    if (allowLethal && bestLethal) return bestLethal.jutsu;

    const hpPct = snapshot.enemyHp / Math.max(1, snapshot.enemyMaxHp);
    if (hpPct < 0.40) {
        const healish = usable.find((jutsu) => isSelfSupportJutsu(jutsu));
        if (healish) return healish;
    }

    const playerMaxHp = Math.max(1, snapshot.playerMaxHp);
    const playerStunned = snapshot.playerStatuses.some((status) => status.name === "Stun");
    const playerSealed = snapshot.playerStatuses.some((status) => status.name === "Bloodline Seal" || status.name === "Seal" || status.name === "Elemental Seal");
    const playerPoisoned = snapshot.playerStatuses.some((status) => status.name === "Poison");
    const playerWounded = snapshot.playerStatuses.some((status) => status.name === "Wound");
    const playerDrained = snapshot.playerStatuses.some((status) => status.name === "Drain");
    const playerDmgUp = snapshot.playerStatuses.some((status) => status.name === "Increase Damage Taken" || status.name === "Ignition");
    const playerDmgDown = snapshot.playerStatuses.some((status) => status.name === "Decrease Damage Taken");
    const playerLowAp = snapshot.playerAp < 50;

    const selfIdgStacks = snapshot.enemyStatuses.filter((status) => status.name === "Increase Damage Given").length;
    const playerIdtStacks = snapshot.playerStatuses.filter((status) => status.name === "Increase Damage Taken").length;
    const playerIgnStacks = snapshot.playerStatuses.filter((status) => status.name === "Ignition" || statusMatchesName(status, "Ignition")).length;
    const selfDdtStacks = snapshot.enemyStatuses.filter((status) => status.name === "Decrease Damage Taken").length;
    const playerDdgStacks = snapshot.playerStatuses.filter((status) => status.name === "Decrease Damage Given").length;

    const playerHeavyArmor = snapshot.playerArmorFactor < 0.55;
    const playerShielded = snapshot.playerShield > 0;

    return usable.sort((a, b) => {
        const tacticalScore = (jutsu: Jutsu) => {
            let score = jutsu.effectPower;
            const damage = snapshot.estimateDamage(jutsu);

            if (isSelfSupportJutsu(jutsu) && hpPct > 0.70) score -= 50;
            else if (isSelfSupportJutsu(jutsu) && hpPct < 0.50) score += 15;

            if (isControlJutsu(jutsu)) score += 12;
            if (isPressureJutsu(jutsu)) score += 8;

            const tagNames = jutsu.tags.map((tag) => tag.name);
            if (playerStunned && tagNames.includes("Stun")) score -= 40;
            if (playerSealed && (tagNames.includes("Bloodline Seal") || tagNames.includes("Seal") || tagNames.includes("Elemental Seal"))) score -= 30;
            if (playerPoisoned && tagNames.includes("Poison")) score -= 25;
            if (playerWounded && tagNames.includes("Wound")) score -= 25;
            if (playerDrained && tagNames.includes("Drain")) score -= 25;
            if (playerLowAp && tagNames.includes("Lag")) score -= 20;

            if (tagNames.includes("Increase Damage Given")) {
                score += selfIdgStacks === 0 ? 14 : selfIdgStacks === 1 ? -2 : -25;
            }
            if (tagNames.includes("Increase Damage Taken")) {
                score += playerIdtStacks === 0 ? 12 : playerIdtStacks === 1 ? -2 : -25;
            }
            if (tagNames.includes("Ignition")) {
                score += playerIgnStacks === 0 ? 12 : playerIgnStacks === 1 ? -2 : -25;
            }
            if (tagNames.includes("Decrease Damage Taken")) {
                score += selfDdtStacks === 0 ? 10 : selfDdtStacks === 1 ? -2 : -20;
            }
            if (tagNames.includes("Decrease Damage Given")) {
                score += playerDdgStacks === 0 ? 10 : playerDdgStacks === 1 ? -2 : -20;
            }

            if (tagNames.includes("Pierce")) {
                if (playerHeavyArmor) score += 25;
                if (playerShielded) score += 30;
            }

            if (tagNames.includes("Mirror")) {
                const selfNegStacks = snapshot.enemyStatuses.filter((status) => (
                    status.kind === "negative"
                    && status.name !== "Wound"
                    && status.name !== "Poison"
                    && status.name !== "Drain"
                    && !statusMatchesName(status, "Ignition")
                )).length;
                score += selfNegStacks >= 2 ? 22 : selfNegStacks === 1 ? 6 : -15;
            }

            if (playerDmgUp && damage > 0) score += 8;
            if (playerDmgDown && damage > 0) score -= 10;
            if (playerStunned && damage > 0 && jutsu.ap >= 50) score += 12;
            if (damage > 0) score += (damage / Math.max(1, jutsu.ap)) * 1.5;

            if (jutsu.ap >= 60) {
                if (damage / playerMaxHp >= 0.35) score += 10;
                else score -= 20;
            }
            return score;
        };
        return tacticalScore(b) - tacticalScore(a) || b.ap - a.ap;
    })[0];
}

export function pickArenaAiJutsu(snapshot: ArenaAiPolicySnapshot): Jutsu | undefined {
    if (snapshot.usesSmartScorer) return smartArenaAiJutsuPick(snapshot);
    return applyEasyBurstHold(
        [...snapshot.enemyAiJutsus]
            .filter((jutsu) => jutsu.ap <= snapshot.availableAp)
            .filter((jutsu) => (snapshot.enemyJutsuCooldowns[jutsu.id] ?? 0) <= 0)
            .filter((jutsu) => jutsu.target === "SELF" || jutsu.range <= 0 || snapshot.distanceToPlayer <= jutsu.range),
        snapshot,
    ).sort((a, b) => {
        const tacticalScore = (jutsu: Jutsu) => {
            let score = jutsu.effectPower;
            if (isSelfSupportJutsu(jutsu) && snapshot.enemyHp / snapshot.enemyMaxHp > 0.65) score -= 45;
            if (isControlJutsu(jutsu)) score += 8;
            if (isPressureJutsu(jutsu)) score += 6;
            return score;
        };
        return tacticalScore(b) - tacticalScore(a) || b.ap - a.ap;
    })[0];
}
