import type { Character } from '../types/character';
import type { Screen } from '../types/core';
import type { FirstContractRoute } from '../../../shared/first-contract';
import { FIRST_CONTRACT_COPY, firstContractPreparation } from './first-contract';
import { requestFirstContractLoadout } from './first-contract-loadout-navigation';

// Ephemeral, per-player navigation intent. It is not progression or save data.
// A snapshot also reaches a lazily mounted or Activity-suspended Mission Hall.
const missionRequests = new Map<string, number>();
const handledRequests = new Map<string, number>();
const listeners = new Set<() => void>();
export function firstContractMissionRequest(name: string): number {
    return missionRequests.get(name.toLowerCase()) ?? 0;
}
export function subscribeFirstContractMissions(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function hasFirstContractMissionRequest(name: string): boolean {
    return firstContractMissionRequest(name) > (handledRequests.get(name.toLowerCase()) ?? 0);
}
export function acknowledgeFirstContractMissionRequest(name: string, request: number): void {
    handledRequests.set(name.toLowerCase(), Math.max(handledRequests.get(name.toLowerCase()) ?? 0, request));
}
export function openFirstContractActivity(character: Character, route: FirstContractRoute, navigate: (screen: Screen) => void): void {
    const destination = firstContractPreparation(character, route)?.screen ?? FIRST_CONTRACT_COPY[route].screen;
    if (destination === 'profile') requestFirstContractLoadout(character.name);
    if (destination === 'missions') {
        missionRequests.set(character.name.toLowerCase(), firstContractMissionRequest(character.name) + 1);
        listeners.forEach((listener) => listener());
    }
    navigate(destination);
}
