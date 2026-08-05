import type { CSSProperties, ReactNode } from "react";
import type { Screen } from "../../types/core";

type AdaptiveShellStyle = CSSProperties & { "--facility-accent"?: string };

type AdaptiveGameShellProps = {
    children: ReactNode;
    biome: string;
    screen: Screen;
    village?: string;
    facilityAccent?: string;
    artwork: string;
    style?: AdaptiveShellStyle;
};

/**
 * Structural boundary for every normal (non-portaled) game screen.
 *
 * This component owns the root shell identity and background layer. Its CSS
 * grid owns rail/content geometry; individual screens own only their content.
 */
export function AdaptiveGameShell({
    children,
    biome,
    screen,
    village = "",
    facilityAccent,
    artwork,
    style: suppliedStyle,
}: AdaptiveGameShellProps) {
    const facility = Boolean(facilityAccent);
    const style: AdaptiveShellStyle = {
        "--facility-accent": facilityAccent,
        backgroundImage: "linear-gradient(rgba(2, 6, 23, 0.38), rgba(2, 6, 23, 0.76))",
        ...suppliedStyle,
    };

    return (
        <div
            className={`app-shell shell-biome-${biome} screen-${screen}${facility ? " screen-facility" : ""}`}
            data-shell="adaptive"
            data-screen={screen}
            data-village={village}
            style={style}
        >
            <div className="app-background" style={{ backgroundImage: `url(${artwork})` }} />
            {children}
        </div>
    );
}
