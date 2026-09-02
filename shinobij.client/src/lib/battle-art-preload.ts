// Battle-entry arena art warmup, drained verbatim from App.tsx (2026-09-02).
// Fire-and-forget <img> decodes so the arena backdrop and floor are already in
// the HTTP cache when the battle screen mounts.
import type { Biome } from "../types/core";

const ARENA_ART_BY_BIOME: Record<Biome, readonly [string, string]> = {
    forest: ["/arena-forest.webp", "/arena-forest-floor.webp"],
    snow: ["/arena-snow.webp", "/arena-snow-floor.webp"],
    volcano: ["/arena-volcano.webp", "/arena-volcano-floor.webp"],
    shadow: ["/arena-shadow.webp", "/arena-shadow-floor.webp"],
    central: ["/arena-central.webp", "/arena-central-floor.webp"],
};
const DEATHSGATE_ARENA_ART = ["/deathsgate-arena.webp", "/deathsgate-arena-floor.webp"] as const;
const preloadedBattleArt = new Set<string>();

function preloadBattleArtUrl(url: string) {
    if (preloadedBattleArt.has(url)) return;
    preloadedBattleArt.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
}

export function preloadBattleEntryAssets(biome: Biome, sector: number) {
    const urls = sector === 99 ? DEATHSGATE_ARENA_ART : ARENA_ART_BY_BIOME[biome];
    urls.forEach(preloadBattleArtUrl);
}
