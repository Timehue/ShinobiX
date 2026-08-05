import type { CSSProperties, ReactNode } from "react";
import { CombatInstance } from "./CombatInstance";

type ShinobiCombatShellProps = {
    children: ReactNode;
    mode: "pvp" | "solo";
    className?: string;
    style?: CSSProperties;
};

/**
 * Shared application and responsive-composition boundary for authoritative
 * shinobi combat. The two transports supply state; this shell owns viewport
 * containment, the compact/wide dossier contract, and board/action regions.
 */
export function ShinobiCombatShell({ children, mode, className = "", style }: ShinobiCombatShellProps) {
    return (
        <CombatInstance
            className={`shinobi-combat-shell shinobi-combat-shell--${mode}${className ? ` ${className}` : ""}`}
            style={style}
        >
            {children}
        </CombatInstance>
    );
}
