import { isPlayerModel, readStarterWorldModel, type PlayerModel } from '../../../shared/player-model-ref';

type FighterAppearance = { avatarImage?: unknown; playerModel?: unknown; starterWorldModel?: unknown };

function cinderholdPortraitId(portrait: unknown): string | undefined {
    return typeof portrait === 'string' ? /^\/npc-portraits\/([a-z]+)\.avif(?:[?#]|$)/.exec(portrait)?.[1] : undefined;
}

export function bundledFighterSprite(appearance: FighterAppearance | null | undefined, portrait?: string | null): string | null {
    const savedPortrait = typeof appearance?.avatarImage === 'string' ? appearance.avatarImage : '';
    const npcId = cinderholdPortraitId(savedPortrait) ?? cinderholdPortraitId(portrait);
    if (npcId) return `/combat-actors/cinderhold/${npcId}-idle.webp`;
    const starter = readStarterWorldModel(undefined, savedPortrait || portrait)
        ?? readStarterWorldModel(appearance?.starterWorldModel);
    return starter ? `/combat-actors/starters/${starter}-idle.webp` : null;
}

export function generatedFighterModel(appearance: FighterAppearance | null | undefined): PlayerModel | undefined {
    const model = appearance?.playerModel;
    return isPlayerModel(model) && !cinderholdPortraitId(appearance?.avatarImage) ? model : undefined;
}
