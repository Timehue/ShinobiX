import { isPlayerModel, readStarterWorldModel, type PlayerModel } from '../../../shared/player-model-ref';
import { isNpcVillage } from '../../../shared/npc-village';
import { cinderholdCombatantId } from './battlefield-sprite';

type FighterAppearance = { name?: unknown; village?: unknown; avatarImage?: unknown; playerModel?: unknown; starterWorldModel?: unknown };

function cinderholdPortraitId(portrait: unknown): string | undefined {
    const id = typeof portrait === 'string' ? /^\/npc-portraits\/([a-z]+)\.avif(?:[?#]|$)/.exec(portrait)?.[1] : undefined;
    return cinderholdCombatantId(id);
}

function cinderholdFighterId(appearance: FighterAppearance | null | undefined, portrait?: string | null): string | undefined {
    const rosterId = isNpcVillage(appearance?.village) && typeof appearance?.name === 'string'
        ? cinderholdCombatantId(appearance.name.trim().toLowerCase()) : undefined;
    return rosterId ?? cinderholdPortraitId(appearance?.avatarImage) ?? cinderholdPortraitId(portrait);
}

export function bundledFighterSprite(appearance: FighterAppearance | null | undefined, portrait?: string | null): string | null {
    const savedPortrait = typeof appearance?.avatarImage === 'string' ? appearance.avatarImage : '';
    const npcId = cinderholdFighterId(appearance, portrait);
    if (npcId) return `/combat-actors/cinderhold/${npcId}-idle.webp`;
    const starter = readStarterWorldModel(undefined, savedPortrait || portrait)
        ?? readStarterWorldModel(appearance?.starterWorldModel);
    return starter ? `/combat-actors/starters/${starter}-idle.webp` : null;
}

export function generatedFighterModel(appearance: FighterAppearance | null | undefined): PlayerModel | undefined {
    const model = appearance?.playerModel;
    return isPlayerModel(model) && !cinderholdFighterId(appearance) ? model : undefined;
}
