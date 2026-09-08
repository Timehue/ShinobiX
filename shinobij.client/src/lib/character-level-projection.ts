// gainXp — RETIRED XP driver, kept as a derived-level compatibility shim.
// Character XP is removed (docs/leveling-without-xp-map.md): level derives from
// the earned-points ledger (lib/stats levelForEarned/earnedStatPoints), so the
// amount is ignored and this collapses to the RISE-ONLY recompute the server
// runs (api/_xp-engine.ts applyDerivedLevel). Rise-only matters here too: a
// pre-migration save (old XP-era level above its earned-derived level) must
// never de-level locally — the server's one-time migration tops the pool up on
// its next save write. The frozen `xp` field is never touched.
import type { Character } from '../types/character';
import { EXAM_LEVEL_GATES, MAX_LEVEL } from '../constants/game';
import { reconcileCharacterStatBudget, levelForEarned, earnedStatPoints, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel } from './stats';
import { rankTitleForLevel } from './character-progress';

function examLevelCap(character: Character): number { return EXAM_LEVEL_GATES.find((gate) => !(character.examsPassed ?? []).includes(gate.exam))?.level ?? MAX_LEVEL; }

export function gainXp(character: Character, _amount: number): Character {
    const updated: Character = reconcileCharacterStatBudget(character);
    const target = Math.max(1, Math.min(examLevelCap(updated), levelForEarned(earnedStatPoints(updated))));
    if (target <= updated.level) return updated;
    const nextMaxHp = maxHpForLevel(target);
    const nextMaxChakra = maxChakraForLevel(target);
    const nextMaxStamina = maxStaminaForLevel(target);
    return {
        ...updated,
        level: target,
        rankTitle: rankTitleForLevel(updated, target),
        maxHp: nextMaxHp,
        maxChakra: nextMaxChakra,
        maxStamina: nextMaxStamina,
        hp: nextMaxHp,
        chakra: nextMaxChakra,
        stamina: nextMaxStamina,
    };
}
