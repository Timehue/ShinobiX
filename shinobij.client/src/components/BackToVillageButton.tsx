import type { CSSProperties } from "react";

/**
 * Standard "← Village" return button for the village menu screens (Shop, Bank,
 * Mission Hall, Clan Hall, Training, Town Hall, Hospital, etc.). Uses the shared
 * default blue button skin via the `back-button` class so every village screen
 * has a consistent, obvious way back to the Village hub.
 *
 * Pass `onClick` wired to navigate to the "village" screen — e.g.
 * `onClick={() => setScreen("village")}` for screens that already receive
 * `setScreen`, or a dedicated `onBack` callback for screens that don't. The
 * `label` defaults to "← Village" but can be overridden for menus that hang off
 * a different hub (e.g. the Grand Marketplace returns to the Central Hub).
 */
export function BackToVillageButton({ onClick, style, label = "← Village" }: { onClick: () => void; style?: CSSProperties; label?: string }) {
    return (
        <button type="button" className="back-button village-back-button" onClick={onClick} style={style}>
            {label}
        </button>
    );
}
