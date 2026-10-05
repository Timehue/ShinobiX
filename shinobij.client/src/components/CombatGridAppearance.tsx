import type { useCombatGridAppearance } from "../lib/use-combat-grid-appearance";
import "../styles/combat-grid-appearance.css";

export function CombatGridAppearanceControls({ appearance }: {
    appearance: ReturnType<typeof useCombatGridAppearance>;
}) {
    return <div className="combat-grid-appearance-controls" role="group" aria-label="Battle grid appearance">
        <button type="button" aria-pressed={appearance.look === "new"} onClick={() => appearance.setLook("new")} title="Textured battlefield">New</button>
        <span aria-hidden="true">/</span>
        <button type="button" aria-pressed={appearance.look === "old"} onClick={() => appearance.setLook("old")} title="Original battlefield">Old</button>
        {appearance.look === "new" && <button type="button" className="combat-grid-visibility" aria-pressed={appearance.showGrid}
            title="Keep the grid visible; targeting shows it automatically" onClick={() => appearance.setShowGrid(value => !value)}>Grid</button>}
    </div>;
}

/** Same flat hex outline as the tower; the existing button still owns input. */
export function CombatGridOutline() {
    return <svg className="combat-grid-outline" viewBox="0 0 72 42" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <polygon points="18,1.68 54,1.68 72,21 54,40.32 18,40.32 0,21" />
    </svg>;
}
