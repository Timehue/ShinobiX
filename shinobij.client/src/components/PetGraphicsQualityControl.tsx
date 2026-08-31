import type { CSSProperties } from "react";
import type { PetVisualQuality } from "../lib/pet-visual-quality";

const LABELS: Readonly<Record<PetVisualQuality, string>> = {
    low: "Performance",
    medium: "Balanced",
    high: "Cinematic",
};

/** Compact, battle-safe graphics selector. The owner remounts its Canvas after
 * persisting the new tier, so model materials, shadows and post FX all switch
 * together instead of leaving a half-updated scene. */
export function PetGraphicsQualityControl({ value, onChange, compact = false }: {
    value: PetVisualQuality;
    onChange: (value: PetVisualQuality) => void;
    compact?: boolean;
}) {
    return (
        <label
            title="Pet battle graphics quality"
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: compact ? 4 : 6,
                minHeight: compact ? 26 : 30,
                padding: compact ? "0 6px" : "0 8px",
                border: "1px solid rgba(148,163,184,.46)",
                borderRadius: 8,
                background: "rgba(8,12,24,.88)",
                color: "#cbd5e1",
                boxShadow: "0 4px 14px rgba(0,0,0,.3)",
                font: `800 ${compact ? 9 : 10}px/1 Inter,system-ui,sans-serif`,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                pointerEvents: "auto",
            }}
        >
            <span aria-hidden="true">◆</span>
            <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Graphics quality</span>
            <select
                aria-label="Pet battle graphics quality"
                value={value}
                onChange={(event) => onChange(event.currentTarget.value as PetVisualQuality)}
                style={{
                    width: compact ? 104 : 120,
                    border: 0,
                    outline: 0,
                    background: "transparent",
                    color: value === "high" ? "#fde68a" : "#e2e8f0",
                    font: "inherit",
                    letterSpacing: "inherit",
                    textTransform: "inherit",
                    cursor: "pointer",
                    colorScheme: "dark",
                } as CSSProperties}
            >
                {(Object.keys(LABELS) as PetVisualQuality[]).map((id) => (
                    <option key={id} value={id}>{LABELS[id]}</option>
                ))}
            </select>
        </label>
    );
}
