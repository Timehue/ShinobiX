import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { OrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter.js';
import type { AiFightProfile } from './_ai-fight-encounter.js';

/** A receipt owns role/name/level; templates supply the legal combat kit. No
 * HP, damage multiplier or client-selected profile is added by difficulty. */
export function ordinaryAiProfile(encounter: OrdinaryPveEncounter): AiFightProfile {
    const template = builtinAiProfile(encounter.profileId);
    if (!template) throw new Error('The sealed exploration template is unavailable.');
    // Preserve the original template's legal role allocation, as the prior
    // generic Explore builder did. Expanded rotations do not add stat budget.
    const profile = relevelAiProfile(structuredClone(template) as unknown as RelevelableProfile, encounter.level, 0, 0,
        resolveAiProfileJutsu(template.jutsuIds)) as AiFightProfile;
    return {
        ...profile,
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
