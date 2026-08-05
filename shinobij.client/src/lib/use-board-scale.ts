import { useCallback, useEffect, useRef, useState } from "react";

export function fitBoardScale(containerWidth: number, containerHeight: number, gridWidth: number, gridHeight: number) {
    const nextScale = Math.min(containerWidth / gridWidth, containerHeight / gridHeight);
    return Math.max(0, Math.floor(nextScale * 1000) / 1000);
}

export function applyBoardZoomOffset(fittedScale: number, userScaleOffset: number) {
    const positiveFloorWithinFit = Math.min(fittedScale, 0.05);
    return Math.max(positiveFloorWithinFit, Math.min(2.5, fittedScale, fittedScale + userScaleOffset));
}

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
    const observerCleanupRef = useRef<(() => void) | null>(null);
    const [boardScale, setBoardScale] = useState(1);
    // Container dims kept in state so the consumer's centering math stays in
    // sync with the scale computed from the same measurement.
    const [boardContainerSize, setBoardContainerSize] = useState({ w: 0, h: 0 });
    // Player-controlled zoom offset on top of the auto scale (zoom slider).
    const [userScaleOffset, setUserScaleOffset] = useState(0);

    const battlefieldCallbackRef = useCallback((el: HTMLDivElement | null) => {
        observerCleanupRef.current?.();
        observerCleanupRef.current = null;
        battlefieldRef.current = el;
        if (!el) return;

        function update() {
            if (!el) return;
            const cw = el.clientWidth;
            const ch = el.clientHeight;
            // Fitting is authoritative at every viewport height. Floor rather
            // than round the measurement so the transformed grid can never
            // exceed its stage by a rounding increment on a short viewport.
            const fittedScale = fitBoardScale(cw, ch, gridLayerW, gridLayerH);
            setBoardScale((current) => current === fittedScale ? current : fittedScale);
            setBoardContainerSize((current) => current.w === cw && current.h === ch ? current : { w: cw, h: ch });
        }

        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        observerCleanupRef.current = () => {
            observer.disconnect();
        };
    }, [gridLayerW, gridLayerH]);

    useEffect(() => () => {
        observerCleanupRef.current?.();
        observerCleanupRef.current = null;
    }, []);

    // Manual zoom-out may shrink the board, but it must never make it larger
    // than the measured fit (or the supported 2.5x rendering ceiling).
    const effectiveScale = applyBoardZoomOffset(boardScale, userScaleOffset);
    return { battlefieldRef, battlefieldCallbackRef, boardContainerSize, userScaleOffset, setUserScaleOffset, effectiveScale };
}
