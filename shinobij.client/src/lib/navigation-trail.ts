import type { Screen } from '../types/core';
import { DEEP_LINKABLE_SCREENS, RESTORABLE_SCREENS } from './screen-guards';

// A reload may resume a sealed encounter; Back must never start that encounter
// again. Only independently usable panels and lobbies belong in the trail.
export const RETURN_SCREENS: ReadonlySet<Screen> = new Set([
    ...DEEP_LINKABLE_SCREENS,
    'arena', 'battleArena', 'arenaDistrict', 'userHub', 'battleTowers',
    'petArena', 'petShowdown', 'petColiseum', 'weeklyBoss', 'endlessTower', 'firstPact',
]);
export interface NavigationTrail { screen: Screen; trail: Screen[] }
const keyFor = (account: string) => `navigation.v1:${account.trim().toLowerCase()}`;

export function visitScreen(trail: readonly Screen[], screen: Screen): Screen[] {
    if (screen === 'start' || screen === 'professionPicker') return [];
    if (!RETURN_SCREENS.has(screen)) return [...trail];
    const index = trail.lastIndexOf(screen);
    return index < 0 ? [...trail.slice(-19), screen] : trail.slice(0, index + 1);
}

export function previousScreen(trail: readonly Screen[], screen: Screen, fallback: Screen): Screen {
    const index = trail.lastIndexOf(screen);
    return (index < 0 ? trail.at(-1) : trail[index - 1]) ?? fallback;
}

export function readNavigationTrail(account: string): NavigationTrail | null {
    if (!account) return null;
    try {
        const value = JSON.parse(sessionStorage.getItem(keyFor(account)) ?? 'null');
        if (!value || typeof value.screen !== 'string' || !Array.isArray(value.trail)) return null;
        const trail = value.trail.filter((s: unknown): s is Screen => typeof s === 'string' && RETURN_SCREENS.has(s as Screen)).slice(-20);
        // Unknown and transient destinations restore to their last usable origin.
        const screen = RESTORABLE_SCREENS.has(value.screen) ? value.screen as Screen : trail.at(-1);
        return screen ? { screen, trail } : null;
    } catch { return null; }
}

export function writeNavigationTrail(account: string, value: NavigationTrail): void {
    if (!account || value.screen === 'start') return;
    try { sessionStorage.setItem(keyFor(account), JSON.stringify(value)); } catch { /* private mode */ }
    try {
        localStorage.setItem(`${keyFor(account)}:screen`, value.screen);
        // Keep the legacy breadcrumb for older deployed clients, with ownership.
        localStorage.setItem('lastScreen.v1', value.screen);
        localStorage.setItem('lastScreen.owner.v1', account.trim().toLowerCase());
    } catch { /* private mode */ }
}

export function readScreenPreference(hash: string, account: string): Screen | null {
    const raw = hash.replace(/^#\/?/, '') as Screen;
    if (DEEP_LINKABLE_SCREENS.has(raw)) return raw;
    const saved = readNavigationTrail(account);
    if (saved) return saved.screen;
    try {
        const scoped = localStorage.getItem(`${keyFor(account)}:screen`) as Screen | null;
        if (scoped) return scoped;
        const owner = localStorage.getItem('lastScreen.owner.v1');
        return !owner || owner === account.trim().toLowerCase() ? localStorage.getItem('lastScreen.v1') as Screen | null : null;
    } catch { return null; }
}

export function clearNavigationTrail(account: string): void {
    if (!account) return;
    try { sessionStorage.removeItem(keyFor(account)); } catch { /* private mode */ }
}
