import type { CSSProperties, ReactNode } from "react";
import { CombatInstance } from "./CombatInstance";

type ShinobiCombatShellProps = {
    children: ReactNode;
    mode: "pvp" | "solo" | "tactical";
    className?: string;
    style?: CSSProperties;
};

/**
 * Shared application and responsive-composition boundary for authoritative
 * shinobi combat. The transports supply state; this shell owns viewport
 * containment and the shared battle-skin boundary. PvP and Solo use its
 * dossier composition, while Tactical keeps its N-actor zoomable board grid.
 */
export function ShinobiCombatShell({ children, mode, className = "", style }: ShinobiCombatShellProps) {
    return (
        <CombatInstance
            id="combat"
            className={`shinobi-combat-shell shinobi-combat-shell--${mode}${className ? ` ${className}` : ""}`}
            style={style}
        >
            {children}
        </CombatInstance>
    );
}
