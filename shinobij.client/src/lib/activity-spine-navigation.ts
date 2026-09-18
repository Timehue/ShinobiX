import type { ActivitySpineItem } from '../../../shared/activity-spine';
import type { Screen } from '../types/core';

export const ACTIVITY_SECTION_EVENT = 'shinobix:activity-section';

// Compile-time checked against the actual router; untrusted response strings
// must also pass this small allowlist before they can reach onNavigate.
const DESTINATIONS = {
    hospital: 'hospital', logbook: 'logbook', clan: 'clan', battleTowers: 'battleTowers',
    hollowGateShrine: 'hollowGateShrine', endlessTower: 'endlessTower', training: 'training',
    profile: 'profile', missions: 'missions', jutsuTraining: 'jutsuTraining', centralHub: 'centralHub',
    storyHall: 'storyHall', arenaDistrict: 'arenaDistrict', pets: 'pets', petShowdown: 'petShowdown',
    petLadder: 'petLadder', shinobiTiles: 'shinobiTiles', hallOfLegends: 'hallOfLegends',
    professions: 'professions', professionPicker: 'professionPicker', worldMap: 'worldMap',
} as const satisfies Record<string, Screen>;

export function activityDestination(value: string): Screen | null {
    return Object.values(DESTINATIONS).find(screen => screen === value) ?? null;
}

export function openActivityDestination(activity: ActivitySpineItem, navigate: (screen: Screen) => void): boolean {
    const screen = activityDestination(activity.screen);
    if (!screen) return false;
    const section = activity.section ?? (activity.context === 'clan-boss' ? 'clan-boss' : undefined);
    const hint = section === 'clan-boss' && screen === 'clan' ? ['clan.initialView', 'boss']
        : section === 'legacy' && screen === 'profile' ? ['profile.initialTab', 'legacy']
        : section === 'stats' && screen === 'profile' ? ['profile.initialTab', 'stats']
        : section === 'card-deck' && screen === 'shinobiTiles' ? ['cardHall.initialTab', 'deck']
        : section === 'card-play' && screen === 'shinobiTiles' ? ['cardHall.initialTab', 'play']
        : section === 'crafter' && screen === 'centralHub' ? ['centralHub.initialPanel', 'crafter'] : null;
    if (section && !hint) return false;
    if (hint) {
        try { sessionStorage.setItem(hint[0], hint[1]); } catch { return false; }
        // Initial hints cover a newly mounted destination; this notification
        // also handles a briefing opened over a destination already on screen.
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ACTIVITY_SECTION_EVENT, {
            detail: { key: hint[0], section: hint[1] },
        }));
    }
    navigate(screen);
    return true;
}

export function readActivitySection<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    try {
        const hint = sessionStorage.getItem(key);
        return allowed.find(value => value === hint) ?? fallback;
    } catch { return fallback; }
}
