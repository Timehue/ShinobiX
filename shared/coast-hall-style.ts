export const HALL_MODELS = {
    gale: "Gale Watch", tide: "Tide Gate", heron: "Heron Court", kiln: "Ember Bastion", pine: "Pinecrest Lodge",
} as const;
export const HALL_DYES = {
    cobalt: ["Deep Cobalt", "#315bce"], vermilion: ["Vermilion", "#e75132"], saffron: ["Saffron", "#e7aa34"],
    plum: ["Mulberry", "#943d83"], jade: ["Sea Jade", "#369583"], frost: ["Glacier Blue", "#83c6dc"],
    silver: ["Moon Silver", "#cac9cd"], charcoal: ["Ink Black", "#35303c"], rose: ["Wild Rose", "#dc8699"],
    ochre: ["Copper Ochre", "#aa6439"],
} as const;
export type HallStyle = { model: keyof typeof HALL_MODELS; dye: keyof typeof HALL_DYES };
export const DEFAULT_HALL: HallStyle = { model: "gale", dye: "cobalt" };
export function readHallStyle(value: unknown): HallStyle | null {
    if (!value || typeof value !== "object") return null;
    const { model, dye } = value as Record<string, unknown>;
    return typeof model === "string" && Object.hasOwn(HALL_MODELS, model) && typeof dye === "string" && Object.hasOwn(HALL_DYES, dye)
        ? { model: model as HallStyle["model"], dye: dye as HallStyle["dye"] } : null;
}

