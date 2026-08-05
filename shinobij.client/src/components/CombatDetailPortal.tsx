import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type CombatDetailPortalProps = {
    children: ReactNode;
    className?: string;
    id: string;
    labelId: string;
    triggerId: string;
    onClose: () => void;
};

/** Shared accessible overlay boundary for Solo and PvP combat details. */
export function CombatDetailPortal({
    children,
    className = "",
    id,
    labelId,
    triggerId,
    onClose,
}: CombatDetailPortalProps) {
    const onCloseRef = useRef(onClose);
    useLayoutEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const trigger = document.getElementById(triggerId) as HTMLElement | null;
        const dialog = document.getElementById(id);
        const focusClose = window.requestAnimationFrame(() => {
            dialog?.querySelector<HTMLElement>("[data-combat-detail-close]")?.focus();
        });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== "Tab" || !dialog) return;
            const focusable = [...dialog.querySelectorAll<HTMLElement>(
                'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )].filter((element) => element.getClientRects().length > 0);
            const first = focusable[0];
            const last = focusable.at(-1);
            if (!first || !last) {
                event.preventDefault();
                dialog.focus();
                return;
            }
            const active = document.activeElement;
            const focusOutsideControls = active === dialog || !dialog.contains(active);
            if (event.shiftKey && (active === first || focusOutsideControls)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || focusOutsideControls)) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(focusClose);
            document.removeEventListener("keydown", handleKeyDown, true);
            window.requestAnimationFrame(() => trigger?.focus());
        };
    }, [id, triggerId]);

    return createPortal(
        <div
            className="combat-detail-backdrop"
            onClick={(event) => {
                if (event.target === event.currentTarget) onCloseRef.current();
            }}
        >
            <div
                id={id}
                className={`combat-jutsu-detail-popover${className ? ` ${className}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={labelId}
                tabIndex={-1}
            >
                {children}
            </div>
        </div>,
        document.body,
    );
}
