import { isPlayerModel, readStarterWorldModel, type PlayerModel } from '../../../shared/player-model-ref';
import { cinderholdBattleModels } from './cinderhold-battle-models';
import { isNpcVillage } from '../../../shared/npc-village';
import { cinderholdCombatantId } from './battlefield-sprite';

type FighterAppearance = { name?: unknown; village?: unknown; avatarImage?: unknown; playerModel?: unknown; starterWorldModel?: unknown };

function cinderholdPortraitId(portrait: unknown): string | undefined {
    const id = typeof portrait === 'string' ? /^\/npc-portraits\/([a-z]+)\.avif(?:[?#]|$)/.exec(portrait)?.[1] : undefined;
    return cinderholdCombatantId(id);
}

/** Only a roster identity or its exact owned model revision identifies an authored fighter. */
function rosterFighterId(appearance: FighterAppearance | null | undefined): string | undefined {
    const model = appearance?.playerModel;
    const rosterId = isNpcVillage(appearance?.village) && typeof appearance?.name === 'string'
        ? cinderholdCombatantId(appearance.name.trim().toLowerCase()) : undefined;
    return rosterId ?? (isPlayerModel(model) ? cinderholdBattleModels[model.assetId + model.version] : undefined);
}

export function bundledFighterSprite(appearance: FighterAppearance | null | undefined, portrait?: string | null): string | null {
    const rosterId = rosterFighterId(appearance);
    if (rosterId) return `/combat-actors/cinderhold/${rosterId}-idle.webp`;
    const starter = readStarterWorldModel(appearance?.starterWorldModel, appearance?.avatarImage)
        ?? readStarterWorldModel(undefined, portrait);
    if (starter) return `/combat-actors/starters/${starter}-idle.webp`;
    const legacyId = cinderholdPortraitId(appearance?.avatarImage) ?? cinderholdPortraitId(portrait);
    return legacyId ? `/combat-actors/cinderhold/${legacyId}-idle.webp` : null;
}

export const DEFAULT_PLAYER_BATTLE_SPRITE = '/combat-actors/starters/starter-one-idle.webp';

export function playerBattleFallback(appearance: FighterAppearance | null | undefined, portrait?: string | null): string {
    return bundledFighterSprite(appearance, portrait) ?? DEFAULT_PLAYER_BATTLE_SPRITE;
}

export function generatedFighterModel(appearance: FighterAppearance | null | undefined): PlayerModel | undefined {
    const model = appearance?.playerModel;
    return isPlayerModel(model) && !rosterFighterId(appearance) ? model : undefined;
}
