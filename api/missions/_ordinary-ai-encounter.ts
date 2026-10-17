import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { maxHpForLevel } from '../_xp-engine.js';
import { pveDifficultyHpMultiplier } from '../_pve-difficulty.js';
import type { OrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter.js';
import type { AiFightProfile } from './_ai-fight-encounter.js';

/** A receipt owns role/name/level; templates supply the legal combat kit.
 * Difficulty never adds HP or a damage multiplier. */
export function ordinaryAiProfile(encounter: OrdinaryPveEncounter): AiFightProfile {
    const template = builtinAiProfile(encounter.profileId);
    if (!template) throw new Error('The sealed exploration template is unavailable.');
    // Preserve the original template's legal role allocation, as the prior
    // generic Explore builder did. Expanded rotations do not add stat budget.
    const profile = relevelAiProfile(structuredClone(template) as unknown as RelevelableProfile, encounter.level, 0, 0,
        resolveAiProfileJutsu(template.jutsuIds)) as AiFightProfile;
    return {
        ...profile,
        // Advanced ordinary opponents use the player's level HP curve. The
        // standard encounter builder applies a band multiplier afterward;
        // compensate here so the sealed effective HP is exactly that curve.
        // This adapter never handles authored rivals, patrols or story bosses.
        ...(encounter.level >= 36 ? {
            hp: Math.ceil(maxHpForLevel(encounter.level) / pveDifficultyHpMultiplier(encounter.level)),
            armorRawDR: Math.min(Number(profile.armorRawDR) || 0, encounter.level < 65 ? .25 : .35),
        } : {}),
        id: encounter.profileId,
        name: encounter.displayName,
        pveDifficulty: encounter.difficulty,
        // World profiles may carry a unique instance id. Keep the sealed role
        // template explicit so progressive kit selection uses the same source.
        pveTemplateId: encounter.profileId,
        visual: encounter.portraitImage ?? encounter.portraitKey,
        ...(encounter.portraitImage ? { avatarImage: encounter.portraitImage } : {}),
    };
}
