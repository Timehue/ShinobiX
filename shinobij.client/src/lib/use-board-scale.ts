import { useCallback, useRef, useState } from "react";

type BattlefieldEl = HTMLDivElement & { _roCleanup?: () => void };

/**
 * Auto-fit scale for the combat hex board, shared by the arena (PvE) and live
 * PvP battle components. This logic used to be copy-pasted in both — which is
 * exactly why the widescreen scaling bug had to be fixed in two places.
 *
 * A ResizeObserver measures the board container and fits the fixed-size grid
 * (gridLayerW × gridLayerH) into it with NO upper cap, so the grid scales UP to
 * fill wide/tall boards. min() of the two fit ratios guarantees the scaled grid
 * never exceeds the container, so the consumer's absolute-centering math stays
 * valid and never clips. `userScaleOffset` is the player's manual zoom on top of
 * the auto fit; `effectiveScale` is the clamped sum used for the transform.
 */
export function useBoardScale(gridLayerW: number, gridLayerH: number) {
    const battlefieldRef = useRef<HTMLDivElement | null>(null);
    const [boardScale, setBoardScale] = useState(1);
    // Container dims kept in state so the consumer's centering math stays in
    // sync with the scale computed from the same measurement.
    const [boardContainerSize, setBoardContainerSize] = useState({ w: 0, h: 0 });
    // Player-controlled zoom offset on top of the auto scale (zoom slider).
    const [userScaleOffset, setUserScaleOffset] = useState(0);

    const battlefieldCallbackRef = useCallback((el: HTMLDivElement | null) => {
        battlefieldRef.current = el;
        // Clean up any previous observer stored on the element.
        if ((el as BattlefieldEl | null)?._roCleanup) {
            (el as BattlefieldEl)._roCleanup!();
        }
        if (!el) return;

        function update() {
            if (!el) return;
            const cw = el.clientWidth;
            const ch = el.clientHeight;
            const isMobileNarrow = cw < 600;
            const nextScale = Math.min(cw / gridLayerW, ch / gridLayerH);
            const minScale = isMobileNarrow ? 0.15 : 0.45;
            setBoardScale(Math.max(minScale, Number(nextScale.toFixed(3))));
            setBoardContainerSize({ w: cw, h: ch });
        }

        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        window.addEventListener("resize", update);
        (el as BattlefieldEl)._roCleanup = () => {
            observer.disconnect();
            window.removeEventListener("resize", update);
        };
    }, [gridLayerW, gridLayerH]);

    const effectiveScale = Math.max(0.15, Math.min(2.5, boardScale + userScaleOffset));
    return { battlefieldRef, battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale };
}
