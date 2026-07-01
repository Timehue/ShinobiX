/*
 * Sector-ownership overlay for the world map (Village War Map, §10.2 / §10.3).
 * A pointer-events:none layer planted over the existing sector markers: each
 * owned war-sector gets the holder's banner standee rising above its marker plus
 * an accent claim-ring at the base, and sectors with an active siege pulse so the
 * front line reads at a glance. Central (>= 56) and Death's Gate (99) are neutral,
 * unclaimable landmarks and never get a banner.
 *
 * Flag-gated by the CALLER (isVillageWarMapEnabled) — inert otherwise, and the
 * prior atlas war-overlay was removed for clutter, so this only paints when the
 * War-Map mode is on. Reads the server war-map view for the home-sector ownership
 * map + active contests, then overrides each sector with the local territory
 * cache so a CAPTURED sector shows the conqueror's banner (the plan's "captured
 * sector shows the conqueror's banner"). isLowEndMobile() drops the glow/pulse FX.
 *
 * Self-contained: WorldMap passes its sectorPoints (the same %-coords its markers
 * use) and renders <SectorOwnershipOverlay> inside .anime-world-map. No new war
 * engine — pure view over the existing server state.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { fetchWarMap, villageAccent } from "../lib/village-war-map";
import { loadSectorTerritory } from "../lib/world-state";
import { HOME_SECTORS } from "../data/war-map-sectors";
import { isLowEndMobile } from "../lib/device-tier";
import ashenBanner from "../assets/village-war/owned-sector-ashenleaf.webp";
import frostBanner from "../assets/village-war/owned-sector-frostfang.webp";
import moonBanner from "../assets/village-war/owned-sector-moonshadow.webp";
import stormBanner from "../assets/village-war/owned-sector-stormveil.webp";

// village display name -> planted-banner asset (the four §13 markers).
const BANNER_BY_VILLAGE: Record<string, string> = {
    "Ashen Leaf Village": ashenBanner,
    "Frostfang Village": frostBanner,
    "Moonshadow Village": moonBanner,
    "Stormveil Village": stormBanner,
};

type SectorPoint = { id: number; x: number; y: number };

export function SectorOwnershipOverlay({ sectorPoints }: { sectorPoints: readonly SectorPoint[] }) {
    // Base ownership = each village's static home sectors (the client mirror, so it
    // works with no server), overridden by any captured sector from the local
    // territory cache so a flipped sector flies the conqueror's banner. Pure derived
    // (static table + cache read) — no effect needed.
    const ownerBySector = useMemo(() => {
        const owners = new Map<number, string>();
        for (const [village, sectors] of Object.entries(HOME_SECTORS)) {
            for (const s of sectors) owners.set(s, village);
        }
        for (const s of [...owners.keys()]) {
            const owner = loadSectorTerritory(s).ownerVillage;
            if (owner) owners.set(s, owner);
        }
        return owners;
    }, []);

    // Active sieges drive the pulse — best-effort from the server; simply absent when
    // the war feature is off server-side (the ownership banners still show).
    const [contested, setContested] = useState<Set<number>>(new Set());
    useEffect(() => {
        let alive = true;
        fetchWarMap()
            .then((view) => { if (alive && view.enabled) setContested(new Set(view.contests.map((c) => c.sector))); })
            .catch(() => { /* no live sieges available */ });
        return () => { alive = false; };
    }, []);

    if (ownerBySector.size === 0) return null;
    const lite = isLowEndMobile();
    const pointById = new Map(sectorPoints.map((p) => [p.id, p] as const));

    return (
        <div className="vw-owner-overlay" aria-hidden="true">
            {[...ownerBySector.entries()].map(([sector, village]) => {
                const p = pointById.get(sector);
                // Skip the neutral central keep (>= 56) and Death's Gate (99).
                if (!p || sector >= 56 || sector === 99) return null;
                const banner = BANNER_BY_VILLAGE[village];
                if (!banner) return null;
                const isContested = contested.has(sector) && !lite;
                return (
                    <div
                        key={sector}
                        className={"vw-sector-claim" + (isContested ? " contested" : "") + (lite ? " lite" : "")}
                        style={{ left: `${p.x}%`, top: `${p.y}%`, "--vw-accent": villageAccent(village) } as CSSProperties}
                        title={`${village} territory — Sector ${sector}${contested.has(sector) ? " (under siege)" : ""}`}
                    >
                        <span className="vw-claim-ring" />
                        <img className="vw-banner" src={banner} alt="" draggable={false} />
                    </div>
                );
            })}
        </div>
    );
}
