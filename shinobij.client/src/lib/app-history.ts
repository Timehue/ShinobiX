/*
 * URL hash + browser history for the app shell.
 *
 * Owns two related things that both write window.history, kept together so they
 * cannot fight each other:
 *
 *  1. The shareable URL hash (`#/village`) — BOTH surfaces, unchanged behaviour,
 *     moved verbatim out of App.tsx.
 *  2. The Android hardware back button — PLAY APP ONLY.
 *
 * WHY BACK IS APP-ONLY. In an installed app, back means "up one screen" and
 * Android users expect it; on a website, back is the browser's own affordance
 * and intercepting it is the classic back-button trap. So on the web this module
 * pushes no history entries and installs no popstate listener — byte-for-byte
 * the behaviour that shipped before it existed.
 *
 * ⛔ THE LANDMINE. App.tsx used replaceState deliberately: "no new history
 * entries and no popstate — so it never conflicts with the localStorage restore
 * or the mobile back-stack". Directly above it, lastScreen.v1 exists because
 * routing a refresh to the village "was the bug that let players refresh-flee a
 * fight". A back stack re-opens exactly that hole: back out of a fight, refresh,
 * and the restore would honour the screen you backed into. So back is REFUSED
 * while a battle is unresolved — the entry is pushed straight back and the
 * player stays put, with Forfeit remaining the only exit. Back must never become
 * a flee route.
 *
 * Back is also refused toward any screen that is not deep-linkable, reusing
 * screen-guards' own definition of "renders correctly from the loaded save
 * alone". Landing on a stale battle screen with no sealed session is the other
 * half of the same failure.
 */
import { useEffect, useRef } from 'react';
import type { Screen } from '../types/core';
import { DEEP_LINKABLE_SCREENS } from './screen-guards';
import { isPlayApp } from './surface';

export type BackDecision =
    | { action: 'refuse'; reason: 'battle-unresolved' | 'unknown-target' }
    | { action: 'navigate'; screen: Screen; fellBack?: true };

/** Where back lands when the popped entry is not safe to restore. Matches the */
/** refresh path, which also "routed to the village" for unrestorable screens. */
const BACK_FALLBACK_SCREEN: Screen = 'village';

/** `#/village` → `village`. Anything else yields an empty string. */
export function screenFromHash(hash: string): string {
    const raw = String(hash ?? '');
    return raw.startsWith('#/') ? raw.slice(2) : '';
}

export function hashForScreen(screen: Screen): string {
    return `#/${screen}`;
}

/**
 * Pure core: what should a back press do? Exported so the refusal rules are
 * testable without a browser or a React tree.
 */
export function decideBack(opts: {
    targetHash: string;
    battleUnresolved: boolean;
}): BackDecision {
    // Checked FIRST and unconditionally: no target is worth leaving a live fight
    // for, so this cannot be reordered below the target checks.
    if (opts.battleUnresolved) return { action: 'refuse', reason: 'battle-unresolved' };

    const target = screenFromHash(opts.targetHash);
    // A hash we never wrote — we have popped past our own entries. Refusing
    // re-pushes and keeps the app alive rather than showing a foreign URL.
    if (!target) return { action: 'refuse', reason: 'unknown-target' };

    // Not safe to land on (battle/encounter screens hold ephemeral state or a
    // sealed session). Fall back rather than refuse: these entries are the
    // COMMON case, not the rare one — finishing any fight leaves one behind, so
    // village → petArena → village is an ordinary stack. Refusing there would
    // make back silently do nothing, which reads as a broken button.
    if (!DEEP_LINKABLE_SCREENS.has(target as Screen)) {
        return { action: 'navigate', screen: BACK_FALLBACK_SCREEN, fellBack: true };
    }
    return { action: 'navigate', screen: target as Screen };
}

/**
 * Reflect `screen` in the URL, and on the Play app only, make the hardware back
 * button walk the screen stack.
 *
 * `isBattleUnresolved` is read at press time rather than captured, so the answer
 * reflects the fight state at the moment of the press. App.tsx passes its
 * existing isPresenceBattleActive — the same guard the global nav bar uses, so
 * back and the nav bar can never disagree about whether a fight is live.
 */
export function useAppHistory(
    screen: Screen,
    navigate: (next: Screen) => void,
    isBattleUnresolved: () => boolean,
): void {
    // Refs so the popstate listener is installed once and still sees fresh
    // values; re-subscribing per screen change would drop in-flight presses.
    const screenRef = useRef(screen);
    const battleRef = useRef(isBattleUnresolved);
    const navigateRef = useRef(navigate);
    // Written in an effect, never during render: a ref mutated mid-render is
    // torn by StrictMode's double invoke and by concurrent rendering. No dep
    // array, so every commit refreshes them — and a back press can only arrive
    // from a user gesture, which is always after the commit.
    useEffect(() => {
        screenRef.current = screen;
        battleRef.current = isBattleUnresolved;
        navigateRef.current = navigate;
    });

    // ── Shareable URL hash ──────────────────────────────────────────────
    // Reflect the active screen in the URL (e.g. #/village) so links are
    // visible, bookmarkable, and shareable. We deliberately skip the "start"
    // (login) screen so a bookmarked deep-link hash isn't wiped before the
    // post-login restore can read it.
    //
    // Web uses replaceState — no history entries, no popstate, exactly as
    // before. The Play app pushes instead, and that push IS the back stack.
    useEffect(() => {
        if (screen === 'start') return;
        try {
            const want = hashForScreen(screen);
            if (window.location.hash === want) return;
            if (isPlayApp()) window.history.pushState(null, '', want);
            else window.history.replaceState(null, '', want);
        } catch { /* sandboxed / SSR */ }
    }, [screen]);

    // ── Android hardware back (Play app only) ───────────────────────────
    useEffect(() => {
        if (!isPlayApp()) return;
        const onPopState = () => {
            const decision = decideBack({
                targetHash: window.location.hash,
                battleUnresolved: battleRef.current(),
            });
            if (decision.action === 'navigate') {
                navigateRef.current(decision.screen);
                return;
            }
            // Refused: put the entry back so the app stays where it is instead
            // of falling through to Android's "exit the app" default. Pressing
            // back again simply refuses again.
            try {
                window.history.pushState(null, '', hashForScreen(screenRef.current));
            } catch { /* sandboxed */ }
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);
}
