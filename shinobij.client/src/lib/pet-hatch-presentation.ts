import type { Character } from '../types/character';
import type { Screen } from '../types/core';

const EVENT_SCREENS = new Set<Screen>(['dungeon', 'hollowGateShrine', 'hollowGateTiles', 'eventTiles', 'eventPetBattle',
    'tilecardsDuel', 'sectorCard', 'sectorPet', 'clanWarPet', 'clanWar2v2', 'firstPact', 'cardClashFreePlay']);

export function petHatchPresentationBlocked(character: Character, screen: Screen, runtimeBlocked: boolean): boolean {
    if (runtimeBlocked || EVENT_SCREENS.has(screen)) return true;
    if (screen !== 'sunscarFestival') return false;
    const rally = (character.sunscarRally as { current?: { status?: string } } | undefined)?.current;
    const caravan = (character.sunscarCaravan as { current?: { result?: unknown } } | undefined)?.current;
    return Boolean((rally && ['racing', 'between'].includes(rally.status ?? '')) || (caravan && !caravan.result));
}

export function hasBlockingHatchDialog(): boolean {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')]
        .some(dialog => !dialog.closest('[data-pet-hatch-reveal]') && !dialog.closest('[hidden], [aria-hidden="true"]')
            && dialog.getClientRects().length > 0);
}
