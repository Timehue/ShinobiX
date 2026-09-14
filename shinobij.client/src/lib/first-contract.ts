import { readFirstContract, type FirstContractRoute } from '../../../shared/first-contract';
import type { Character } from '../types/character';
import type { Screen } from '../types/core';

export const FIRST_CONTRACT_COPY = {
    combat: { title: 'Prove your technique', label: 'Combat', line: 'Take the E-Rank Drill on your own, then collect its reward.', why: 'Put your loadout to work and learn the repeatable fight-and-claim loop.', screen: 'missions', action: 'Open Mission Hall', success: 'You won a combat assignment and collected its reward.', next: 'Take another contract' },
    discovery: { title: 'Beyond the village gate', label: 'Discovery', line: 'Travel to a numbered sector and explore one field tile.', why: 'Learn your surroundings and discover what the road holds. Encounters can lead to combat; recover before you leave.', screen: 'worldMap', action: 'Open World Map', success: 'You explored a field tile beyond the village.', next: 'Explore another trail' },
    companion: { title: 'A moment for your companion', label: 'Companion', line: 'Visit your companion in the Pet Yard and give it some attention.', why: 'Use the free Pet interaction, or an owned treat, to care for the companion travelling with you.', screen: 'pets', action: 'Visit Pet Yard', success: 'You took time to care for one of your companions.', next: 'Visit your companion' },
} satisfies Record<FirstContractRoute, { title: string; label: string; line: string; why: string; screen: Screen; action: string; success: string; next: string }>;

export const FIRST_CONTRACT_OPEN = 'shinobi:first-contract-open';
// The desktop rail that asks for the journal and the FirstContractHost that
// opens it load as separate lazy chunks, so a click can arrive before the host
// is listening. The request therefore waits for a host to claim it, either from
// the event or when the host mounts. A claim is single-use, and an unclaimed
// request expires quickly, so an old click cannot open the journal later.
export const FIRST_CONTRACT_OPEN_WINDOW_MS = 5_000;
let openRequestedAt: number | null = null;
export function openFirstContract() {
    openRequestedAt = performance.now();
    window.dispatchEvent(new Event(FIRST_CONTRACT_OPEN));
}
export function claimFirstContractOpen(now = performance.now()): boolean {
    const requestedAt = openRequestedAt;
    openRequestedAt = null;
    return requestedAt !== null && now - requestedAt <= FIRST_CONTRACT_OPEN_WINDOW_MS;
}
export function firstContractVisible(character: Pick<Character, 'firstContract' | 'onboardingStep'>): boolean {
    const state = readFirstContract(character.firstContract);
    return character.onboardingStep === 'done' && Boolean(state && !state.acknowledgedAt);
}
export function firstContractPreparation(character: Character, route: FirstContractRoute): { label: string; detail: string; screen: Screen } | null {
    if ((route === 'combat' || route === 'discovery') && (character.hospitalized || character.hp <= 0))
        return { label: 'Recover at the Hospital', detail: 'Get back on your feet before heading out. Free checkout becomes available after the recovery timer.', screen: 'hospital' };
    if (route === 'combat' && character.equippedJutsuIds.length === 0 && !character.jutsuMastery.some((entry) => entry.level >= 1))
        return { label: 'Learn your first jutsu', detail: 'Learn a jutsu at the Jutsu Hall, then equip it in your Profile before taking the drill.', screen: 'jutsuTraining' };
    if (route === 'combat' && character.equippedJutsuIds.length === 0)
        return { label: 'Prepare your loadout', detail: 'Open Jutsu → Learned Jutsu and tap + on a technique to equip it before taking the drill.', screen: 'profile' };
    if (route === 'companion' && !character.pets.length)
        return { label: 'Open your field journal', detail: 'Choose Combat or Discovery while you find a companion.', screen: 'village' };
    return null;
}
