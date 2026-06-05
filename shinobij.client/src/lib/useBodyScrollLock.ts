import { useEffect } from "react";

/**
 * Ref-counted body scroll lock for modals / overlays.
 *
 * While any modal is `active`, the page behind it can't scroll (wheel/touch) —
 * previously every overlay let the background scroll, which on mobile let the
 * content slide around under the dialog. Ref-counting means nested modals (e.g.
 * a GameAlert fired over the open Shop popup) keep the lock until ALL of them
 * close, and the original overflow is restored exactly once at the end.
 */
let _lockCount = 0;
let _savedOverflow = "";

export function useBodyScrollLock(active: boolean): void {
    useEffect(() => {
        if (!active || typeof document === "undefined") return;
        if (_lockCount === 0) {
            _savedOverflow = document.body.style.overflow;
            document.body.style.overflow = "hidden";
        }
        _lockCount++;
        return () => {
            _lockCount = Math.max(0, _lockCount - 1);
            if (_lockCount === 0) document.body.style.overflow = _savedOverflow;
        };
    }, [active]);
}
