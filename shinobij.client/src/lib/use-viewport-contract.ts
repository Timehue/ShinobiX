import { useLayoutEffect } from "react";
import { viewportClassForWidth } from "./viewport-contract";

/** Installs the root viewport compatibility attribute from one shared source. */
export function useViewportContract() {
    useLayoutEffect(() => {
        let frame = 0;
        const apply = () => {
            frame = 0;
            const root = document.documentElement;
            root.dataset.vp = viewportClassForWidth(window.innerWidth);
            // iOS keeps the layout viewport tall when the keyboard opens. Fixed
            // chat surfaces must follow the visible viewport instead. Pinch zoom
            // must never be mistaken for a keyboard or disable navigation.
            const viewport = window.visualViewport;
            const focused = document.activeElement;
            const editing = focused instanceof HTMLElement
                && (focused.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"])')
                    || focused.isContentEditable);
            const keyboardOpen = Boolean(viewport && editing && Math.abs(viewport.scale - 1) < 0.05
                && window.innerHeight - viewport.height > 120);
            root.toggleAttribute("data-keyboard-open", keyboardOpen);
            root.style.setProperty("--visual-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
            root.style.setProperty("--visual-viewport-top", `${viewport?.offsetTop ?? 0}px`);
        };
        const schedule = () => {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(apply);
        };

        apply();
        window.addEventListener("resize", schedule, { passive: true });
        window.visualViewport?.addEventListener("resize", schedule, { passive: true });
        window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("pageshow", schedule);
        document.addEventListener("visibilitychange", schedule);
        document.addEventListener("focusin", schedule);
        document.addEventListener("focusout", schedule);
        return () => {
            window.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("scroll", schedule);
            window.removeEventListener("pageshow", schedule);
            document.removeEventListener("visibilitychange", schedule);
            document.removeEventListener("focusin", schedule);
            document.removeEventListener("focusout", schedule);
            document.documentElement.removeAttribute("data-keyboard-open");
            document.documentElement.style.removeProperty("--visual-viewport-height");
            document.documentElement.style.removeProperty("--visual-viewport-top");
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);
}
