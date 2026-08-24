import { useEffect, useRef, type ReactNode } from "react";

/**
 * The full-screen scrim behind an encounter dialog, carrying the dialog
 * semantics the bare <div> it replaced never had.
 *
 * This one needs MORE accessibility than the app's other modals, not less. A
 * road wanderer arms itself and walks to the player (SectorWanderer.tsx), and a
 * bandit paths from anywhere in the sector — so this is the only dialog in the
 * game that can open with no player action at all. Before this it had no role,
 * no label, no focus move and no Escape: a keyboard or screen-reader user got a
 * forced choice pushed in front of them silently, with focus still parked on
 * whatever was behind the scrim.
 *
 * Escape always dismisses, including for the "you must choose" encounters that
 * deliberately refuse a backdrop click. Fleeing is a legitimate answer and
 * already costs the 30-minute wanderer cooldown, so honouring Escape keeps the
 * forced-choice rule intact while giving the keyboard the same exit the mouse
 * has had all along.
 *
 * Deliberately NOT using `inert` on the background. An earlier modal that
 * closed and navigated in the same click leaked `inert` onto #root and left the
 * whole app scrolling but unclickable; that failure is worse than the
 * background staying reachable by Tab, so this trades the focus trap for the
 * guarantee that nothing can be left behind.
 */
export function ModalDialogScrim({ label, onBackdrop, onEscape, children }: {
    /** Announced when the dialog opens. Name the encounter, not the widget. */
    label: string;
    /** Backdrop click. May legitimately be a no-op for a forced choice. */
    onBackdrop: () => void;
    /** Escape. Always a real exit, even when the backdrop refuses. */
    onEscape: () => void;
    children: ReactNode;
}) {
    const scrimRef = useRef<HTMLDivElement>(null);
    // Read through a ref so the listener is bound ONCE. The host screen
    // re-renders on every animation frame while the sector floor is running,
    // and re-subscribing a window listener that often is pure waste.
    const escapeRef = useRef(onEscape);
    useEffect(() => { escapeRef.current = onEscape; }, [onEscape]);

    useEffect(() => {
        // Move focus in, and put it back where it came from on close — losing it
        // to <body> would drop a keyboard user at the top of the page.
        const restoreTo = document.activeElement as HTMLElement | null;
        scrimRef.current?.focus();
        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            escapeRef.current();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
        };
    }, []);

    return (
        <div
            ref={scrimRef}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            tabIndex={-1}
            style={{ position: "fixed", inset: 0, zIndex: 9999, display: "grid", placeItems: "center", background: "rgba(0,0,0,.55)", outline: "none" }}
            onClick={onBackdrop}
        >
            {children}
        </div>
    );
}
