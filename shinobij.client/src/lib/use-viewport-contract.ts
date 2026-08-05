import { useLayoutEffect } from "react";
import { viewportClassForWidth } from "./viewport-contract";

/** Installs the root viewport compatibility attribute from one shared source. */
export function useViewportContract() {
    useLayoutEffect(() => {
        let frame = 0;
        const apply = () => {
            frame = 0;
            document.documentElement.dataset.vp = viewportClassForWidth(window.innerWidth);
        };
        const schedule = () => {
            if (frame) cancelAnimationFrame(frame);
            frame = requestAnimationFrame(apply);
        };

        apply();
        window.addEventListener("resize", schedule, { passive: true });
        window.visualViewport?.addEventListener("resize", schedule, { passive: true });
        return () => {
            window.removeEventListener("resize", schedule);
            window.visualViewport?.removeEventListener("resize", schedule);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);
}
