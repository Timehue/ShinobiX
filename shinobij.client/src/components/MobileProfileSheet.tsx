/*
 * Mobile "You" sheet — the full desktop left-rail profile card, surfaced on
 * mobile where the .left-profile-card rail is CSS-hidden. Opened from the
 * "You" button in the bottom nav (MobileNav).
 *
 * Reuses ProfileCardBody verbatim so mobile players see exactly what desktop
 * players see on their left card (avatar, vitals, currencies, daily caps, XP,
 * training timers). Portal-rendered to <body> at a very high z-index so it
 * paints over the nav / side rails (the full-screen-overlay portal pattern).
 *
 * Modal semantics mirror the bottom-menu overlay: body scroll lock + Escape /
 * backdrop / ✕ to close. Navigating from inside the sheet closes it first.
 */

import { memo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../lib/useBodyScrollLock";
import { ProfileCardBody } from "./LeftProfileCard";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import { GiNinjaHeroicStance } from "./icons/LightweightGameIcons";

export const MobileProfileSheet = memo(function MobileProfileSheet({
    open,
    onClose,
    character,
    updateCharacter,
    currentSector,
    setScreen,
    activeTraining,
    activeJutsuTraining,
}: {
    open: boolean;
    onClose: () => void;
    character: Character;
    updateCharacter: React.Dispatch<React.SetStateAction<Character | null>>;
    currentSector: number;
    setScreen: (s: Screen) => void;
    activeTraining: ActiveTraining | null;
    activeJutsuTraining: ActiveJutsuTraining | null;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    // Lock the body scroll behind the sheet and close on Escape — mirrors the
    // bottom-menu overlay (MobileNav) and the GameAlert modal pattern.
    useBodyScrollLock(open);
    useEffect(() => {
        if (!open) return;
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
            if (e.key !== "Tab") return;
            const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])') ?? [])];
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            previousFocusRef.current?.focus();
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div
            className="mobile-profile-sheet-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Your shinobi"
            onClick={onClose}
        >
            <div ref={dialogRef} className="mobile-profile-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="mobile-profile-sheet-header">
                    <span id="mobile-profile-sheet-title" className="mobile-profile-sheet-title"><GiNinjaHeroicStance aria-hidden="true" /> You</span>
                    <button
                        className="mobile-profile-sheet-close"
                        aria-label="Close"
                        autoFocus
                        onClick={onClose}
                    >✕</button>
                </div>
                <div className="mobile-profile-sheet-body">
                    <ProfileCardBody
                        character={character}
                        updateCharacter={updateCharacter}
                        currentSector={currentSector}
                        // Any in-card navigation (avatar → profile, "What's next"
                        // pin, Level Up) should dismiss the sheet first.
                        setScreen={(s) => { onClose(); setScreen(s); }}
                        activeTraining={activeTraining}
                        activeJutsuTraining={activeJutsuTraining}
                    />
                </div>
            </div>
        </div>,
        document.body,
    );
});
