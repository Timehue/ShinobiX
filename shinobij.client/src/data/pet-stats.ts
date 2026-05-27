/*
 * Pet stat tables — base stats (template starting numbers) and absolute
 * caps (post-training ceiling).
 *
 * Pure data. Consumed by balanceBuiltInPetTemplate + capPetStats in App.tsx
 * to scale every built-in pet template against its rarity tier.
 *
 * Per-stat target mythic-vs-rare gap:
 *   HP +25%   ATK +25%   DEF +26%   SPD +25%   JutsuPower +26%
 * Per-stat target legendary-vs-rare gap:
 *   HP +12%   ATK +13%   DEF +12%   SPD +14%   JutsuPower +13%
 *
 * Standard and rare are entry-level; legendary and mythic stay in line so
 * no single tier dominates the matchup chart.
 *
 * Extracted from App.tsx.
 */

import type { PetRarity } from "../types/pet";

export const balancedPetBaseStats: Record<PetRarity, { hp: number; attack: number; defense: number; speed: number; jutsuPower: number; moveRange: number }> = {
    standard: { hp: 320, attack: 40, defense: 28, speed: 30, jutsuPower: 50, moveRange: 3 },
    rare: { hp: 370, attack: 48, defense: 34, speed: 36, jutsuPower: 62, moveRange: 3 },
    legendary: { hp: 416, attack: 54, defense: 38, speed: 41, jutsuPower: 70, moveRange: 4 },
    mythic: { hp: 462, attack: 60, defense: 43, speed: 45, jutsuPower: 78, moveRange: 4 },
};

export const petStatCaps: Record<PetRarity, { hp: number; attack: number; defense: number; speed: number; jutsuPower: number }> = {
    standard: { hp: 1700, attack: 260, defense: 210, speed: 190, jutsuPower: 320 },
    rare: { hp: 1900, attack: 290, defense: 240, speed: 220, jutsuPower: 360 },
    legendary: { hp: 2140, attack: 326, defense: 270, speed: 247, jutsuPower: 405 },
    mythic: { hp: 2380, attack: 365, defense: 300, speed: 275, jutsuPower: 450 },
};
