import { useState } from "react";

// Collapsible board-zoom control for the hex battle screens (PvE Arena + live
// PvP). You only size the board once, so it defaults to a small 🔍 toggle
// tucked to the side; tap to reveal the slider, tap again to hide it away.
// Replaces the always-open full-width `.hex-zoom-bar` row that read as an
// eyesore mid-fight. Cosmetic only — it just drives useBoardScale's manual
// zoom offset (no combat effect). Shared so PvE + PvP can't drift.
export function HexZoomBar({
    value,
    onChange,
    min = -0.4,
    max = 0.5,
    step = 0.02,
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
}) {
    const [open, setOpen] = useState(false);
    // When collapsed but the board is zoomed off default, show a small dot on
    // the toggle so it reads as "a custom zoom is active" without opening.
    const zoomed = Math.abs(value) > 0.001;
    return (
        <div className={`hex-zoom-bar ${open ? "hex-zoom-open" : "hex-zoom-collapsed"}`}>
            <button
                type="button"
                className="hex-zoom-toggle"
                onClick={() => setOpen((o) => !o)}
                title={open ? "Hide board zoom" : "Adjust board zoom"}
                aria-label={open ? "Hide board zoom" : "Adjust board zoom"}
                aria-expanded={open}
            >
                <span className="hex-zoom-label" aria-hidden="true">🔍</span>
                {zoomed && !open && <span className="hex-zoom-dot" aria-hidden="true" />}
            </button>
            {open && (
                <>
                    <input
                        type="range"
                        className="hex-zoom-slider"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onChange={(e) => onChange(Number(e.target.value))}
                        aria-label="Board zoom"
                    />
                    <button
                        type="button"
                        className="hex-zoom-reset"
                        onClick={() => onChange(0)}
                        title="Reset zoom"
                        aria-label="Reset board zoom"
                    >↺</button>
                </>
            )}
        </div>
    );
}
