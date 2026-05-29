/*
 * Aura Sphere progression — the rank ladder, per-level dust costs, and the
 * passive bonuses granted while an Aura Sphere is equipped.
 *
 * Pure functions depending only on the extracted constant + type modules.
 * Extracted from App.tsx (Region A).
 */

import { AURA_SPHERE_ITEM_ID } from "../constants/game";
import type { Character } from "../types/character";

const auraSphereRanks = [
    "Dormant Aura Stone",
    "Awakened Aura Stone",
    "Radiant Aura Stone",
    "Fighting Spirit Aura Stone",
    "Sage Aura Stone",
    "Mythic Aura Stone",
    "Eternal Aura Stone",
];

export function auraSphereLevel(character: Pick<Character, "auraSphereLevel">) {
    return Math.max(1, Math.floor(character.auraSphereLevel ?? 1));
}

function auraSphereRankIndex(level: number) {
    return Math.min(auraSphereRanks.length - 1, Math.floor(Math.max(1, level) / 50));
}

function auraSphereRankName(level: number) {
    return auraSphereRanks[auraSphereRankIndex(level)];
}

export function auraSphereDustNeeded(level: number) {
    return Math.floor(12 + Math.max(1, level) * 2.5);
}

function getAuraSphereBonuses(character: Pick<Character, "auraSphereLevel">) {
    const level = auraSphereLevel(character);
    return {
        rankName: auraSphereRankName(level),
        regen: level >= 300 ? 5 : level >= 150 ? 2 : level >= 100 ? 2 : level >= 1 ? 1 : 0,
        missionRewardPercent: level >= 100 ? 1 : level >= 50 ? 2 : 0,
        jutsuTrainingSpeedPercent: level >= 250 ? 5 : level >= 150 ? 5 : 0,
        jutsuXpPercent: level >= 250 ? 5 : 0,
        pveDamagePercent: level >= 300 ? 5 : 0,
        avatarAura: level >= 200,
    };
}
export function hasEquippedAuraSphere(character: Pick<Character, "equipment">) {
    return character.equipment?.aura === AURA_SPHERE_ITEM_ID || character.equipment?.accessory === AURA_SPHERE_ITEM_ID;
}
export function getActiveAuraSphereBonuses(character: Pick<Character, "auraSphereLevel" | "equipment">) {
    if (!hasEquippedAuraSphere(character)) {
        return {
            ...getAuraSphereBonuses(character),
            regen: 0,
            missionRewardPercent: 0,
            jutsuTrainingSpeedPercent: 0,
            jutsuXpPercent: 0,
            pveDamagePercent: 0,
            avatarAura: false,
        };
    }
    return getAuraSphereBonuses(character);
}
