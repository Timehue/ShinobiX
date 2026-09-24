/** Shared elemental material and silhouette language for Pet Colosseum and
 *  Beastbound Warfront. Keep these profiles presentation-only: combat events
 *  still own when an effect exists and what happened. */
export type PetBattleElement = "Water" | "Fire" | "Wind" | "Earth" | "Lightning" | "None";
export type PetElementVfxShape = "ripple" | "flare" | "crescent" | "fault" | "bolt" | "impact";

export type PetElementVfxProfile = Readonly<{
    element: PetBattleElement;
    primary: string;
    highlight: string;
    dark: string;
    body: string;
    shape: PetElementVfxShape;
    travelBend: number;
    impactCell: number | null;
}>;

/** Cell order is row-major in the 3×2 transparent atlas. None stays geometric
 *  so neutral hits do not borrow an elemental material identity. */
export const PET_ELEMENT_VFX_PROFILES: Readonly<Record<PetBattleElement, PetElementVfxProfile>> = Object.freeze({
    Water: { element: "Water", primary: "#21c7e6", highlight: "#d8fbff", dark: "#042b55", body: "#0877bd", shape: "ripple", travelBend: 0.12, impactCell: 1 },
    Fire: { element: "Fire", primary: "#ff7a18", highlight: "#ffd36a", dark: "#421008", body: "#d92d12", shape: "flare", travelBend: -0.06, impactCell: 0 },
    Wind: { element: "Wind", primary: "#50d9b8", highlight: "#e0fff3", dark: "#073b3d", body: "#14796f", shape: "crescent", travelBend: 0.2, impactCell: 2 },
    Earth: { element: "Earth", primary: "#ce8f38", highlight: "#ffe0a1", dark: "#2c190e", body: "#754321", shape: "fault", travelBend: -0.1, impactCell: 3 },
    Lightning: { element: "Lightning", primary: "#ffe066", highlight: "#fff3a3", dark: "#3a2b08", body: "#9a6c14", shape: "bolt", travelBend: 0, impactCell: 4 },
    None: { element: "None", primary: "#c9d6de", highlight: "#f6fbff", dark: "#26313a", body: "#71808a", shape: "impact", travelBend: 0, impactCell: null },
});

export function petBattleElement(value: string | null | undefined): PetBattleElement {
    switch (String(value ?? "").trim().toLowerCase()) {
        case "water": return "Water";
        case "fire": return "Fire";
        case "wind": return "Wind";
        case "earth": return "Earth";
        case "lightning": return "Lightning";
        default: return "None";
    }
}

export function petElementVfxProfile(value: string | null | undefined): PetElementVfxProfile {
    return PET_ELEMENT_VFX_PROFILES[petBattleElement(value)];
}

export const PET_ELEMENT_IMPACT_ATLAS_URL = "/assets/warfront/elemental-impact-atlas-v1.webp";
export const PET_ELEMENT_IMPACT_ATLAS_COLUMNS = 3;
export const PET_ELEMENT_IMPACT_ATLAS_ROWS = 2;
export const PET_ELEMENT_IMPACT_CELL_SIZE = 512;

export function petElementImpactUvCell(value: string | null | undefined): Readonly<{ column: number; row: number }> | null {
    const cell = petElementVfxProfile(value).impactCell;
    if (cell === null) return null;
    return { column: cell % PET_ELEMENT_IMPACT_ATLAS_COLUMNS, row: Math.floor(cell / PET_ELEMENT_IMPACT_ATLAS_COLUMNS) };
}
