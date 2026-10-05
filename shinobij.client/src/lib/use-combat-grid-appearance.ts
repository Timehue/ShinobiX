import { useState, type CSSProperties } from "react";
import forest from "../assets/towers/battlefield/forest-v1.webp";
import snow from "../assets/towers/battlefield/snow-v1.webp";
import volcano from "../assets/towers/battlefield/volcano-v1.webp";
import shadow from "../assets/towers/battlefield/shadow-v1.webp";
import central from "../assets/towers/battlefield/central-v1.webp";

const FLOORS: Record<string, string> = { forest, snow, volcano, shadow, central };
const PREFERENCE_KEY = "shinobix:combat-grid-look";
type Look = "new" | "old";

/** Local presentation only: never changes the session, geometry, or targeting. */
export function useCombatGridAppearance(biome: string, targeting: boolean) {
    const [look, setLook] = useState<Look>(() => {
        try { return localStorage.getItem(PREFERENCE_KEY) === "new" ? "new" : "old"; }
        catch { return "old"; }
    });
    const [showGrid, setShowGrid] = useState(false);
    return {
        look, showGrid, setShowGrid,
        setLook: (value: Look) => {
            setLook(value);
            try { localStorage.setItem(PREFERENCE_KEY, value); } catch { /* Optional preference. */ }
        },
        boardProps: {
            "data-grid-look": look,
            "data-grid-visible": showGrid || targeting,
            style: { "--combat-biome-floor": `url("${FLOORS[biome] ?? central}")` } as CSSProperties,
        },
    };
}
