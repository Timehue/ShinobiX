/**
 * Server-authored Story Tower recruit.
 *
 * This is intentionally a novice helper, not a replacement for another player:
 * modest floor-banded vitals, one low-power 100-AP technique, no equipment,
 * items, bloodline, support utility, AOE, or progression owner. The generic AI
 * therefore takes one meaningful action at most after reaching a target and is
 * never settlement-eligible.
 */

import { TOWER_FLOOR_COUNT } from './_floor-catalog.js';

export const GENERIC_TOWER_AI_PROFILE = 'story-recruit-v1' as const;
// `:` is outside safeName's account alphabet, so this ID can never collide with
// or impersonate a real player slug.
export const GENERIC_TOWER_AI_ID = /^tower-ai:([1-3])$/;

const RECRUIT_NAMES = [
    'Tower Recruit I (AI)',
    'Tower Recruit II (AI)',
    'Tower Recruit III (AI)',
] as const;

export function genericTowerAiMemberId(slot: number): string {
    const safeSlot = Math.min(3, Math.max(1, Math.floor(slot)));
    return `tower-ai:${safeSlot}`;
}

export function genericTowerAiDisplayName(memberId: string): string {
    const match = GENERIC_TOWER_AI_ID.exec(memberId);
    const slot = match ? Math.max(1, Math.min(3, Number(match[1]))) : 1;
    return RECRUIT_NAMES[slot - 1]!;
}

export function buildGenericTowerAiCharacter(floorId: number): Record<string, unknown> {
    const floor = Math.max(1, Math.min(TOWER_FLOOR_COUNT, Math.floor(Number(floorId) || 1)));
    const offense = 260 + floor * 18;
    const defense = 220 + floor * 14;
    return {
        level: 30,
        specialty: 'Taijutsu',
        combatRole: 'novice',
        towerGenericAiProfile: GENERIC_TOWER_AI_PROFILE,
        towerRewardEligibility: 'none',
        stats: {
            strength: 120 + floor * 8,
            speed: 100 + floor * 6,
            intelligence: 80,
            willpower: 90,
            taijutsuOffense: offense,
            taijutsuDefense: defense,
            bukijutsuOffense: 120,
            bukijutsuDefense: defense,
            genjutsuOffense: 100,
            genjutsuDefense: defense,
            ninjutsuOffense: 100,
            ninjutsuDefense: defense,
        },
        jutsu: [{
            id: 'tower-recruit-strike',
            name: 'Practice Palm',
            type: 'Taijutsu',
            element: 'None',
            ap: 100,
            range: 2,
            effectPower: 8,
            chakraCost: 0,
            staminaCost: 20,
            cooldown: 1,
            target: 'OPPONENT',
            method: 'SINGLE',
            tags: [],
        }],
        // Level zero intentionally keeps the recruit at the combat resolver's
        // lowest mastery fraction rather than inheriting a real player's build.
        jutsuMastery: [{ jutsuId: 'tower-recruit-strike', level: 0 }],
        bloodlineMult: 1,
        itemDamagePct: 0,
        armorRawDR: 0,
        maxHp: 650 + floor * 85,
        maxChakra: 150,
        maxStamina: 260,
    };
}
