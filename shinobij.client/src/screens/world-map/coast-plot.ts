import type { CoastLand, Landing } from "./coast-service";

const prefix = "/coast-map/landing/";
export const plotPlate = (id: string) => prefix + id + "-v1.webp";
const tiers = ["", "camp", "hall", "gate"];
export function plotPaint(sector: number, base?: Landing | null) {
    const standing = base?.landing?.sector === sector ? base.landing : null;
    const fallen = !standing && base?.fallen?.sector === sector;
    const tier = standing && tiers[standing.tier];
    return {
        main: tier ? "/sector-buildings/clan-landing-" + tier + "-map-v1.webp"
            : standing ? plotPlate("staked-plot") : fallen ? plotPlate("fallen-landing") : undefined,
        scene: tier ? "/sector-buildings/clan-landing-" + tier + "-v1.webp"
            : fallen ? plotPlate("fallen-landing-entry") : undefined,
        dormant: standing?.status === "dormant",
        works: (standing?.works ?? []).filter(work => work.built && (work.id !== "watch-fire" || standing?.status !== "dormant")),
    };
}

export function atlasPlate(here: boolean, sealed: boolean, open: boolean, land?: CoastLand) {
    if (here) return "here";
    if (sealed) return "sealed";
    if (!open) return "shut";
    if (land?.contest && land.contest.phase !== "closed") return "contested";
    return land?.holder ? "held" : "open";
}

