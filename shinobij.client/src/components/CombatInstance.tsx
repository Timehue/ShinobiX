import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

interface CombatInstanceProps {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
}

/**
 * The application boundary for an active fight.
 *
 * Combat is intentionally portaled directly to <body>: attacks can begin while
 * the player is inside any menu or world screen, and no parent layout, scroll
 * position, or responsive center-column rule may move the fight out of view.
 */
export function CombatInstance({ children, className = "", style }: CombatInstanceProps) {
    const combat = (
        <div className={`arena-fullscreen combat-instance${className ? ` ${className}` : ""}`} style={style}>
            {children}
        </div>
    );

    // The client always has document. Keeping a non-portal fallback makes the
    // boundary safe for static rendering and source-level component tests.
    return typeof document === "undefined" ? combat : createPortal(combat, document.body);
}
