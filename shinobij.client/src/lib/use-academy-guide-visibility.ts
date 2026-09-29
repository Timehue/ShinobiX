import { useEffect } from "react";

/** Keep guidance from painting over the next action, without fighting user scroll. */
export function useAcademyGuideVisibility(active: boolean, screen: string, step: string) {
    useEffect(() => {
        if (!active) return;
        const guide = document.querySelector<HTMLElement>(".onboarding-coach-banner");
        if (!guide) return;
        const check = () => {
            const box = guide.getBoundingClientRect();
            const controls = [...document.querySelectorAll<HTMLElement>(".academy-click-target[data-academy-autoscroll='true']")];
            const focused = document.activeElement;
            // When the next action lives inside the banner (e.g. Go to Jutsu Hall),
            // an old focused control from the previous lesson must not hide that CTA.
            const ownsNextAction = guide.querySelector(".coach-guide-actions button, .coach-trail-chip-find");
            if (!ownsNextAction && focused instanceof HTMLElement && focused.matches("button, a, input, select, textarea, [tabindex]")) controls.push(focused);
            const blocked = controls.some(control => {
                if (guide.contains(control) || !control.getClientRects().length) return false;
                const rect = control.getBoundingClientRect();
                return rect.left < box.right + 8 && rect.right > box.left - 8
                    && rect.top < box.bottom + 8 && rect.bottom > box.top - 8;
            });
            // Visibility preserves the measured clearance and prevents hide/show loops.
            guide.classList.toggle("coach-guide-yielding", blocked);
        };
        const resize = new ResizeObserver(check);
        resize.observe(guide);
        const mutations = new MutationObserver(check);
        mutations.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("scroll", check, true);
        document.addEventListener("focusin", check);
        document.addEventListener("focusout", check);
        window.addEventListener("resize", check);
        window.visualViewport?.addEventListener("resize", check);
        window.visualViewport?.addEventListener("scroll", check);
        // OnboardingCoach's layout and target-reveal effects run in the same
        // commit. Check after they have reserved banner space and moved the
        // highlighted control, so an initial overlap does not hide the guide
        // before its own layout can settle.
        const initialFrame = window.requestAnimationFrame(check);
        return () => {
            resize.disconnect();
            mutations.disconnect();
            document.removeEventListener("scroll", check, true);
            document.removeEventListener("focusin", check);
            document.removeEventListener("focusout", check);
            window.removeEventListener("resize", check);
            window.visualViewport?.removeEventListener("resize", check);
            window.visualViewport?.removeEventListener("scroll", check);
            window.cancelAnimationFrame(initialFrame);
            guide.classList.remove("coach-guide-yielding");
        };
    }, [active, screen, step]);
}
